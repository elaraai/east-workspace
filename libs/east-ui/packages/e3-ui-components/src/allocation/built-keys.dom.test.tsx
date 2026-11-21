/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * A board whose bin kind builds each bin's key from its row (`key`,
 * east-workspace#1709), over the smallest board's bins on e3 itself: a bin
 * keyed by its bay and how many kilns it is linked to. Unlinked, a bin moves
 * under the key it then builds, still selected, and Save writes it there; a
 * second bin of the bay, unlinked, would build that key too, and is refused,
 * the board saying whose key it is. And a bin the board adds — an arrival
 * booked into a free slot — under each of the other two options a kind takes:
 * keyed by the app's own rule (`newKey`), and, over bins with a code of their
 * own, holding the key its session makes in that field (`keyField`).
 */
import { expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { DictType, East, SetType, SortedMap, StringType, StructType, compareFor, equalFor, some, variant, type ExprType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Func, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import * as fx from "@elaraai/e3-ui/fixtures/allocation/allocation-bounds";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { TUE } from "./harness.test-utils.js";
import { button, card, details, press, save, tableRow } from "./inspector.test-utils.js";

/** A bin with a code of its own, which its key is held in (`keyField`), beside the board's roles. */
const CodedBin = StructType({ ...fx.MoistureBin.fields, code: StringType });
/** The coded bins: none yet. */
const codedBins = e3.record("kiln_coded_bins", DictType(StringType, CodedBin), {
    initial: new SortedMap([], compareFor(StringType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = e3Harness({ "allocation/allocation": ex, "allocation/allocation-bounds": fx, "allocation/key-field": { codedBins } }, { main: "data-allocation-main" });
const sameBin = equalFor(fx.MoistureBin);
const sameKey = equalFor(StringType);

/** How a test's board keys its bins: by the key a bin's row builds, or by the app's own rule — the next `N-<n>`. */
type BinKeys = { readonly key: (bin: ExprType<typeof fx.MoistureBin>) => ExprType<StringType> } | { readonly newKey: true };

/**
 * The smallest board over the moisture bins, keyed as a test says.
 *
 * @param keys - How the bins are keyed
 * @param layout - The layout it opens in
 * @returns The example
 */
const yardKeyed = (keys: BinKeys, layout: "timeline" | "table") => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const bins = $.let(Record.bind(fx.moistureBins, ["patch"]));
    const loads = $.let(Data.bind(ex.arrivals));
    const yard = $.let(Data.bind(ex.kilns));
    const bays = $.let(Data.bind(ex.yardBays));
    const fit = $.let(Func.bind(fx.moistureFit));
    return Allocation({
        id: "keyedYard", fit, inspector: true, view: { layout, date: TUE },
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box",
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            ...("newKey" in keys ? { newKey: $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`N-${taken.size().add(1n)}`)) } : keys),
        }) },
        resources: {
            bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
            kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
        },
        arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
    });
}))) });

/** The smallest board over the bins, each keyed by its bay and the kilns it is linked to: `B-2/1`. */
const keyedYard = yardKeyed({ key: (bin) => East.str`${bin.bay}/${bin.kilns.size()}` }, "timeline");

/** The smallest board's table over the coded bins, each holding its key in its code. */
const codedYard = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const bins = $.let(Record.bind(codedBins, ["patch"]));
    const loads = $.let(Data.bind(ex.arrivals));
    const yard = $.let(Data.bind(ex.kilns));
    const bays = $.let(Data.bind(ex.yardBays));
    const fit = $.let(Func.bind(fx.moistureFit));
    return Allocation({
        id: "codedYard", fit, inspector: true, view: { layout: "table", date: TUE },
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box",
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", keyField: "code",
        }) },
        resources: {
            bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
            kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
        },
        arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), values: () => ({ moisture: 12.0, code: "" }) }),
    });
}))) };

/** Books the arrival LD-2235 into bay B-1's free slot at 00:15, from the slot's Details. */
async function book(c: HTMLElement): Promise<void> {
    await waitFor(() => expect(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000")).not.toBeNull());
    await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
    await press(button(details(c).querySelector<HTMLElement>('[data-allocation-option="arrival:LD-2235"]')!, "Book"));
}

test("ruling 1 — told the app's rule (`newKey`), an arrival booked into a free slot is a bin keyed by it — the next N-n, never a key made up — and Save writes it there", async () => {
    const { container: c } = await h.mount(yardKeyed({ newKey: true }, "table"));
    const before = await h.read(fx.moistureBins);
    await book(c);
    const made = `N-${before.size + 1}`;
    expect(tableRow(c, `bin:${made}`)).not.toBeNull();
    await press(save(c));
    await waitFor(async () => expect((await h.read(fx.moistureBins)).has(made)).toBe(true));
    const saved = await h.read(fx.moistureBins);
    expect([saved.size, saved.get(made)!.bay, saved.get(made)!.load]).toEqual([before.size + 1, "B-1", some("LD-2235")]);
});

test("ruling 1 — holding its key in a field (`keyField`), an arrival booked into a free slot is a bin holding its own key in its code from the first, and Save writes it so", async () => {
    const { container: c } = await h.mount(codedYard);
    await book(c);
    await press(save(c));
    await waitFor(async () => expect((await h.read(codedBins)).size).toBe(1));
    const rows = await h.read(codedBins);
    const [key] = [...rows.keys()];
    const bin = rows.get(key!)!;
    expect([sameKey(bin.code, key!), bin.bay]).toEqual([true, "B-1"]);
});

test("ruling 1 — a bin unlinked moves under the key its bay and its links then build, still selected; a second bin of the bay, which would build that key too, is refused, the board saying whose key it is; and Save writes the bin under its new key", async () => {
    const { container: c } = await h.mount(keyedYard);
    await waitFor(() => expect(card(c, "3113")).not.toBeNull());
    const before = await h.read(fx.moistureBins);
    // 3113 stands in bay B-2, linked to one kiln: unlinked, its row builds B-2/0.
    await press(card(c, "3113"));
    await press(button(details(c), "Unlink"));
    expect([card(c, "3113"), card(c, "B-2/0") !== null]).toEqual([null, true]);
    // Its Details are open on it still: what it holds is unallocated, and can be linked again.
    expect(details(c).querySelector("[data-allocation-bin-actions]")).not.toBeNull();
    // 3115 stands in B-2 too, on one kiln: unlinked, it would build B-2/0 as well.
    await press(card(c, "3115"));
    await press(button(details(c), "Unlink"));
    expect([...c.querySelectorAll("[role='alert']")].map(alert => alert.textContent)).toContain('Another bin is keyed "B-2/0" already');
    await press(save(c));
    await waitFor(async () => expect((await h.read(fx.moistureBins)).has("B-2/0")).toBe(true));
    const saved = await h.read(fx.moistureBins);
    expect([saved.has("3113"), saved.get("B-2/0")!.kilns.size, sameBin(saved.get("3115")!, before.get("3115")!), saved.size]).toEqual([false, 0, true, before.size]);
});
