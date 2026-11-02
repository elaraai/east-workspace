/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that serves the showcase's workspace bundles (#849, #1397): an
 * area's — the e3 examples of one category, one directory of e3-ui's `test/`
 * — is its workspace as an e3 in node made it, written out in one stream of
 * beast2, which the e3 the page runs makes the area's workspace from the first
 * time one of its examples shows (`showcase-e3.ts`), with nothing to deploy or
 * run. It is made in two steps, each in a node process of its own: e3-ui's
 * examples' package step (`@elaraai/e3-ui/examples-package`, #1375) writes the
 * area's package, holding what its examples read, as a zip; then
 * `scripts/e3-showcase-bundles.ts` imports it into an e3 as the page's runs,
 * deploys it to the area's workspace, runs its dataflow once, and writes the
 * workspace out.
 *
 * The page imports where each bundle is from the virtual module
 * `virtual:e3-showcase-bundles`, a function of the area. The dev server serves
 * each at its name (`/e3-showcase-<area>.beast2`, `showcase-config.ts`'
 * `e3ShowcaseBundle`), packaging every area when the first is asked for and
 * making each area's bundle as it is first asked for; `vite build` makes them
 * all and emits each as an asset named by its content
 * (`assets/e3-showcase-<area>-<hash>.beast2`), whose URL the page's code
 * carries — so a page never takes a bundle another build made, however long a
 * cache holds either.
 *
 * @remarks
 * - Each step runs in a node process of its own, so each build imports the
 *   example modules afresh, and an area's dataflow never runs in the dev
 *   server's process.
 * - The modules are e3-ui's compiled ones, so an edit to one reaches the
 *   bundles once e3-ui is rebuilt: when anything under e3-ui's `dist/` or
 *   `test/` changes, the dev server makes them again as they are next asked
 *   for, and reloads the page, whose e3 made each area's workspace once, as
 *   the area started. An example module is reloaded with the page rather than
 *   updated in place, so the examples on the page and the workspaces its e3
 *   runs are read together.
 * - The page's own copy of e3-ui's IR is pre-bundled when the dev server
 *   starts (`optimizeDeps`), so an edit to it reaches the page as the server
 *   starts again (`make showcase` re-optimizes).
 */

import type { Plugin } from "vite";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { e3ShowcaseBundle, e3ShowcaseBundleArea } from "../showcase-config";

/** The module the page imports each area's bundle's URL from. */
const BUNDLES_MODULE = "virtual:e3-showcase-bundles";
const RESOLVED_BUNDLES_MODULE = `\0${BUNDLES_MODULE}`;

/** Where the bundles' names are made, which the dev server's module imports. */
const SHOWCASE_CONFIG = fileURLToPath(new URL("../showcase-config.ts", import.meta.url));

/** The showcase's root, where the bundle step runs. */
const SHOWCASE_DIR = fileURLToPath(new URL("..", import.meta.url));

/** The step that makes each area's bundle from its zip. */
const BUNDLE_STEP = fileURLToPath(new URL("./e3-showcase-bundles.ts", import.meta.url));

export interface E3ShowcaseOptions {
    /** e3-ui's root: its examples' package step is compiled under its `dist/`,
     *  and the dev server makes the bundles again and reloads the page when
     *  anything under its `dist/` or `test/` changes. */
    e3UiDir: string;
}

/** Whether a file lies under a directory. */
function under(dir: string, file: string): boolean {
    return path.resolve(file).startsWith(dir + path.sep);
}

/** Runs a step in a node process of its own, failing with what it wrote to
 *  stderr. */
function runStep(what: string, args: readonly string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
            if (error === null) resolve();
            else reject(new Error(`the showcase's ${what} failed: ${stderr.trim() || error.message}`));
        });
    });
}

/**
 * Runs e3-ui's examples' package step into a directory: a zip an area,
 * `<dir>/<area>.zip`.
 *
 * @param e3UiDir - e3-ui's root, built
 * @param dir - The directory the zips are written to
 * @throws {Error} When the step fails, with what it wrote to stderr
 */
export async function writeE3ShowcaseZips(e3UiDir: string, dir: string): Promise<void> {
    await runStep("e3 package step", [path.join(e3UiDir, "dist", "test", "examples-package.js"), dir], e3UiDir);
}

/**
 * Makes the bundles of areas whose zips a directory holds: `<dir>/<area>.beast2`
 * beside each zip.
 *
 * @param dir - The directory of the zips ({@link writeE3ShowcaseZips})
 * @param areas - The areas to make bundles of: every zip's, unless given
 * @throws {Error} When the step fails, naming the area and what failed
 */
export async function writeE3ShowcaseBundles(dir: string, areas: readonly string[] = []): Promise<void> {
    await runStep("e3 bundle step", ["--import", "tsx", BUNDLE_STEP, dir, ...areas], SHOWCASE_DIR);
}

/** The files of a directory with an extension, by the name before it, in
 *  order. */
async function filesOf(dir: string, extension: string): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    for (const file of (await fs.readdir(dir)).sort((a, b) => a.localeCompare(b))) {
        if (!file.endsWith(extension)) continue;
        files.set(file.slice(0, -extension.length), new Uint8Array(await fs.readFile(path.join(dir, file))));
    }
    return files;
}

/** Runs a build in a directory of its own, removed once it is read. */
async function inTemporaryDir<T>(build: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-"));
    try {
        return await build(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

/**
 * Runs e3-ui's examples' package step and reads the zip it writes for each
 * area.
 *
 * @param e3UiDir - e3-ui's root, built
 * @returns Each area's zip, by area in the areas' order
 * @throws {Error} When the step fails, with what it wrote to stderr
 */
export function buildE3ShowcaseZips(e3UiDir: string): Promise<Map<string, Uint8Array>> {
    return inTemporaryDir(async (dir) => {
        await writeE3ShowcaseZips(e3UiDir, dir);
        return filesOf(dir, ".zip");
    });
}

/**
 * Makes every area's bundle — its package step, then its workspace made and
 * written out — and reads them.
 *
 * @param e3UiDir - e3-ui's root, built
 * @returns Each area's bundle, by area in the areas' order
 * @throws {Error} When a step fails, with what it wrote to stderr
 */
export function buildE3ShowcaseBundles(e3UiDir: string): Promise<Map<string, Uint8Array>> {
    return inTemporaryDir(async (dir) => {
        await writeE3ShowcaseZips(e3UiDir, dir);
        await writeE3ShowcaseBundles(dir);
        return filesOf(dir, ".beast2");
    });
}

/**
 * The plugin: `virtual:e3-showcase-bundles`, each area's bundle at its name on
 * the dev server, the bundles emitted by their content from the build, and the
 * page reloaded when e3-ui changes under it.
 *
 * @param opts - e3-ui's root
 * @returns The plugin
 */
export function e3ShowcasePlugin(opts: E3ShowcaseOptions): Plugin {
    const test = path.join(opts.e3UiDir, "test");
    const watched = [path.join(opts.e3UiDir, "dist"), test];
    /** The dev server's zips, every area's, in a directory it removes once
     *  they are made again or it closes. */
    let zips: Promise<string> | undefined;
    /** The dev server's bundles, each made as it is first asked for. */
    const bundles = new Map<string, Promise<Uint8Array | undefined>>();
    let serving = true;
    let base = "/";
    // The dev server's bundles, by when it started and how many times the examples changed since: what names them.
    const startedAt = Date.now();
    let generation = 0;

    /** Forgets the dev server's zips and bundles, and removes their directory. */
    const forget = (): void => {
        const dir = zips;
        zips = undefined;
        bundles.clear();
        void dir?.then((made) => fs.rm(made, { recursive: true, force: true })).catch(() => undefined);
    };

    /** The dev server's zips: made when the first bundle is asked for, and
     *  again by the next request after a step that failed. */
    const zipsDir = (): Promise<string> => {
        if (zips === undefined) {
            const making = fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-")).then(async (dir) => {
                try {
                    await writeE3ShowcaseZips(opts.e3UiDir, dir);
                    return dir;
                } catch (err) {
                    await fs.rm(dir, { recursive: true, force: true });
                    throw err;
                }
            });
            zips = making;
            making.catch(() => {
                if (Object.is(zips, making)) zips = undefined;
            });
        }
        return zips;
    };

    /** An area's bundle on the dev server, made as it is first asked for, and
     *  again by the next request after a step that failed: `undefined` for an
     *  area with no package. */
    const bundleOf = (area: string): Promise<Uint8Array | undefined> => {
        let made = bundles.get(area);
        if (made === undefined) {
            const making = zipsDir().then(async (dir) => {
                if (!await fs.access(path.join(dir, `${area}.zip`)).then(() => true, () => false)) return undefined;
                await writeE3ShowcaseBundles(dir, [area]);
                return new Uint8Array(await fs.readFile(path.join(dir, `${area}.beast2`)));
            });
            bundles.set(area, making);
            making.catch(() => {
                if (Object.is(bundles.get(area), making)) bundles.delete(area);
            });
            made = making;
        }
        return made;
    };

    return {
        name: "e3-showcase",

        configResolved(config) {
            serving = config.command === "serve";
            base = config.base;
        },

        resolveId(id) {
            return id === BUNDLES_MODULE ? RESOLVED_BUNDLES_MODULE : undefined;
        },

        async load(id) {
            if (id !== RESOLVED_BUNDLES_MODULE) return undefined;
            // The dev server answers every area's at its name, and says when it has none.
            if (serving) {
                return `import { e3ShowcaseBundle } from ${JSON.stringify(SHOWCASE_CONFIG)};\n`
                    + `export default (area) => ${JSON.stringify(base)} + e3ShowcaseBundle(area);\n`
                    + `export const bundlesKey = ${JSON.stringify(`dev-${startedAt}-${generation}`)};\n`;
            }
            // Each named by its content: Rollup gives an asset the hash of its
            // bytes, and writes its URL where the module reads it.
            const urls = [...await buildE3ShowcaseBundles(opts.e3UiDir)].map(([area, source]) =>
                `[${JSON.stringify(area)}, import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: e3ShowcaseBundle(area), source })}]`);
            return `const urls = new Map([${urls.join(", ")}]);\nexport default (area) => urls.get(area);\n`
                + `export const bundlesKey = [...urls.values()].join("\\n");\n`;
        },

        configureServer(server) {
            server.watcher.add(watched);
            // The bundles are made again as they are next asked for, and the
            // page reloads to start its e3 over them.
            const changed = (file: string) => {
                if (!watched.some((dir) => under(dir, file))) return;
                forget();
                // The bundles made next are others: the module names them anew.
                generation += 1;
                const module = server.moduleGraph.getModuleById(RESOLVED_BUNDLES_MODULE);
                if (module !== undefined) server.moduleGraph.invalidateModule(module);
                server.ws.send({ type: "full-reload" });
            };
            server.watcher.on("add", changed);
            server.watcher.on("change", changed);
            server.watcher.on("unlink", changed);
            server.httpServer?.once("close", forget);

            server.middlewares.use((req, res, next) => {
                const pathname = new URL(req.url ?? "/", "http://showcase").pathname;
                const area = pathname.startsWith(base) ? e3ShowcaseBundleArea(pathname.slice(base.length)) : undefined;
                if (area === undefined || (req.method !== "GET" && req.method !== "HEAD")) {
                    next();
                    return;
                }
                bundleOf(area).then(
                    (bytes) => {
                        if (bytes === undefined) {
                            res.statusCode = 404;
                            res.end(`the showcase has no e3 package for the area '${area}'`);
                            return;
                        }
                        res.setHeader("Content-Type", "application/beast2");
                        res.setHeader("Content-Length", String(bytes.byteLength));
                        res.setHeader("Cache-Control", "no-store");
                        res.end(req.method === "HEAD" ? undefined : bytes);
                    },
                    (error: unknown) => {
                        const message = error instanceof Error ? error.message : String(error);
                        server.config.logger.error(message);
                        res.statusCode = 500;
                        res.end(message);
                    },
                );
            });
        },

        // An example module is not updated in place: the watcher above reloads
        // the page, with the bundles made again.
        handleHotUpdate({ file }) {
            return under(test, file) ? [] : undefined;
        },
    };
}
