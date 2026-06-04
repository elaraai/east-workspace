/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * east-ui JSX tags — capitalized, React-style tags that wrap the east-ui
 * component factories so you can author with `<Box>…</Box>` JSX (in a `.tsx`
 * file) instead of `Box.Root([…], {…})`.
 *
 * Each tag takes a single props object: style props sit at the **top level**
 * (flat, like React — `<Box padding="4">`, `<Button variant="solid">`), and
 * nested elements arrive as `children`. Every tag returns the exact value its
 * factory returns, so JSX is pure authoring sugar over East IR.
 *
 * The tag modules under `./<category>/` mirror `src/<category>/` one-to-one.
 * Wrap any other east-ui factory yourself with {@link container} (children +
 * style), {@link content} (text content + style), or {@link leaf} (a typed
 * value prop + style).
 *
 * @packageDocumentation
 */

// Combinators + shared child types (for wrapping unlisted factories).
export { container, content, leaf, optionsTag, hasKeys } from "./combinators.js";
export type { JsxTag, ContainerProps, ContentProps, ValueProps, OptionsProps } from "./combinators.js";
export { coalesceChildren } from "./children.js";
export type { ContainerChildrenType } from "./children.js";
export type { UIElement } from "./runtime.js";

// Tags, by category — each module mirrors `src/<category>/`.
export * from "./layout/index.js";
export * from "./typography/index.js";
export * from "./display/index.js";
export * from "./forms/index.js";
export * from "./buttons/index.js";
export * from "./feedback/index.js";
export * from "./charts/index.js";
export * from "./container/index.js";
export * from "./disclosure/index.js";
export * from "./navigation/index.js";
export * from "./overlays/index.js";
export * from "./reactive/index.js";
