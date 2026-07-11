/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Browser acquisition and launch for headless capture.
 *
 * The launch cascade (in order):
 *   1. `E3_UI_CHROMIUM_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — an
 *      explicit executable wins outright.
 *   2. A bare `chromium.launch({ headless: true })` — playwright-core resolves
 *      its own managed cache (the `chromium-headless-shell` build installed by
 *      `e3-ui install-browser`, or a full build; honors
 *      `PLAYWRIGHT_BROWSERS_PATH`). `chromium.executablePath()` must NEVER be
 *      fed back into `launch()` here: it always names the FULL chromium
 *      binary, which does not exist after an `--only-shell` install.
 *   3. A system-installed Chromium-family browser, per platform — skipping
 *      Ubuntu's snap shims (`/usr/bin/chromium-browser` is a shell script that
 *      execs the confined snap, which breaks automation).
 *
 * Sandboxing: playwright launches Chromium with `--no-sandbox` by default
 * (`chromiumSandbox` defaults to false) — correct for rendering trusted local
 * components, and why running as root just works.
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, openSync, readSync, closeSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser } from 'playwright-core';

/** Chromium args shared by every launch — `--disable-gpu` matches the in-repo
 *  snapshot pipeline so CLI captures are pixel-comparable with it. */
const LAUNCH_ARGS = ['--disable-gpu'];
// Playwright's headless defaults include `--hide-scrollbars`, which suppresses
// EVERY scrollbar (native and CSS-styled) — a shot of a bounded scroll region
// then shows no "there's more" affordance at all. This tool's whole job is a
// faithful layout snapshot, so put scrollbars back (#320).
const IGNORE_DEFAULT_ARGS = ['--hide-scrollbars'];

/** The env vars honored as an explicit browser override, in precedence order. */
export const BROWSER_ENV_VARS = ['E3_UI_CHROMIUM_PATH', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] as const;

/**
 * Return the explicit browser override from the environment, if any.
 *
 * @param env - Environment to read (injectable for tests)
 * @returns The overriding executable path, or `null` when unset
 */
export function envBrowserPath(env: NodeJS.ProcessEnv = process.env): string | null {
    for (const name of BROWSER_ENV_VARS) {
        const value = env[name];
        if (value) return value;
    }
    return null;
}

/**
 * Candidate system-browser executables for a platform, most-preferred first.
 *
 * @param platform - `process.platform` value (injectable for tests)
 * @param env - Environment for Windows `%ProgramFiles%`-style roots
 * @returns Absolute candidate paths (existence NOT yet checked)
 */
export function systemBrowserCandidates(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    switch (platform) {
        case 'linux':
            return [
                '/opt/google/chrome/chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser',
            ];
        case 'darwin':
            return [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ];
        case 'win32': {
            const roots = [
                env['ProgramFiles'],
                env['ProgramFiles(x86)'],
                env['LocalAppData'],
            ].filter((r): r is string => !!r);
            return [
                ...roots.map(r => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
                ...roots.map(r => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
            ];
        }
        default:
            return [];
    }
}

/**
 * Whether a candidate is a real browser binary rather than Ubuntu's snap shim.
 * Rejects a path whose realpath resolves under `/snap/`, or whose file starts
 * with `#!` (`/usr/bin/chromium-browser` on Ubuntu is a `#!/bin/sh` script
 * that execs the confined snap — useless for automation).
 *
 * @param executablePath - Existing candidate path to vet
 * @returns True when the candidate is launchable
 */
export function isRealBrowserBinary(executablePath: string): boolean {
    try {
        if (realpathSync(executablePath).split(path.sep).includes('snap')) return false;
        const fd = openSync(executablePath, 'r');
        try {
            const head = Buffer.alloc(2);
            const n = readSync(fd, head, 0, 2, 0);
            return !(n === 2 && head[0] === 0x23 && head[1] === 0x21); // "#!"
        } finally {
            closeSync(fd);
        }
    } catch {
        return false;
    }
}

/**
 * Find the first usable system browser.
 *
 * @param platform - `process.platform` value (injectable for tests)
 * @param env - Environment for Windows roots
 * @returns The executable path, or `null` when none is usable
 */
export function findSystemBrowser(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    for (const candidate of systemBrowserCandidates(platform, env)) {
        if (existsSync(candidate) && isRealBrowserBinary(candidate)) return candidate;
    }
    return null;
}

/** How the launched browser was obtained (surfaced by `doctor` and errors). */
export type BrowserSource =
    | { kind: 'env'; executablePath: string }
    | { kind: 'managed' }
    | { kind: 'system'; executablePath: string };

/** One-line remediation block shared by the launch error and `doctor`. */
export function launchRemediation(): string {
    return (
        `  - Run \`e3-ui install-browser\` to download a version-matched headless Chromium` +
        ` (add --with-deps on a fresh Linux server to also install system libraries).\n` +
        `  - Or set E3_UI_CHROMIUM_PATH to a Chrome/Chromium/Edge executable` +
        ` (not Ubuntu's snap chromium — its confinement breaks automation).\n` +
        `  - Run \`e3-ui doctor\` for a full diagnosis.`
    );
}

/**
 * Launch headless Chromium via the acquisition cascade.
 *
 * @param env - Environment to read overrides from (injectable for tests)
 * @returns The browser plus which source of the cascade provided it
 * @throws When no browser can be launched; the message carries the full
 *   remediation (install-browser / E3_UI_CHROMIUM_PATH / doctor)
 */
export async function launchBrowser(
    env: NodeJS.ProcessEnv = process.env,
): Promise<{ browser: Browser; source: BrowserSource }> {
    const override = envBrowserPath(env);
    if (override) {
        try {
            const browser = await chromium.launch({ headless: true, executablePath: override, args: LAUNCH_ARGS, ignoreDefaultArgs: IGNORE_DEFAULT_ARGS });
            return { browser, source: { kind: 'env', executablePath: override } };
        } catch (err) {
            throw new Error(
                `Could not launch the browser set by ${BROWSER_ENV_VARS.find(v => env[v]) ?? BROWSER_ENV_VARS[0]} ` +
                `(${override}): ${firstLine(err)}\n${launchRemediation()}`,
            );
        }
    }

    let managedError: unknown;
    try {
        const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS, ignoreDefaultArgs: IGNORE_DEFAULT_ARGS });
        return { browser, source: { kind: 'managed' } };
    } catch (err) {
        managedError = err;
    }

    const system = findSystemBrowser();
    if (system) {
        try {
            const browser = await chromium.launch({ headless: true, executablePath: system, args: LAUNCH_ARGS, ignoreDefaultArgs: IGNORE_DEFAULT_ARGS });
            return { browser, source: { kind: 'system', executablePath: system } };
        } catch (err) {
            throw new Error(
                `No managed browser (${firstLine(managedError)}), and the system browser at ${system} ` +
                `failed to launch: ${firstLine(err)}\n${launchRemediation()}`,
            );
        }
    }

    throw new Error(
        `Could not launch headless Chromium: ${firstLine(managedError)}\n${launchRemediation()}`,
    );
}

function firstLine(err: unknown): string {
    return (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? 'unknown error';
}

/**
 * Download the version-matched `chromium-headless-shell` into playwright's
 * managed cache (honors `PLAYWRIGHT_BROWSERS_PATH`), by spawning the bundled
 * playwright-core CLI: `install --only-shell chromium`. The shell build is the
 * one a bare headless launch selects, and is ~100 MB lighter than full
 * Chromium with no X11/D-Bus system libraries.
 *
 * @param opts - `withDeps` also installs OS packages (Linux only; skipped with
 *   a note elsewhere — Windows/macOS need no system libraries)
 * @returns The spawned process exit code
 */
export async function installBrowser(opts: { withDeps?: boolean } = {}): Promise<number> {
    // playwright-core exports no `./cli` subpath — resolve cli.js at the
    // package root via the always-exported package.json.
    const require = createRequire(import.meta.url);
    const cliJs = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
    const withDeps = (opts.withDeps ?? false) && process.platform === 'linux';
    if (opts.withDeps && !withDeps) {
        console.log('(--with-deps is only needed on Linux — skipped.)');
    }
    const args = [cliJs, 'install', '--only-shell', ...(withDeps ? ['--with-deps'] : []), 'chromium'];
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    return await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', code => resolve(code ?? 1));
    });
}

/**
 * Diagnose the browser setup: report env overrides, run the real launch
 * cascade against `about:blank`, and print what worked — or per-OS remediation
 * for what didn't.
 *
 * @param env - Environment to diagnose (injectable for tests)
 * @returns Process exit code (0 healthy, 1 not)
 */
export async function doctor(env: NodeJS.ProcessEnv = process.env): Promise<number> {
    for (const name of BROWSER_ENV_VARS) {
        console.log(`${name}: ${env[name] ?? '(unset)'}`);
    }
    console.log(`PLAYWRIGHT_BROWSERS_PATH: ${env['PLAYWRIGHT_BROWSERS_PATH'] ?? '(default cache)'}`);

    let result: { browser: Browser; source: BrowserSource };
    try {
        result = await launchBrowser(env);
    } catch (err) {
        console.error(`\nBrowser launch: FAILED\n${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    try {
        const page = await result.browser.newPage();
        await page.goto('about:blank');
        const version = result.browser.version();
        const source = result.source.kind === 'managed'
            ? 'playwright-managed cache'
            : `${result.source.kind === 'env' ? 'env override' : 'system browser'} at ${result.source.executablePath}`;
        console.log(`\nBrowser launch: OK (Chromium ${version}, ${source})`);
        console.log('e3-ui shot is ready to render.');
        return 0;
    } catch (err) {
        console.error(`\nBrowser launched but failed to open a page: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    } finally {
        await result.browser.close();
    }
}
