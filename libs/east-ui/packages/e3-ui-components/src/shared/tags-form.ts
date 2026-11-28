/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row's tags as a popover's form edits them (#1758, #1762): a set of text,
 * as a saved query (`Query.Types.SavedQuery`) and a page (`Studio.Types.Entry`)
 * hold their `tags`, and the form whose one field is the tags box — the query
 * builder's Save popover's, and the page library's New page's.
 *
 * @packageDocumentation
 */

import { SetType, StringType, StructType, type ValueTypeOf } from "@elaraai/east";

/** A row's tags: a set of text, as both records hold them. */
export const TagsType = SetType(StringType);

/** A row's tags, as a value. */
export type Tags = ValueTypeOf<typeof TagsType>;

/** The form whose one field is the tags box. */
export const TagsFormType = StructType({ tags: TagsType });
