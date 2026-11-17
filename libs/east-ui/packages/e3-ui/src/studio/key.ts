/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio page's key (#992): what the pages record is keyed by, and what a
 * visual's click that opens a page names (#1669).
 *
 * @packageDocumentation
 */

import { StringType, StructType } from "@elaraai/east";

/**
 * A page's key: the project it belongs to, and its name in the project. A
 * project's pages are one contiguous run in key order.
 *
 * @property project - The project
 * @property page - The page's name in the project
 */
export const StudioKeyType = StructType({
    project: StringType,
    page: StringType,
});

/** Type representing a page's key. */
export type StudioKeyType = typeof StudioKeyType;
