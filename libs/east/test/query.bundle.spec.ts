/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The jq front end runs in a browser (#921 C5, #922 K4): esbuild bundles
 * checkJq, completeJq, describeJqType, summaryProgram, parseJq, printJq and
 * lexJq for `platform: "browser"`, and nothing in their module graph is a Node
 * built-in. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The part of esbuild's API this test uses. */
interface Esbuild {
  build(options: {
    stdin: { contents: string; resolveDir: string; loader: "js" };
    bundle: true;
    format: "esm";
    platform: "browser";
    write: false;
    metafile: true;
    logLevel: "silent";
  }): Promise<{
    errors: unknown[];
    metafile: { inputs: Record<string, { imports: { path: string }[] }> };
    outputFiles: { text: string }[];
  }>;
}

/** esbuild, as the `tsx` dev dependency carries it: libs/east declares no bundler of its own. */
async function loadEsbuild(): Promise<Esbuild> {
  const require = createRequire(import.meta.url);
  const fromTsx = createRequire(require.resolve("tsx/package.json"));
  return await import(pathToFileURL(fromTsx.resolve("esbuild")).href) as Esbuild;
}

describe("the jq front end in a browser (C5)", () => {
  test("bundles for the browser with no Node built-in in its module graph", async () => {
    const esbuild = await loadEsbuild();
    // The built query modules sit beside this spec's own directory in dist/.
    const queryDir = fileURLToPath(new URL("../src/query/", import.meta.url));
    const result = await esbuild.build({
      stdin: {
        contents: "export { checkJq, completeJq, describeJqType, lexJq, parseJq, printJq, summaryProgram } from \"./index.js\";",
        resolveDir: queryDir,
        loader: "js",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    assert.deepEqual(result.errors, []);
    const builtins = new Set(builtinModules);
    const imports = Object.values(result.metafile.inputs).flatMap(input => input.imports.map(i => i.path));
    const nodeImports = imports.filter(path => path.startsWith("node:") || builtins.has(path));
    assert.deepEqual(nodeImports, []);
    for (const module of ["check", "complete", "describe", "summary"]) {
      assert.ok(Object.keys(result.metafile.inputs).some(path => path.endsWith(`query/jq/${module}.js`)), module);
    }
    assert.ok(result.outputFiles[0]!.text.length > 0);
  });
});
