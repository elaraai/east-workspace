/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, ArrayType, StringType, StructType } from "@elaraai/east";
import { Pick } from "@elaraai/east-ui";
import * as ex from "./pick.examples.js";

/** One pickable thing — the smallest shape with an id and a name. */
const ITEM = StructType({ key: StringType, name: StringType });

/** The library under test. */
const LIBRARY = [
    { key: "machines", name: "Machine jobs" },
    { key: "load", name: "Line load" },
    { key: "crew", name: "Crew shifts" },
];

describeEast("Pick contract", (test) => {
    Assert.examples(test, {
        pickState: ex.pickState,
        pickVisibleAll: ex.pickVisibleAll,
        pickVisibleHidden: ex.pickVisibleHidden,
        pickVisibleStale: ex.pickVisibleStale,
        pickBindHandle: ex.pickBindHandle,
    });

    // ── The derivation ──────────────────────────────────────────────────
    // `Pick.active` is `Pick.visible` plus one tracked `State.bind` read, and
    // `TestImpl` carries no State runtime, so the SEMANTICS are proved here on
    // the state-free half. It is the same East function either way.

    test("an empty hidden list shows everything, in declaration order", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, []), ArrayType(ITEM));
        $(Assert.equal(shown.length(), 3n));
        $(Assert.equal(shown.get(0n).key, "machines"));
        $(Assert.equal(shown.get(2n).key, "crew"));
    });

    test("a hidden id drops exactly its own item", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["load"]), ArrayType(ITEM));
        $(Assert.equal(shown.length(), 2n));
        $(Assert.equal(shown.get(0n).key, "machines"));
        $(Assert.equal(shown.get(1n).key, "crew"));
    });

    test("hiding everything yields an empty list, not a fallback to all", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["machines", "load", "crew"]), ArrayType(ITEM));
        $(Assert.equal(shown.length(), 0n));
    });

    test("an id naming nothing is ignored — a rename does not break persisted state", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["defects", "gone"]), ArrayType(ITEM));
        $(Assert.equal(shown.length(), 3n));
    });

    test("an item the state never mentioned SHOWS — the reason state is hidden, not active", $ => {
        // State written when the library held only "machines" and "load".
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["machines"]), ArrayType(ITEM));
        // "crew" shipped later and is visible without anyone touching the state.
        $(Assert.equal(shown.length(), 2n));
        $(Assert.equal(shown.get(0n).key, "load"));
        $(Assert.equal(shown.get(1n).key, "crew"));
    });

    test("a duplicated hidden id is harmless (membership, not counting)", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        const shown = $.let(Pick.visible(all, idOf, ["load", "load", "load"]), ArrayType(ITEM));
        $(Assert.equal(shown.length(), 2n));
    });

    test("declaration order is preserved, not the hidden list's order", $ => {
        const all = $.const(LIBRARY, ArrayType(ITEM));
        const idOf = $.const(East.function([ITEM], StringType, (_$, item) => item.key));
        // Hiding the MIDDLE item must not reorder the survivors.
        const shown = $.let(Pick.visible(all, idOf, ["crew"]), ArrayType(ITEM));
        $(Assert.equal(shown.get(0n).key, "machines"));
        $(Assert.equal(shown.get(1n).key, "load"));
    });

    // ── The seed ────────────────────────────────────────────────────────

    test("Pick.state defaults to nothing hidden", $ => {
        const seed = $.const(Pick.state(), ArrayType(StringType));
        $(Assert.equal(seed.length(), 0n));
    });

    test("Pick.state carries the ids it was given", $ => {
        const seed = $.const(Pick.state(["a", "b"]), ArrayType(StringType));
        $(Assert.equal(seed.length(), 2n));
        $(Assert.equal(seed.get(0n), "a"));
    });
}, { platformFns: TestImpl });
