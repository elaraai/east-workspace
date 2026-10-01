/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's calls without the builder (#941), `@elaraai/e3-ui-components/query`
 * (`src/query/calls.ts`), load in Node: the package's main entry cannot, since
 * its renderers need a DOM as they load, so a host in Node — a CLI, an agent, a
 * test against an e3 server — plans and makes a query's calls through this
 * entry. Bundled for Node, its graph must reach no React, no Chakra, no
 * TanStack and no renderer, and it must give the planner and the calls. The
 * built entry is loaded by its package path, in Node, by e3-ui-cli's query
 * plans spec.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const PKG_DIR = fileURLToPath(new URL("../..", import.meta.url));
const ENTRY = path.join(PKG_DIR, "src", "query", "calls.ts");

/** What a Node host must not load: React and what renders with it. */
const RENDERING = /^(react|react-dom|@chakra-ui\/react|@emotion\/react|@tanstack\/react-query|@tanstack\/react-virtual|@elaraai\/east-ui|@elaraai\/east-ui-components)(\/.*)?$/;

describe("@elaraai/e3-ui-components/query (#941)", () => {
    test("bundles for Node reaching nothing that renders", async () => {
        const reached: string[] = [];
        await esbuild.build({
            entryPoints: [ENTRY],
            bundle: true,
            write: false,
            platform: "node",
            format: "esm",
            logLevel: "silent",
            plugins: [{
                name: "query-calls-node-guard",
                setup(build) {
                    build.onResolve({ filter: RENDERING }, (args) => {
                        reached.push(`${args.path}  <-  ${path.relative(PKG_DIR, args.importer)}`);
                        return { path: args.path, external: true };
                    });
                },
            }],
        });
        assert.deepEqual(reached, [], `the query's calls reached what renders:\n  ${reached.join("\n  ")}\nImport its seams' types with \`import type\`, and nothing of the builder.`);
    });

    test("gives the planner, the one-shot call and the calls in memory", async () => {
        const entry = await import("../../src/query/calls.js") as Record<string, unknown>;
        const given = ["queryRoot", "prepareQuery", "queryResultOf", "draftPlan", "weighPlan", "planQuery", "splitCallRequest",
            "createInMemoryQueryCall", "createInMemorySplitCall", "createInMemorySourceStatus"];
        assert.deepEqual(given.filter((name) => typeof entry[name] !== "function"), []);
    });
});
