/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, East, IntegerType, NullType, OptionType, StringType, StructType, equalFor, some, none } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Table } from "@elaraai/east-ui/internal";
import { buildRowSource, resolveRowSource } from "../../src/contracts/source.js";

// The row-source contract (#567) as a component consumes it. Paged data is
// bound — `Data.bindPaged` in @elaraai/e3-ui produces it — so no package
// produces one, and every source below is built by hand to the contract over a
// module-scope fixture: an East body never calls a host helper (east 990020).

/** A 50-row positional fixture — wide enough that a window is a genuine window. */
const WideRow = StructType({ id: StringType, n: IntegerType });
const WideRows = ArrayType(WideRow);
const WIDE_ROWS = Array.from({ length: 50 }, (_, i) => ({
    id: `r${String(i).padStart(2, "0")}`, n: BigInt(i),
}));

/** At most this many elements a window, whatever is asked for — as e3 trims a
 *  dataset's pages of wide elements to its byte budget (#829). */
const TRIM = 7n;

const TRIMMED_ROWS_PAGE = East.function([IntegerType, IntegerType], OptionType(WideRows), ($, offset, limit) => {
    const all = $.const(WIDE_ROWS, WideRows);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const served = $.let(limit.less(TRIM).ifElse(() => limit, () => TRIM));
    const end = $.let(start.add(served).less(n).ifElse(() => start.add(served), () => n));
    return some(all.slice(start, end));
});
const WIDE_ROWS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(WIDE_ROWS, WideRows);
    return some(all.size());
});
const TRIMMED_ROWS = { id: "trimmed-rows", page: TRIMMED_ROWS_PAGE, total: WIDE_ROWS_TOTAL, seek: none };

/** A source that trims to 7 and has only its first piece in hand — every later
 *  piece is still on the wire, so it reads `none`. */
const FIRST_PIECE_ONLY_PAGE = East.function([IntegerType, IntegerType], OptionType(WideRows), ($, offset, limit) => {
    const all = $.const(WIDE_ROWS, WideRows);
    const piece = $.let(none, OptionType(WideRows));
    const served = $.let(limit.less(TRIM).ifElse(() => limit, () => TRIM));
    $.if(offset.equal(0n), ($2) => { $2.assign(piece, some(all.slice(0n, served))); });
    return piece;
});
const IN_FLIGHT = { id: "slow", page: FIRST_PIECE_ONLY_PAGE, total: WIDE_ROWS_TOTAL, seek: none };

/** Two sources over the same closures, told apart by their ids alone. */
const OPS_SOURCE = { id: "inputs.ops", page: TRIMMED_ROWS_PAGE, total: WIDE_ROWS_TOTAL, seek: none };
const OTHER_SOURCE = { id: "inputs.other", page: TRIMMED_ROWS_PAGE, total: WIDE_ROWS_TOTAL, seek: none };

describeEast("Row-source contract (#567)", (test) => {
    test("two sources at different ids compare UNEQUAL — the memo discriminator", $ => {
        // East compares every function as equal, so a source of nothing but
        // closures is indistinguishable from any other and a memoized
        // component would never re-render on a swap. `id` is what makes the
        // value comparable at all.
        const a = $.let(OPS_SOURCE, Paged.Types.Source(WideRows));
        const b = $.let(OTHER_SOURCE, Paged.Types.Source(WideRows));
        $(Assert.equal(East.equal(a, b), false));
        $(Assert.equal(East.equal(a, a), true));
    });

    // ── Trimmed sources (#829) ───────────────────────────────────────────
    // A source may serve FEWER elements than a window asks for while it still
    // has more — e3 trims every page to a byte budget. Every component's
    // derived `page` must still hand its renderer WHOLE windows, or a window's
    // tail is never asked for.

    test("a Table over a trimmed ARRAY source gets WHOLE windows — the tail is read, not dropped", $ => {
        const src = $.const(TRIMMED_ROWS, Paged.Types.Source(WideRows));
        // The source serves short: 20 asked, 7 served, though it has more.
        $(Assert.equal(src.page(0n, 20n).unwrap("some").length(), 7n));
        const table = $.let(Table.Root(src, ["id", "n"]));
        const derived = $.let(table.unwrap().unwrap("Table").rows.unwrap("paged"));
        // The derived window re-requests the rest, three pieces deep, and
        // hands back all 20.
        const w0 = $.let(derived.page(0n, 20n));
        $(Assert.equal(w0.unwrap("some").length(), 20n));
        // The next window starts at 20 — nothing between 7 and 19 was lost.
        const w1 = $.let(derived.page(20n, 20n));
        $(Assert.equal(w1.unwrap("some").length(), 20n));
        $(Assert.equal(w1.unwrap("some").get(0n).cells.get("id").unwrap("String"), "r20"));
        // The final window is partial (the source ends), and past the end is
        // the EMPTY window — never `none`.
        const w2 = $.let(derived.page(40n, 20n));
        $(Assert.equal(w2.unwrap("some").length(), 10n));
        const past = $.let(derived.page(60n, 20n));
        $(Assert.equal(past.unwrap("some").length(), 0n));
    });

    // e3-ui's Plan over a trimmed keyed source is held to the same in its own
    // specs (`test/plan/plan-source.spec.ts`).

    test("a piece still in flight holds the whole derived window at `none`", $ => {
        const src = $.const(IN_FLIGHT, Paged.Types.Source(WideRows));
        const table = $.let(Table.Root(src, ["id", "n"]));
        const derived = $.let(table.unwrap().unwrap("Table").rows.unwrap("paged"));
        // Serving the landed 7 as the window would drop 8…19 for good; the
        // window waits, and re-fires when the piece lands.
        $(Assert.equal(derived.page(0n, 20n).hasTag("none"), true));
        // A window the landed piece covers on its own is whole already.
        $(Assert.equal(derived.page(0n, 5n).unwrap("some").length(), 5n));
    });
}, { platformFns: TestImpl });

// ── The two windowed arms (#744, #821) ───────────────────────────────────────

/** A pinned fixture serves one snapshot for good: a refresh to it, or to
 *  whatever it holds now, keeps it, and any other target has nowhere to go. */
const SNAPSHOT_REVISION = East.function([], OptionType(StringType), () => some("snapshot"));
const SNAPSHOT_REFRESH = East.function([OptionType(StringType)], NullType, ($, target) => {
    $.match(target, {
        some: ($2, revision) => {
            $2.if(revision.notEqual("snapshot"), ($3) => {
                $3.error(East.str`no snapshot ${revision}: this source serves "snapshot" alone`);
            });
        },
    });
});
const PINNED_ROWS = {
    id: "snapshot", page: TRIMMED_ROWS_PAGE, total: WIDE_ROWS_TOTAL, seek: none,
    revision: SNAPSHOT_REVISION, refresh: SNAPSHOT_REFRESH,
};
const RELEASED_ROWS = { id: "released", page: TRIMMED_ROWS_PAGE, total: WIDE_ROWS_TOTAL, seek: none };

const pageEqual = equalFor(OptionType(WideRows));
const revisionEqual = equalFor(OptionType(StringType));

describe("Paged sources and their snapshots — paged and pinned (#744, #821)", () => {
    hostTest("a pinned source builds the `pinned` arm, its id kept and its lifecycle forwarded with the handle's closures", () => {
        const program = East.function([], Paged.Types.RowSource(WideRows), ($) => {
            const source = $.let(PINNED_ROWS, Paged.Types.PinnedSource(WideRows));
            return buildRowSource(resolveRowSource(source, "fixture"), WideRows, r => r as never);
        });
        const value = East.compile(program, [])();
        assert.equal(value.type, "pinned");
        if (value.type !== "pinned") return;
        // The id names the logical source; what `make` serves is told apart by
        // comparing the derived source whole (#809), not by a signed id (#822).
        assert.equal(value.value.id, "snapshot");
        // The handle's own revision and refresh, carried through as they are.
        assert.ok(revisionEqual(value.value.revision(), some("snapshot")));
        value.value.refresh(none);
        value.value.refresh(some("snapshot"));
        assert.throws(() => value.value.refresh(some("other")), /no snapshot other: this source serves "snapshot" alone/);
        // The derived page serves whole windows over the trimmed handle.
        assert.ok(pageEqual(value.value.page(0n, 10n), some(WIDE_ROWS.slice(0, 10))));
    });

    hostTest("a source that names no snapshot builds the `paged` arm — nothing invented for it", () => {
        const program = East.function([], Paged.Types.RowSource(WideRows), ($) => {
            const source = $.let(RELEASED_ROWS, Paged.Types.Source(WideRows));
            return buildRowSource(resolveRowSource(source, "fixture"), WideRows, r => r as never);
        });
        const value = East.compile(program, [])();
        assert.equal(value.type, "paged");
        if (value.type !== "paged") return;
        // `id`, `page`, `total`, `seek`: what exported UIs carry, and nothing more.
        assert.deepEqual(Object.keys(value.value).sort(), ["id", "page", "seek", "total"]);
        assert.ok(pageEqual(value.value.page(48n, 10n), some(WIDE_ROWS.slice(48))));
    });
});
