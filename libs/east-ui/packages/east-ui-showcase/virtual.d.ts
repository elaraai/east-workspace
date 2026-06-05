/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

declare module "virtual:example-sources" {
    /** A single captured source — raw TypeScript + pre-highlighted HTML. */
    export interface CapturedSource {
        /** Prettier-formatted TypeScript source. */
        raw: string;
        /** highlight.js pre-highlighted HTML (no wrapping `<pre>` / `<code>`). */
        html: string;
    }

    /**
     * Captured authored source of the `fn` property for every
     * `export const X = example({...})` declaration in the east-ui test
     * tree, keyed by relative-path-without-extension → export name.
     *
     * @example
     * ```ts
     * import { exampleSources } from "virtual:example-sources";
     * const cap = exampleSources["buttons/button"]?.["buttonBasic"];
     * // cap.raw:  "East.function([], UIComponentType, ($) => Button.Root(\"Click me\"))"
     * // cap.html: "<span class=\"hljs-keyword\">const</span> \u2026"
     * ```
     */
    export const exampleSources: Record<string, Record<string, CapturedSource>>;

    /** One statically-read non-UI (`.examples.ts`) example: source plus the
     *  metadata needed to list and filter it in the Code Reference section.
     *  These packages can't run in the browser, so they're never imported —
     *  only their authored source + declared `returns` are shown. */
    export interface CodeExample {
        /** Source package label, e.g. `east-py-datascience`. */
        package: string;
        /** `package/relative/path` (no extension) — unique per example file. */
        pathKey: string;
        /** Path within the package's test dir (no extension), e.g. `sql/sqlite`. */
        file: string;
        /** Exported `const` name of the example. */
        name: string;
        keywords: string[];
        description: string;
        /** Source text of the example's `returns` value (prettier-formatted). */
        returns: string;
        /** The example's `fn` body, formatted + highlighted. */
        source: CapturedSource;
    }

    /**
     * Flat list of every `.examples.ts` example across the monorepo's
     * non-UI packages (`scripts/example-roots.ts`), read statically at
     * build time. Sorted by `pathKey` then `name`.
     */
    export const codeExamples: CodeExample[];
}
