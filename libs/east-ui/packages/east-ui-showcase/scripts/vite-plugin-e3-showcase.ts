/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that serves the showcase's e3 package (#849): the zip
 * `e3-showcase-package.ts` exports, of every e3-ui example module's e3
 * definitions, which the e3 the page runs imports as it starts
 * (`showcase-e3.ts`). The page imports where it is from the virtual module
 * `virtual:e3-showcase-package`. The dev server serves it at
 * `/e3-showcase.zip`, building it when it is first asked for; `vite build`
 * emits it as an asset named by its content (`assets/e3-showcase-<hash>.zip`),
 * and the bundle carries that URL — so a page never imports a package another
 * build made, however long a cache holds either.
 *
 * @remarks
 * - The step runs in a node process of its own, so each build imports the
 *   example modules afresh and the dev server's process never holds them.
 * - The modules are e3-ui's compiled ones, so an edit to one reaches the zip
 *   once e3-ui is rebuilt: when anything under e3-ui's `dist/` or `test/`
 *   changes, the dev server builds the zip again on the next request and
 *   reloads the page, whose e3 imported the package once, as it started —
 *   only a page that starts e3 again imports the package built again. An
 *   example module is reloaded with the page rather than updated in place, so
 *   the examples on the page and the package its e3 runs are read together.
 * - The page's own copy of e3-ui's IR is pre-bundled when the dev server
 *   starts (`optimizeDeps`), so an edit to it reaches the page as the server
 *   starts again (`make showcase` re-optimizes).
 */

import type { Plugin } from "vite";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { E3_SHOWCASE_ZIP } from "../showcase-config";

/** The module the page imports the package's URL from. */
const PACKAGE_MODULE = "virtual:e3-showcase-package";
const RESOLVED_PACKAGE_MODULE = `\0${PACKAGE_MODULE}`;

export interface E3ShowcaseOptions {
    /** The showcase package's root, where the package step runs. */
    rootDir: string;
    /** e3-ui's root: the dev server builds the zip again and reloads the page
     *  when anything under its `dist/` or `test/` changes. */
    e3UiDir: string;
}

/** Whether a file lies under a directory. */
function under(dir: string, file: string): boolean {
    return path.resolve(file).startsWith(dir + path.sep);
}

/**
 * Runs the package step in a node process of its own and reads the zip it
 * writes.
 *
 * @param rootDir - The showcase package's root
 * @returns The zip's bytes
 * @throws {Error} When the step fails, with what it wrote to stderr
 */
export async function buildE3ShowcaseZip(rootDir: string): Promise<Uint8Array> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "e3-showcase-"));
    try {
        const out = path.join(dir, E3_SHOWCASE_ZIP);
        const step = path.join(rootDir, "scripts", "e3-showcase-package.ts");
        await new Promise<void>((resolve, reject) => {
            execFile(process.execPath, ["--import", "tsx", step, out], { cwd: rootDir }, (error, _stdout, stderr) => {
                if (error === null) resolve();
                else reject(new Error(`the showcase's e3 package step failed: ${stderr.trim() || error.message}`));
            });
        });
        return new Uint8Array(await fs.readFile(out));
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

/**
 * The plugin: `virtual:e3-showcase-package`, `/e3-showcase.zip` on the dev
 * server, the zip emitted by its content from the build, and the page
 * reloaded when e3-ui changes under it.
 *
 * @param opts - The showcase's root and e3-ui's
 * @returns The plugin
 */
export function e3ShowcasePlugin(opts: E3ShowcaseOptions): Plugin {
    const test = path.join(opts.e3UiDir, "test");
    const watched = [path.join(opts.e3UiDir, "dist"), test];
    let zip: Promise<Uint8Array> | undefined;
    let serving = true;
    let base = "/";

    return {
        name: "e3-showcase",

        configResolved(config) {
            serving = config.command === "serve";
            base = config.base;
        },

        resolveId(id) {
            return id === PACKAGE_MODULE ? RESOLVED_PACKAGE_MODULE : undefined;
        },

        async load(id) {
            if (id !== RESOLVED_PACKAGE_MODULE) return undefined;
            if (serving) return `export default ${JSON.stringify(`${base}${E3_SHOWCASE_ZIP}`)};`;
            // Named by its content: Rollup gives the asset the hash of its
            // bytes, and writes its URL where the module reads it.
            const ref = this.emitFile({ type: "asset", name: E3_SHOWCASE_ZIP, source: await buildE3ShowcaseZip(opts.rootDir) });
            return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
        },

        configureServer(server) {
            server.watcher.add(watched);
            // The package is built again on the next request, and the page
            // reloads to start its e3 over it.
            const changed = (file: string) => {
                if (!watched.some((dir) => under(dir, file))) return;
                zip = undefined;
                server.ws.send({ type: "full-reload" });
            };
            server.watcher.on("add", changed);
            server.watcher.on("change", changed);
            server.watcher.on("unlink", changed);

            server.middlewares.use(`/${E3_SHOWCASE_ZIP}`, (req, res, next) => {
                if (req.method !== "GET" && req.method !== "HEAD") {
                    next();
                    return;
                }
                const building = zip ??= buildE3ShowcaseZip(opts.rootDir);
                building.then(
                    (bytes) => {
                        res.setHeader("Content-Type", "application/zip");
                        res.setHeader("Content-Length", String(bytes.byteLength));
                        res.setHeader("Cache-Control", "no-store");
                        res.end(req.method === "HEAD" ? undefined : bytes);
                    },
                    (error: unknown) => {
                        // The next request builds it again.
                        if (Object.is(zip, building)) zip = undefined;
                        const message = error instanceof Error ? error.message : String(error);
                        server.config.logger.error(message);
                        res.statusCode = 500;
                        res.end(message);
                    },
                );
            });
        },

        // An example module is not updated in place: the watcher above reloads
        // the page, with the zip built again.
        handleHotUpdate({ file }) {
            return under(test, file) ? [] : undefined;
        },
    };
}
