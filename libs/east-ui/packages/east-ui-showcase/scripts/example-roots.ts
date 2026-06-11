/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Registry of non-UI example roots across the monorepo. These packages
 * pull in Node / Python runtimes (`node:fs`, the Python bridge) and so
 * cannot be imported into the browser bundle — their examples are read
 * *statically* (source + metadata only, never executed) by
 * `vite-plugin-example-sources` and shown in the "Code Reference" section
 * as highlighted code blocks plus a `returns` value. The live, renderable
 * `east-ui` examples stay on the executed path in `catalog.ts`.
 *
 * Node-side only — the browser `catalog.ts` reads code examples from the
 * `virtual:example-sources` module and never imports this list.
 *
 * `dir` is relative to the showcase package root (the same base
 * `vite.config.ts` resolves `testDir` against with `__dirname`).
 */

export interface CodeExampleRoot {
    /** Package label — becomes the Code Reference category and the pathKey prefix. */
    package: string;
    /** Test dir holding `**\/*.examples.ts`, relative to the showcase package root. */
    dir: string;
}

export const CODE_EXAMPLE_ROOTS: readonly CodeExampleRoot[] = [
    { package: "east", dir: "../../../east/test" },
    { package: "east-node-std", dir: "../../../east-node/packages/east-node-std/test" },
    { package: "east-node-io", dir: "../../../east-node/packages/east-node-io/test" },
    { package: "east-py-datascience", dir: "../../../east-py/packages/east-py-datascience/test" },
];
