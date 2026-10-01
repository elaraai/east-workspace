/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `fonts` entry registers the brand faces in an app that installs the
 * package (#1090). A minimal Vite app whose one module imports
 * `@elaraai/east-ui-components/fonts` is made in a throwaway directory, the
 * package in its `node_modules` as an install lays it out: the published
 * manifest beside the entry's built files, and the fontsource packages it
 * depends on beside it. The app is then built and served.
 *
 * - `vite build` — Rollup reads the package's `sideEffects`, and drops an
 *   import of a module it does not list, stylesheets and all. The CSS the
 *   build emits must hold every face, each pointing at a file the build
 *   emits or embeds.
 * - `vite` (dev) — the dependency optimiser pre-bundles the entry with
 *   esbuild, which leaves an import for the page to load only when its
 *   specifier names a stylesheet; otherwise it bundles the stylesheet into a
 *   file of its own that nothing loads. The pre-bundled entry must import
 *   the stylesheets, and they must hold every face.
 *
 * It reads the built entry (`dist/`), so it runs after `make build`, as CI
 * runs it.
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, parseAst, type Rollup } from "vite";

/** This package's root. */
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The entry an app imports for the brand faces. */
const ENTRY = "@elaraai/east-ui-components/fonts";

/** Every face the entry registers, as `<family> <style>`: the three families
 *  upright, and JetBrains Mono italic for the muted "no data" value. */
const FACES = [
    "DM Sans Variable normal",
    "Inter Tight Variable normal",
    "JetBrains Mono Variable italic",
    "JetBrains Mono Variable normal",
];

/** The `@font-face` rules in a stylesheet: each one's family and style, and the files its `src` names. */
function fontFaces(css: string): { faces: string[]; files: string[] } {
    const faces = new Set<string>();
    const files: string[] = [];
    for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const family = /font-family:\s*([^;]+)/.exec(body!)?.[1]?.trim().replace(/^["']|["']$/g, "");
        const style = /font-style:\s*([^;]+)/.exec(body!)?.[1]?.trim() ?? "normal";
        if (family !== undefined) faces.add(`${family} ${style}`);
        for (const [, url] of body!.matchAll(/url\(\s*([^)]+?)\s*\)/g)) files.push(url!.replace(/^["']|["']$/g, ""));
    }
    return { faces: [...faces].sort(), files };
}

/** The specifiers a module imports statically. */
function importsOf(code: string): string[] {
    return parseAst(code).body.flatMap((node) =>
        node.type === "ImportDeclaration" && typeof node.source.value === "string" ? [node.source.value] : []);
}

/** The throwaway app: index.html, a main.js that imports the entry, and the installed packages. */
let app: string;

before(async () => {
    const pkg = JSON.parse(await readFile(join(PKG, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const built = (await readdir(join(PKG, "dist"))).filter((f) => f.startsWith("fonts."));
    assert.ok(built.includes("fonts.js"), "dist/fonts.js is missing: build the package first (make build)");

    app = await mkdtemp(join(tmpdir(), "east-ui-fonts-"));
    // The package as an install lays it out: its manifest and the entry's built files.
    const installed = join(app, "node_modules", "@elaraai", "east-ui-components");
    await mkdir(join(installed, "dist"), { recursive: true });
    await copyFile(join(PKG, "package.json"), join(installed, "package.json"));
    for (const f of built) await copyFile(join(PKG, "dist", f), join(installed, "dist", f));
    // Its fontsource dependencies beside it, each the package this one resolves.
    const fontsource = Object.keys(pkg.dependencies).filter((name) => name.startsWith("@fontsource-variable/"));
    assert.ok(fontsource.length >= 3, "the package depends on the three brand families");
    const require = createRequire(join(PKG, "package.json"));
    await mkdir(join(app, "node_modules", "@fontsource-variable"), { recursive: true });
    for (const name of fontsource) await symlink(dirname(require.resolve(name)), join(app, "node_modules", name), "dir");

    await writeFile(join(app, "index.html"), '<!doctype html>\n<html><head><meta charset="utf-8"></head><body><script type="module" src="/main.js"></script></body></html>\n');
    await writeFile(join(app, "main.js"), `import "${ENTRY}";\n`);
});

after(async () => {
    if (app !== undefined) await rm(app, { recursive: true, force: true });
});

test("vite build: the emitted CSS holds every brand face, each pointing at a file the build emits or embeds", async () => {
    const result = await build({ root: app, configFile: false, logLevel: "silent", build: { write: false } });
    assert.ok(!("close" in result), "a build, not a watcher");
    const outputs: Rollup.RollupOutput[] = Array.isArray(result) ? result : [result as Rollup.RollupOutput];
    const assets = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputAsset => o.type === "asset");
    const css = assets.filter((a) => a.fileName.endsWith(".css")).map((a) => String(a.source)).join("\n");
    const { faces, files } = fontFaces(css);
    assert.deepEqual(faces, FACES, `the build's CSS (${assets.filter((a) => a.fileName.endsWith(".css")).length} file(s)) holds these faces`);
    // A file under Vite's inline limit is embedded as a data: URL; any other is an emitted asset.
    const emitted = new Set(assets.map((a) => `/${a.fileName}`));
    const missing = files.filter((f) => !f.startsWith("data:font/") && !emitted.has(f));
    assert.ok(files.length >= FACES.length, `the faces name their files (${files.length})`);
    assert.deepEqual(missing, [], "every face's file is emitted or embedded");
});

test("vite (dev): the pre-bundled entry imports the stylesheets, and they hold every brand face", async () => {
    const server = await createServer({
        root: app,
        configFile: false,
        logLevel: "silent",
        server: { middlewareMode: true, ws: false, watch: null },
        // Pre-bundled as the optimiser pre-bundles an installed dependency it
        // finds; named here so no scan of the page is needed to find it.
        optimizeDeps: { include: [ENTRY], noDiscovery: true },
    });
    try {
        const main = await server.transformRequest("/main.js");
        assert.ok(main !== null, "the dev server serves main.js");
        const deps = importsOf(main.code);
        const entry = deps.find((url) => url.includes("/.vite/deps/"));
        assert.ok(entry !== undefined, `main.js imports the pre-bundled entry, not ${deps.join(", ")}`);
        const optimised = await server.transformRequest(entry);
        assert.ok(optimised !== null, "the dev server serves the pre-bundled entry");
        const sheets = importsOf(optimised.code).filter((url) => /\.css(\?|$)/.test(url));
        const css: string[] = [];
        for (const url of sheets) {
            // `direct`: the stylesheet itself, as a <link> requests it, not the module that injects it.
            const sheet = await server.transformRequest(`${url}${url.includes("?") ? "&" : "?"}direct`);
            assert.ok(sheet !== null, `the dev server serves ${url}`);
            css.push(sheet.code);
        }
        assert.deepEqual(fontFaces(css.join("\n")).faces, FACES, `the stylesheets the pre-bundled entry imports (${sheets.length}) hold these faces`);
        // The optimiser writes what it bundled beside the entry; a stylesheet there is one nothing loads.
        const cache = join(server.config.cacheDir, "deps");
        assert.ok(existsSync(cache), `the optimiser wrote its bundle to ${cache}`);
        const stranded = (await readdir(cache)).filter((f) => f.endsWith(".css"));
        assert.deepEqual(stranded, [], "no stylesheet is bundled into the optimiser's cache, where nothing loads it");
    } finally {
        await server.close();
    }
});
