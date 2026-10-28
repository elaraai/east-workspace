/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that serves the showcase's e3 packages (#849, #1397): the zips
 * e3-ui's examples' package step writes (`@elaraai/e3-ui/examples-package`,
 * #1375), one an area — the e3 examples of one category, one directory of
 * e3-ui's `test/` — each holding what the area's examples read, which the e3
 * the page runs deploys into a workspace of the area's own the first time one
 * of its examples shows (`showcase-e3.ts`). The page imports where each is
 * from the virtual module `virtual:e3-showcase-packages`, a function of the
 * area. The dev server serves each at its name (`/e3-showcase-<area>.zip`,
 * `showcase-config.ts`' `e3ShowcaseZip`), building them all when one is first
 * asked for; `vite build` emits each as an asset named by its content
 * (`assets/e3-showcase-<area>-<hash>.zip`), and the bundle carries those URLs
 * — so a page never imports a package another build made, however long a
 * cache holds either.
 *
 * @remarks
 * - The step runs in a node process of its own, so each build imports the
 *   example modules afresh and the dev server's process never holds them.
 * - The modules are e3-ui's compiled ones, so an edit to one reaches the zips
 *   once e3-ui is rebuilt: when anything under e3-ui's `dist/` or `test/`
 *   changes, the dev server builds the zips again on the next request and
 *   reloads the page, whose e3 deployed each area's package once, as the area
 *   started — only a page that starts its e3 again deploys the packages built
 *   again. An example module is reloaded with the page rather than updated in
 *   place, so the examples on the page and the packages its e3 runs are read
 *   together.
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
import { e3ShowcaseZip, e3ShowcaseZipArea } from "../showcase-config";

/** The module the page imports each area's package's URL from. */
const PACKAGES_MODULE = "virtual:e3-showcase-packages";
const RESOLVED_PACKAGES_MODULE = `\0${PACKAGES_MODULE}`;

/** Where the zips' names are made, which the dev server's module imports. */
const SHOWCASE_CONFIG = fileURLToPath(new URL("../showcase-config.ts", import.meta.url));

export interface E3ShowcaseOptions {
    /** e3-ui's root: its examples' package step is compiled under its `dist/`,
     *  and the dev server builds the zips again and reloads the page when
     *  anything under its `dist/` or `test/` changes. */
    e3UiDir: string;
}

/** Whether a file lies under a directory. */
function under(dir: string, file: string): boolean {
    return path.resolve(file).startsWith(dir + path.sep);
}

/**
 * Runs e3-ui's examples' package step in a node process of its own and reads
 * the zip it writes for each area.
 *
 * @param e3UiDir - e3-ui's root, built
 * @returns Each area's zip, by area in the areas' order
 * @throws {Error} When the step fails, with what it wrote to stderr
 */
export async function buildE3ShowcaseZips(e3UiDir: string): Promise<Map<string, Uint8Array>> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-"));
    try {
        const step = path.join(e3UiDir, "dist", "test", "examples-package.js");
        await new Promise<void>((resolve, reject) => {
            execFile(process.execPath, [step, dir], { cwd: e3UiDir }, (error, _stdout, stderr) => {
                if (error === null) resolve();
                else reject(new Error(`the showcase's e3 package step failed: ${stderr.trim() || error.message}`));
            });
        });
        const zips = new Map<string, Uint8Array>();
        for (const file of (await fs.readdir(dir)).sort((a, b) => a.localeCompare(b))) {
            if (!file.endsWith(".zip")) continue;
            zips.set(file.slice(0, -".zip".length), new Uint8Array(await fs.readFile(path.join(dir, file))));
        }
        return zips;
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

/**
 * The plugin: `virtual:e3-showcase-packages`, each area's zip at its name on
 * the dev server, the zips emitted by their content from the build, and the
 * page reloaded when e3-ui changes under it.
 *
 * @param opts - e3-ui's root
 * @returns The plugin
 */
export function e3ShowcasePlugin(opts: E3ShowcaseOptions): Plugin {
    const test = path.join(opts.e3UiDir, "test");
    const watched = [path.join(opts.e3UiDir, "dist"), test];
    let zips: Promise<Map<string, Uint8Array>> | undefined;
    let serving = true;
    let base = "/";

    return {
        name: "e3-showcase",

        configResolved(config) {
            serving = config.command === "serve";
            base = config.base;
        },

        resolveId(id) {
            return id === PACKAGES_MODULE ? RESOLVED_PACKAGES_MODULE : undefined;
        },

        async load(id) {
            if (id !== RESOLVED_PACKAGES_MODULE) return undefined;
            // The dev server answers every area's at its name, and says when it has none.
            if (serving) {
                return `import { e3ShowcaseZip } from ${JSON.stringify(SHOWCASE_CONFIG)};\n`
                    + `export default (area) => ${JSON.stringify(base)} + e3ShowcaseZip(area);\n`;
            }
            // Each named by its content: Rollup gives an asset the hash of its
            // bytes, and writes its URL where the module reads it.
            const urls = [...await buildE3ShowcaseZips(opts.e3UiDir)].map(([area, source]) =>
                `[${JSON.stringify(area)}, import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: e3ShowcaseZip(area), source })}]`);
            return `const urls = new Map([${urls.join(", ")}]);\nexport default (area) => urls.get(area);\n`;
        },

        configureServer(server) {
            server.watcher.add(watched);
            // The packages are built again on the next request, and the page
            // reloads to start its e3 over them.
            const changed = (file: string) => {
                if (!watched.some((dir) => under(dir, file))) return;
                zips = undefined;
                server.ws.send({ type: "full-reload" });
            };
            server.watcher.on("add", changed);
            server.watcher.on("change", changed);
            server.watcher.on("unlink", changed);

            server.middlewares.use((req, res, next) => {
                const pathname = new URL(req.url ?? "/", "http://showcase").pathname;
                const area = pathname.startsWith(base) ? e3ShowcaseZipArea(pathname.slice(base.length)) : undefined;
                if (area === undefined || (req.method !== "GET" && req.method !== "HEAD")) {
                    next();
                    return;
                }
                const building = zips ??= buildE3ShowcaseZips(opts.e3UiDir);
                building.then(
                    (all) => {
                        const bytes = all.get(area);
                        if (bytes === undefined) {
                            res.statusCode = 404;
                            res.end(`the showcase has no e3 package for the area '${area}'`);
                            return;
                        }
                        res.setHeader("Content-Type", "application/zip");
                        res.setHeader("Content-Length", String(bytes.byteLength));
                        res.setHeader("Cache-Control", "no-store");
                        res.end(req.method === "HEAD" ? undefined : bytes);
                    },
                    (error: unknown) => {
                        // The next request builds them again.
                        if (Object.is(zips, building)) zips = undefined;
                        const message = error instanceof Error ? error.message : String(error);
                        server.config.logger.error(message);
                        res.statusCode = 500;
                        res.end(message);
                    },
                );
            });
        },

        // An example module is not updated in place: the watcher above reloads
        // the page, with the zips built again.
        handleHotUpdate({ file }) {
            return under(test, file) ? [] : undefined;
        },
    };
}
