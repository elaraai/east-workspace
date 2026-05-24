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
}
