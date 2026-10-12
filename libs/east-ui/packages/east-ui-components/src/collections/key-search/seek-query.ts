/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key search's query as the East value a keyed paged source's `seek` is
 * asked (`SeekQueryType`) — for every component that mounts
 * `<DatasetKeySearch>` over such a source: the Sheet's key search here, and
 * e3-ui-components' Plan (#1177).
 *
 * @packageDocumentation
 */

import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "@elaraai/east-ui";
import type { DatasetKeyQuery } from "@elaraai/east-ui/internal";

/** A decoded key query — what a source's `seek` is asked. */
export type SeekQueryValue = ValueTypeOf<SeekQueryType>;

/** The East `SeekQueryType` value for a control query — the inverse of the
 *  runtime's `toFindQuery`, so one vocabulary crosses the whole path, typed by
 *  the East type the source's `seek` declares (#743 item 7). */
export function toSeekQuery(query: DatasetKeyQuery): SeekQueryValue {
    if ("key" in query) return variant("key", query.key);
    if ("prefix" in query) return variant("prefix", query.prefix);
    if ("from" in query || "to" in query) {
        return variant("range", { from: [...(query.from ?? [])], to: [...(query.to ?? [])] });
    }
    return variant("fields", {
        values: [...query.fields],
        prefix: query.prefix !== undefined ? some(query.prefix) : none,
    });
}
