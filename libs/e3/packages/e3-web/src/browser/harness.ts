/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The Chromium harness: what e3-web's browser specs run their pages in.
 *
 * A spec names the modules its pages load — each a test page's entry, which
 * serves its functions with `servePage` (`./page.ts`) — and the harness
 * - bundles each with esbuild, for a browser;
 * - serves the bundles, and a page that loads each, from a local HTTP server
 *   on the loopback address, a secure context, so the pages have OPFS and Web
 *   Locks;
 * - launches Chromium through playwright-core, and opens pages of the one
 *   origin in one browser context, so they share its IndexedDB, OPFS and Web
 *   Locks as the tabs of one site do;
 * - calls a page's functions from Node, failing the call with what the page
 *   threw, or with an error the page raised meanwhile.
 *
 * A spec registers each in-page case as a `node:test` test of its own, which
 * calls the page to run it. A spec never skips itself: when Chromium cannot
 * launch, its `before` hook fails with the remediation, and every test in it
 * with it.
 *
 * @packageDocumentation
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { BRIDGE, type PageBridge } from './page.js';

/** The environment variables that name a Chromium to launch, in precedence
 *  order: e3-ui-cli's, and Playwright's own. */
export const BROWSER_ENV_VARS = ['E3_UI_CHROMIUM_PATH', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] as const;

/** How long a call of a page's function may take before it fails: a case
 *  that hangs fails, naming the call, rather than holding its run. */
const CALL_DEADLINE_MS = 120_000;

/**
 * The Chromium the environment names, if any.
 *
 * @param env - The environment to read
 * @returns The executable's path, or `null` when none is named
 */
export function envBrowserPath(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of BROWSER_ENV_VARS) {
    const value = env[name];
    if (value) return value;
  }
  return null;
}

/**
 * What to do when Chromium does not launch.
 *
 * @returns The remediation, a line a way
 */
export function launchRemediation(): string {
  return [
    '  - Install the Chromium Playwright runs: `pnpm --filter @elaraai/e3-web exec playwright-core install --only-shell chromium`' +
      ' (add --with-deps on a fresh Linux machine for its system libraries).',
    `  - Or set ${BROWSER_ENV_VARS[0]} to a Chrome or Chromium executable (not Ubuntu's snap chromium, whose confinement breaks automation).`,
  ].join('\n');
}

/** An error's first line. */
function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : `${err as string}`).split('\n')[0] ?? 'unknown error';
}

/**
 * Launches headless Chromium: the executable the environment names when it
 * names one, and otherwise the Chromium Playwright manages.
 *
 * @remarks
 * The managed launch lets playwright-core find its own build in its cache
 * (`PLAYWRIGHT_BROWSERS_PATH`, or `~/.cache/ms-playwright`): the headless
 * shell `install --only-shell chromium` installs, or a full build.
 * `chromium.executablePath()` is never fed back to the launch, since it names
 * the full build, which a shell-only install lacks.
 *
 * @param env - The environment to read the executable from
 * @returns The browser
 * @throws {Error} When Chromium does not launch, with the remediation
 */
export async function launchChromium(env: NodeJS.ProcessEnv = process.env): Promise<Browser> {
  const executablePath = envBrowserPath(env);
  try {
    return await chromium.launch(executablePath === null ? { headless: true } : { headless: true, executablePath });
  } catch (err) {
    const which = executablePath === null
      ? 'the Chromium Playwright manages'
      : `the Chromium ${BROWSER_ENV_VARS.find((name) => env[name]) ?? BROWSER_ENV_VARS[0]} names (${executablePath})`;
    throw new Error(`Could not launch ${which} for e3-web's browser specs: ${firstLine(err)}\n${launchRemediation()}`);
  }
}

/**
 * Bundles modules for a browser, each whole.
 *
 * @param entries - Each module's path, by the name it is served at
 *   (`/<name>.js`)
 * @returns Each bundle, by the name it is served at
 * @throws {Error} When a module does not bundle: it reaches Node, say
 */
export async function bundle(entries: Readonly<Record<string, string>>): Promise<Map<string, Uint8Array>> {
  const outdir = path.resolve('/e3-web-harness');
  const result = await build({
    entryPoints: Object.entries(entries).map(([out, entry]) => ({ in: entry, out })),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: 'inline',
    write: false,
    outdir,
    logLevel: 'silent',
  });
  return new Map(result.outputFiles.map((file) => [path.basename(file.path, '.js'), file.contents]));
}

/** The page that loads a bundle as a module. */
function pageFor(name: string): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>e3-web test page</title></head>',
    `<body><script type="module" src="/${name}.js"></script></body></html>`,
  ].join('\n');
}

/**
 * How {@link Harness.open} sets up.
 */
export interface HarnessOptions {
  /** The modules the pages load: each a test page's entry, by the name a
   *  page is opened by */
  readonly entries: Readonly<Record<string, string>>;
}

/**
 * Chromium, a server of test pages, and the pages opened: what a browser spec
 * runs over.
 *
 * @example
 * ```ts
 * describe('in Chromium', () => {
 *   let harness: Harness;
 *   let page: HarnessPage;
 *   before(async () => {
 *     harness = await Harness.open({ entries: { storage: fileURLToPath(new URL('./storage.page.js', import.meta.url)) } });
 *     page = await harness.newPage('storage');
 *   });
 *   after(() => harness?.close());
 *   it('runs in the page', () => page.call('runCase', 'records', 'indexeddb', 'reads a record …'));
 * });
 * ```
 */
export class Harness {
  private readonly pages = new Set<HarnessPage>();

  private constructor(
    private readonly server: Server,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    /** The pages' origin: `http://127.0.0.1:<port>` */
    readonly origin: string,
    private readonly names: ReadonlySet<string>,
  ) {}

  /**
   * Bundles the pages' modules, serves them, and launches Chromium.
   *
   * @param options - The modules the pages load
   * @returns The harness, with no page open
   * @throws {Error} When a module does not bundle, or Chromium does not
   *   launch, with the remediation
   */
  static async open(options: HarnessOptions): Promise<Harness> {
    const bundles = await bundle(options.entries);
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const name = /^\/([\w.-]+)\.(js|html)$/.exec(new URL(request.url ?? '/', 'http://localhost').pathname);
      const body = name === null ? undefined : name[2] === 'js' ? bundles.get(name[1]!) : bundles.has(name[1]!) ? pageFor(name[1]!) : undefined;
      if (request.method !== 'GET' || name === null || body === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': name[2] === 'js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      }).end(body);
    });
    // The loopback address is a secure context, as localhost is.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let browser: Browser | undefined;
    try {
      browser = await launchChromium();
      const context = await browser.newContext();
      return new Harness(server, browser, context, origin, new Set(bundles.keys()));
    } catch (err) {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw err;
    }
  }

  /**
   * Opens a page of the origin that loads a module, once it serves its
   * functions.
   *
   * @param entry - The module's name, as the harness was given it
   * @returns The page
   * @throws {Error} When the harness has no such module, or the page is not a
   *   secure context
   */
  async newPage(entry: string): Promise<HarnessPage> {
    if (!this.names.has(entry)) throw new Error(`the harness has no page '${entry}'`);
    const page = new HarnessPage(await this.context.newPage(), `${this.origin}/${entry}.html`, () => this.pages.delete(page));
    this.pages.add(page);
    await page.load();
    return page;
  }

  /**
   * Closes every page, Chromium and the server.
   */
  async close(): Promise<void> {
    for (const page of [...this.pages]) await page.close();
    await this.context.close();
    await this.browser.close();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/**
 * A page a spec calls functions of: a tab of the harness's origin.
 */
export class HarnessPage {
  /** What the page raised outside any call's answer, not yet reported */
  private readonly errors: Error[] = [];
  private closed = false;

  /**
   * @param page - The Playwright page, for what the bridge does not cover
   * @param url - The page's address
   * @param forget - Tells the harness the page has closed
   * @internal
   */
  constructor(readonly page: Page, private readonly url: string, private readonly forget: () => void) {
    page.on('pageerror', (error) => this.errors.push(error));
  }

  /**
   * Loads the page, and waits until it serves its functions.
   *
   * @internal
   */
  async load(): Promise<void> {
    await this.page.goto(this.url);
    await this.page.waitForFunction((bridge) => (globalThis as unknown as Record<string, { ready?: boolean } | undefined>)[bridge]?.ready === true, BRIDGE);
    if (!(await this.page.evaluate(() => isSecureContext))) {
      throw new Error(`${this.url} is not a secure context: it has neither OPFS nor Web Locks`);
    }
    this.raised();
  }

  /** Throws what the page raised since it was last asked. */
  private raised(): void {
    const errors = this.errors.splice(0);
    if (errors.length > 0) throw new Error(`the page raised: ${errors.map((error) => error.stack ?? error.message).join('\n')}`);
  }

  /**
   * Calls a function the page serves.
   *
   * @param name - The function's name
   * @param args - Its arguments, which serialize
   * @returns Its answer, which serializes
   * @throws {Error} What the function threw, or what the page raised
   *   meanwhile, or when it has not answered in two minutes
   */
  async call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    this.raised();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the page did not answer ${name} in ${CALL_DEADLINE_MS / 1000} s`)), CALL_DEADLINE_MS);
    });
    try {
      const answer = await Promise.race([
        this.page.evaluate(
          ({ bridge, fn, fnArgs }) => (globalThis as unknown as Record<string, PageBridge>)[bridge]!.call(fn, fnArgs),
          { bridge: BRIDGE, fn: name, fnArgs: args },
        ),
        deadline,
      ]);
      this.raised();
      return answer as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Reloads the page, as a tab reloads: what it holds in memory goes, and
   * its locks with it, and what it stored stays.
   */
  async reload(): Promise<void> {
    await this.load();
  }

  /**
   * Closes the page, as a tab closes: nothing is released first.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.forget();
    await this.page.close();
  }
}
