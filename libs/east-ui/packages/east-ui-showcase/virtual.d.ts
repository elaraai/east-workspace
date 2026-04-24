/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

declare module "virtual:example-sources" {
    /**
     * Captured authored source of the `fn` property for every
     * `export const X = example({...})` declaration in the east-ui test
     * tree, keyed by relative-path-without-extension → export name.
     *
     * @example
     * ```ts
     * import { exampleSources } from "virtual:example-sources";
     * // "East.function([], UIComponentType, ($) => Button.Root(\"Click me\"))"
     * const src = exampleSources["buttons/button"]?.["buttonBasic"];
     * ```
     */
    export const exampleSources: Record<string, Record<string, string>>;
}
