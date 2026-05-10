/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-patterns` — decision-quality UI patterns for East.
 *
 * @remarks
 * Pattern declarations only. Each pattern is an `EastUI.component` carrier
 * with a canonical East value-type schema. React renderers live in
 * `@elaraai/east-ui-patterns-components`.
 *
 * Family namespaces (Decision.*, Reference.*, Judgement.*, Stakes.*) collect
 * related patterns. Authors call `Decision.Brief.Root({ … })` to construct;
 * renderers register against `Decision.Brief.Component`.
 *
 * @packageDocumentation
 */

export * from "./decision/index.js";
export { Decision } from "./decision/index.js";
