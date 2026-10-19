/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The windowed arms of a collection's row source (#567) — `paged`; `pinned`,
 * which names its snapshot; and `live`, which names the narrowing it serves
 * too (#1354) — as a renderer reads them: one value, whose `revision` and
 * `refresh` are present only when the source is pinned or live, and whose
 * `query` only when it is live.
 *
 * A `paged` source serves the same rows under its id for as long as the
 * renderer holds it, so each window is read once. A `pinned` source says which
 * snapshot its windows belong to: the renderer follows it from one to the next,
 * keeping the rows it has on screen until the new snapshot's land (#821), and
 * it is the only windowed source a renderer edits (#880). A `live` source — a
 * rail's narrowed source — is a pinned one whose windows belong to a narrowing
 * as well: the renderer follows its `query` as it follows its revision
 * ({@link snapshotOf}), and edits it as a pinned one, by its revision alone.
 *
 * @packageDocumentation
 */

import { StringType, StructType, printFor, some, type option } from "@elaraai/east";

/** A decoded row source — the variant a collection's `rows` holds. */
interface RowsArm {
    readonly type: string;
    readonly value: unknown;
}

/** The `pinned` arm's value, of a decoded rows variant. */
type PinnedValue<R extends RowsArm> = Extract<R, { type: "pinned" }>["value"];

/** The `live` arm's value, of a decoded rows variant. */
type LiveValue<R extends RowsArm> = Extract<R, { type: "live" }>["value"];

/**
 * A windowed rows arm's value: the `paged` arm's members, with the `pinned`
 * arm's `revision` and `refresh` when the source names its snapshot, and the
 * `live` arm's `query` when it names its narrowing.
 *
 * @typeParam R - The decoded rows variant
 */
export type WindowedSourceValue<R extends RowsArm> =
    Extract<R, { type: "paged" }>["value"]
    & Partial<Pick<PinnedValue<R>, Extract<keyof PinnedValue<R>, "revision" | "refresh">>>
    & Partial<Pick<LiveValue<R>, Extract<keyof LiveValue<R>, "query">>>;

/**
 * The windowed source a rows arm carries.
 *
 * @typeParam R - The decoded rows variant
 * @param rows - A collection's decoded `rows`
 * @returns Any windowed arm's value — `revision` and `refresh` present only on
 *   a pinned or live one, `query` only on a live one — or `undefined` for the
 *   inline arm
 */
export function windowedSourceOf<R extends RowsArm>(rows: R): WindowedSourceValue<R> | undefined {
    return rows.type === "paged" || rows.type === "pinned" || rows.type === "live" ? rows.value as WindowedSourceValue<R> : undefined;
}

/** A windowed source's snapshot members, as {@link snapshotOf} reads them. */
interface SnapshotSource {
    /** The snapshot it serves; absent on a `paged` source. */
    readonly revision?: (() => option<string>) | undefined;
    /** The narrowing it serves; present on a `live` source alone. */
    readonly query?: (() => string) | undefined;
}

const printSnapshot = printFor(StructType({ revision: StringType, query: StringType }));

/**
 * The snapshot a windowed source's rows are read at (#1354): its revision,
 * and for a live source the narrowing it serves with it — what a reader that
 * keeps windows keys them by, reading them again, the rows it had standing in
 * until each lands (#821), when it moves. Editing keeps the revision alone: a
 * Save confirms against the record's state, whatever the narrowing.
 *
 * Both reads are tracked, so a reader reads this inside its tracked
 * evaluation, as it reads the source's windows.
 *
 * @param source - A windowed source's value
 * @returns The snapshot; `none` while the revision is found; `undefined` for a
 *   `paged` source, which names none — its rows are its id's
 */
export function snapshotOf(source: SnapshotSource): option<string> | undefined {
    if (source.revision === undefined) return undefined;
    const revision = source.revision();
    if (revision.type === "none" || source.query === undefined) return revision;
    return some(printSnapshot({ revision: revision.value, query: source.query() }));
}
