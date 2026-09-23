/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The symbols a compiled East function value carries. They live in their own
 * module so a reader of function values (the comparators) need not import the
 * compiler that attaches them; `compile.ts` re-exports them.
 *
 * @packageDocumentation
 */

/**
 * Symbol used to attach source IR to compiled functions.
 * This enables serialization of free functions (functions with no captures).
 */
export const EAST_IR_SYMBOL = Symbol.for("east.ir");

/**
 * Symbol used to attach capture values to compiled functions.
 * This enables serialization of closures (functions with captures).
 */
export const EAST_CAPTURES_SYMBOL = Symbol.for("east.captures");

/**
 * Symbol used to attach source map to compiled functions.
 * Enables encoding location stacks into beast2 source_map_section.
 */
export const EAST_SOURCE_MAP_SYMBOL = Symbol.for("east.source_map");
