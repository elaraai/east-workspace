/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tags as a record keeps them — what a saved query's and a Studio page's
 * `tags` are written through, so a record's index on them files an entry
 * under each tag once.
 *
 * @packageDocumentation
 */

import { East, SetType, StringType } from "@elaraai/east";

/**
 * Tags as they are kept: each without the spaces around it, once, and none
 * that is empty.
 *
 * @remarks
 * Every write of an entry's `tags` gives them through this, so a tag typed
 * with a space after it is the tag without it.
 */
export const keptTags = East.function(
    [SetType(StringType)],
    SetType(StringType),
    (_$, tags) => tags.toSet((_$2, tag) => tag.trim()).filter((_$2, tag) => tag.notEqual("")),
);
