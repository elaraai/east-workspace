/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * When rows are from before a Save: the one rule a host that draws what a Save
 * landed reads its rows by (`EditSession.landed`).
 *
 * A Save's confirmation reads its entries by their keys. A host whose rows
 * are read apart from it — a paged source's pages, a window, a kind's cells —
 * holds them as they stood until they are read again at the revision the Save
 * committed: a round trip a deployed server makes long. Meanwhile it draws
 * each landed entry as the Save left it, and lets it go
 * (`EditSession.shown`) in the commit that draws rows read since, so no frame
 * draws the entry as it stood before.
 *
 * Rows are from before a Save while they were read at another revision than
 * the one their source reads at now: a read of them is in flight, or still to
 * be asked. A session holds what a Save landed only once its source has moved
 * past the revision the Save was drafted at, so rows read at the revision the
 * source reads at now hold the Save — but where a host hears its source's
 * revision later than its session did: a source still at the revision the
 * Save was drafted at holds nothing of it.
 *
 * A revision names its source's content and has no order, so the rule never
 * asks which of two came first, and never keeps the revisions that went
 * before: the same entry saved twice before its rows are read again, or rows
 * standing from before another session's write that the Save was drafted
 * over, are from before the Save by the same test.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";

const stringEqual = equalFor(StringType);

/**
 * Whether rows a host draws were read before a Save landed, so what the Save
 * landed is drawn over them (see the module docs).
 *
 * @param read - The revision the rows were read at
 * @param now - The revision their source reads at now; `undefined` while it names none
 * @param from - The revision the Save's request was drafted at (a `LandedEntry`'s `from`)
 * @returns Whether the rows are from before the Save
 */
export function readBeforeSave(read: string, now: string | undefined, from: string): boolean {
    return now === undefined || !stringEqual(read, now) || stringEqual(now, from);
}

/**
 * Whether rows a host draws were read before any of several Saves landed: a
 * kind's rows, over every entry Saves landed of the kind.
 *
 * @param read - The revision the rows were read at
 * @param now - The revision their source reads at now; `undefined` while it names none
 * @param froms - The revision each Save's request was drafted at
 * @returns Whether the rows are from before one of them; never, of no Save
 */
export function readBeforeSaves(read: string, now: string | undefined, froms: Iterable<string>): boolean {
    for (const from of froms) if (readBeforeSave(read, now, from)) return true;
    return false;
}
