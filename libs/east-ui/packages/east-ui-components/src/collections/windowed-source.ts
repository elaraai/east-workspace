/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The windowed arms of a collection's row source (#567) — `paged`, and
 * `pinned`, which names its snapshot — as a renderer reads them: one value,
 * whose `revision` and `refresh` are present only when the source is pinned.
 *
 * A `paged` source serves the same rows under its id for as long as the
 * renderer holds it, so each window is read once. A `pinned` source says which
 * snapshot its windows belong to: the renderer follows it from one to the next,
 * keeping the rows it has on screen until the new snapshot's land (#821), and
 * it is the only windowed source a renderer edits (#880).
 *
 * @packageDocumentation
 */

/** A decoded row source — the variant a collection's `rows` holds. */
interface RowsArm {
    readonly type: string;
    readonly value: unknown;
}

/** The `pinned` arm's value, of a decoded rows variant. */
type PinnedValue<R extends RowsArm> = Extract<R, { type: "pinned" }>["value"];

/**
 * A windowed rows arm's value: the `paged` arm's members, with the `pinned`
 * arm's `revision` and `refresh` when the source names its snapshot.
 *
 * @typeParam R - The decoded rows variant
 */
export type WindowedSourceValue<R extends RowsArm> =
    Extract<R, { type: "paged" }>["value"]
    & Partial<Pick<PinnedValue<R>, Extract<keyof PinnedValue<R>, "revision" | "refresh">>>;

/**
 * The windowed source a rows arm carries.
 *
 * @typeParam R - The decoded rows variant
 * @param rows - A collection's decoded `rows`
 * @returns Either windowed arm's value — `revision` and `refresh` present only
 *   on a pinned one — or `undefined` for the inline arm
 */
export function windowedSourceOf<R extends RowsArm>(rows: R): WindowedSourceValue<R> | undefined {
    return rows.type === "paged" || rows.type === "pinned" ? rows.value as WindowedSourceValue<R> : undefined;
}
