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
 * own, holding the key its session makes in that field (`keyField`); and over
 * bins keyed by number, with neither, one past the largest (ruling 10). Over
 * bins keyed by number, the board asks a fit made over their key type, naming
 * each bin by its number, and reads each verdict its answer gives a bin by its
 * number (ruling 12). A free slot's Reserve list asks it of a reservation under
 * the key Reserve there would make — the next number, or the number its row
 * builds — the day with it a draft of the bins under that number, and says so
 * where the bins' rule makes none (ruling 13): the key made once for the
 * drafts, however often the list draws.
 */
import { expect, test, vi } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { DictType, East, IntegerType, SetType, SortedMap, StringType, StructType, compareFor, equalFor, none, some, variant, type ExprType, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Func, Record, Schedule, type KindRowKeys } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import * as fx from "@elaraai/e3-ui/fixtures/allocation/allocation-bounds";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import { TUE, slot } from "./harness.test-utils.js";
import { button, cancel, card, connector, details, hover, libraryCard, press, row, save, tableRow } from "./inspector.test-utils.js";

/** A bin with a code of its own, which its key is held in (`keyField`), beside the board's roles. */
const CodedBin = StructType({ ...fx.MoistureBin.fields, code: StringType });
/** The coded bins: none yet. */
const codedBins = e3.record("kiln_coded_bins", DictType(StringType, CodedBin), {
    initial: new SortedMap([], compareFor(StringType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/** Bins keyed by number, as the app counts them: none until a test writes some; by their time, which their fit reads a day of them through. */
const numberedBins = e3.record("kiln_numbered_bins", DictType(IntegerType, fx.MoistureBin), {
    initial: new SortedMap([], compareFor(IntegerType)),
    indexes: (index) => ({ kiln_numbered_bins_by_time: index.interval({ from: "at", to: "at" }) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/**
 * Their fit (ruling 12): the built-in rules over the day's bins, read through their own index, the board's unsaved bins
 * among them — its question, what it read and its answer each made over the bins' key type, a bin named by its number.
 */
const numberedFit = e3.function("yard_numbered_fit", {
    inputs: [e3.index(numberedBins.indexes.kiln_numbered_bins_by_time), numberedBins, ex.kilns, ex.arrivals],
    drafts: [numberedBins],
    args: [Allocation.Types.FitRequest({ key: IntegerType })],
    output: Allocation.Types.FitResult({ key: IntegerType }),
}, ($, binsByTime, bins, kilnRows, loadRows, request) => {
    const day = $.let(new Map(), DictType(IntegerType, Schedule.Types.AllocationRoles));
    binsByTime.overlapping({ from: request.day, to: request.day.addDays(1n) }).each($, ($2, _carried, key) => {
        const bin = $2.const(bins.get(key));
        $2(day.insert(key, { at: bin.at, lane: bin.bay, arrival: bin.load, quantity: bin.m3, parts: bin.kilns, hold: bin.dryFor, kind: none }));
    });
    const kiln = $.const(ex.minimalKilnOf);
    const load = $.const(ex.minimalLoadOf);
    const read = $.const({
        bins: day, arrivals: loadRows.map((_$2, l, key) => load(l, key)), resources: kilnRows.map((_$2, k, key) => kiln(k, key)), rules: { under: true }, unit: "m³",
    }, Allocation.Types.FitContext({ key: IntegerType }));
    const answer = $.const(Allocation.answer({ key: IntegerType }));
    const rule = $.const(Allocation.fit({ key: IntegerType }));
    return answer(request, read, rule, "ranked by load, kind and spare days");
});

const h = e3Harness({ "allocation/allocation": ex, "allocation/allocation-bounds": fx, "allocation/key-field": { codedBins, numberedBins, numberedFit } },
    { main: "data-allocation-main" });
/** The numbered bins' fit, as the board asks it: a bin by its number. */
const numberedCalls = fitCalls(h, { request: Allocation.Types.FitRequest({ key: IntegerType }), result: Allocation.Types.FitResult({ key: IntegerType }) });
const sameBin = equalFor(fx.MoistureBin);
const sameKey = equalFor(StringType);

/**
 * How a test's board keys its bins: by the key a bin's row builds, or by the app's own rule — the next `N-<n>`; or, over
 * the bins keyed by number, by the options given at their key type.
 */
type BinKeys = { readonly key: (bin: ExprType<typeof fx.MoistureBin>) => ExprType<StringType> } | { readonly newKey: true }
    | { readonly numbered: KindRowKeys<typeof fx.MoistureBin, IntegerType> };
/** What a test's board is over: the bins and their fit, and whether it has the Library. */
interface Over {
    readonly bins: typeof fx.moistureBins | typeof numberedBins;
    readonly fit: typeof fx.moistureFit | typeof numberedFit;
    readonly library?: boolean;
}

/**
 * The smallest board over the moisture bins, or other bins of their row, keyed as a test says.
 *
 * @param keys - How the bins are keyed; `undefined`, by the board
 * @param layout - The layout it opens in
 * @param over - The bins and their fit: the moisture bins and theirs, or the bins keyed by number and theirs; and the Library
 * @returns The example
 */
const yardKeyed = (keys: BinKeys | undefined, layout: "timeline" | "table", over: Over = { bins: fx.moistureBins, fit: fx.moistureFit }) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const bins = $.let(Record.bind(over.bins as typeof fx.moistureBins, ["patch"]));
    const loads = $.let(Data.bind(ex.arrivals));
    const yard = $.let(Data.bind(ex.kilns));
    const bays = $.let(Data.bind(ex.yardBays));
    const fit = $.let(Func.bind(over.fit as typeof fx.moistureFit));
    return Allocation({
        id: "keyedYard", fit, inspector: true, view: { layout, date: TUE },
        ...(over.library === true ? { library: [Allocation.library.arrivals(), Allocation.library.resources()] } : {}),
        events: { bin: Schedule.events(bins, {
            name: "Bin", icon: "box",
            at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            ...(keys === undefined ? {} : "newKey" in keys ? { newKey: $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`N-${taken.size().add(1n)}`)) }
                // The bins keyed by number stand in the moisture bins' binding above: the page holds their options to their own key type.
                : "numbered" in keys ? keys.numbered as unknown as KindRowKeys<typeof fx.MoistureBin> : keys),
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

/** Selects bay B-1's free slot at 00:15: its Details book an arrival there, and reserve a kiln. */
async function selectSlot(c: HTMLElement): Promise<void> {
    await waitFor(() => expect(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000")).not.toBeNull());
    await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
}

/** Books the arrival LD-2235 into bay B-1's free slot at 00:15, from the slot's Details. */
async function book(c: HTMLElement): Promise<void> {
    await selectSlot(c);
    await press(button(details(c).querySelector<HTMLElement>('[data-allocation-option="arrival:LD-2235"]')!, "Book"));
}

/** Two of the yard's bins, numbered 3 and 7, a week before the day the board opens on: the day holds none. */
async function numberedWeekBefore(): Promise<void> {
    const [first, second] = [...(await h.read(fx.moistureBins)).values()];
    const weekBefore = (row: ValueTypeOf<typeof fx.MoistureBin>) => ({ ...row, at: new Date(row.at.getTime() - 7 * 86_400_000) });
    await h.patch(numberedBins, new SortedMap([[3n, weekBefore(first!)], [7n, weekBefore(second!)]], compareFor(IntegerType)));
}

/** The numbered bins' fit's latest question of a kind, and the drafts its call carried. */
function latestCall(type: "place" | "take") {
    const requests = numberedCalls.requests(numberedFit.name), drafts = numberedCalls.drafts(numberedFit.name);
    const at = requests.map((request) => request.ask.type).lastIndexOf(type);
    return at < 0 ? undefined : { ask: requests[at]!.ask, drafts: drafts[at]! };
}

/** A free slot's Reserve list's first kiln, once the fit's answer has ranked them. */
const firstReserve = (c: HTMLElement) => details(c).querySelector<HTMLElement>("[data-allocation-reserve] [data-allocation-option]");

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

test("ruling 10 — over bins keyed by number, an arrival booked into a free slot is a bin one past the largest number the record holds — 8, past 3 and 7 a week before, never a key made up — and Save writes it there", async () => {
    await numberedWeekBefore();
    const { container: c } = await h.mount(yardKeyed(undefined, "table", { bins: numberedBins, fit: numberedFit }));
    await book(c);
    expect(tableRow(c, "bin:8")).not.toBeNull();
    await press(save(c));
    await waitFor(async () => expect((await h.read(numberedBins)).has(8n)).toBe(true));
    const saved = await h.read(numberedBins);
    expect([[...saved.keys()], saved.get(8n)!.bay, saved.get(8n)!.load]).toEqual([[3n, 7n, 8n], "B-1", some("LD-2235")]);
});

test("ruling 12 — over bins keyed by number, the board asks its fit of a bin by its number, and reads each verdict the answer gives a bin by its number: a bin dragged onto a kiln, and a kiln onto a bin", async () => {
    // Two of the yard's bins on the plan day, numbered 3 and 7.
    const [first, second] = [...(await h.read(fx.moistureBins)).values()];
    await h.patch(numberedBins, new SortedMap([[3n, first!], [7n, second!]], compareFor(IntegerType)));
    const { container: c } = await h.mount(yardKeyed(undefined, "timeline", { bins: numberedBins, fit: numberedFit, library: true }));
    await waitFor(() => expect(card(c, "3")).not.toBeNull());
    const caption = () => document.querySelector("[data-drag-caption]")?.textContent;
    const answerTo = (type: "place" | "take") => numberedCalls.answers(numberedFit.name).find(answer => answer.ask.type === type);
    // Bin 3 over K-101, which takes too little for its 35 m³: the fit is asked where bin 3 can go, by its number, and the
    // caption is its answer's refusal of K-101.
    await hover(connector(c, "3"), row(c, "K-101"));
    await waitFor(() => expect(answerTo("place")).toBeDefined());
    expect(numberedCalls.requests(numberedFit.name).find(request => request.ask.type === "place")?.ask)
        .toEqual(variant("place", { subject: variant("bin", 3n), quantity: first!.m3 }));
    const onKiln = answerTo("place")!.resources.get("K-101")!;
    expect(onKiln.type).toBe("refused");
    await waitFor(() => expect(caption()).toBe(onKiln.type === "refused" ? onKiln.value.reason : undefined));
    await cancel();
    // K-101 over bin 3: what K-101 takes, its answer naming each of the day's bins by its number — bin 3's verdict the caption.
    await press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith("Resources")));
    await hover(libraryCard(c, "K-101"), card(c, "3"));
    await waitFor(() => expect(answerTo("take")).toBeDefined());
    const take = answerTo("take")!;
    const onBin = take.bins.get(3n)!;
    expect([[...take.bins.keys()], onBin.type]).toEqual([[3n, 7n], "refused"]);
    await waitFor(() => expect(caption()).toBe(onBin.type === "refused" ? onBin.value.reason : undefined));
    await cancel();
});

test("ruling 13 — over bins keyed by number, a free slot's Reserve list is the fit's answer for a reservation under the key Reserve there would make — 8, past 3 and 7 — the day with it a draft under that number; and the reservation made, its Book list asks of the day without it, a draft under its number", async () => {
    await numberedWeekBefore();
    const { container: c } = await h.mount(yardKeyed(undefined, "table", { bins: numberedBins, fit: numberedFit }));
    const patch = { record: numberedBins.name, mutation: "patch" };
    // B-1's free slot at 00:15: nothing is unsaved, so the day with the reservation on it is the call's one draft.
    await selectSlot(c);
    await waitFor(() => expect(firstReserve(c)).not.toBeNull());
    expect([latestCall("place")?.ask, latestCall("place")?.drafts]).toEqual([variant("place", { subject: variant("bin", 8n), quantity: 0 }), [patch]]);
    // Reserved on the first kiln the list ranks: the reservation is bin 8, and what its kiln takes is asked of the day
    // without it — the pending Save adding it, then the day's change taking it away, each a draft the record takes.
    await press(button(firstReserve(c)!, "Reserve"));
    await waitFor(() => expect(tableRow(c, "bin:8")).not.toBeNull());
    const book = () => details(c).querySelector<HTMLElement>("[data-allocation-book]")?.textContent ?? "";
    await waitFor(() => expect(latestCall("take")).toBeDefined());
    await waitFor(() => expect(book()).not.toContain("checking fits…"));
    expect([latestCall("take")?.drafts, book().includes("fits unavailable")]).toEqual([[patch, patch], false]);
});

test("ruling 13 — over bins keyed by the number their rows build, a free slot's reservation stands under the number its row builds — 100, on no kiln — as Reserve would make it", async () => {
    await numberedWeekBefore();
    const { container: c } = await h.mount(yardKeyed({ numbered: { key: (bin) => bin.kilns.size().add(100n) } }, "table", { bins: numberedBins, fit: numberedFit }));
    await selectSlot(c);
    await waitFor(() => expect(firstReserve(c)).not.toBeNull());
    expect(latestCall("place")?.ask).toEqual(variant("place", { subject: variant("bin", 100n), quantity: 0 }));
});

test("ruling 13 — over bins keyed by number whose rule gives a key a bin holds, a free slot's Reserve list says a reservation there has no key until it is made, and asks the fit nothing of it", async () => {
    // Bins 3 and 7 on the plan day, and a rule that gives 3 whatever it is told is taken.
    const [first, second] = [...(await h.read(fx.moistureBins)).values()];
    await h.patch(numberedBins, new SortedMap([[3n, first!], [7n, second!]], compareFor(IntegerType)));
    const { container: c } = await h.mount(yardKeyed({ numbered: { newKey: East.function([SetType(IntegerType)], IntegerType, (_$, _taken) => 3n) } }, "table",
        { bins: numberedBins, fit: numberedFit }));
    await selectSlot(c);
    const reserve = () => details(c).querySelector<HTMLElement>("[data-allocation-reserve]")?.textContent ?? "";
    await waitFor(() => expect(reserve()).toContain("fits unavailable · a reservation here has no key until it is made"));
    expect([firstReserve(c), latestCall("place")]).toEqual([null, undefined]);
});

test("ruling 13 — over bins keyed by number, the key a free slot's reservation stands under is made once for the drafts, however often its Details draw: a rule that fails is asked once, and said once", async () => {
    const [first, second] = [...(await h.read(fx.moistureBins)).values()];
    await h.patch(numberedBins, new SortedMap([[3n, first!], [7n, second!]], compareFor(IntegerType)));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        const { container: c } = await h.mount(yardKeyed({ numbered: { newKey: East.function([SetType(IntegerType)], IntegerType, ($, _taken) => {
            $.error("no number is free");
            return 0n;
        }) } }, "table", { bins: numberedBins, fit: numberedFit }));
        await selectSlot(c);
        const reserve = () => details(c).querySelector<HTMLElement>("[data-allocation-reserve]")?.textContent ?? "";
        await waitFor(() => expect(reserve()).toContain("a reservation here has no key until it is made"));
        const failures = () => logged.mock.calls.filter((call) => sameKey(call[0] as string, "[Schedule] Bin's newKey failed: nothing was added:")).length;
        const asked = failures();
        // Its Details drawn again and again: the slot pressed once more, three times.
        for (let i = 0; i < 3; i++) await press(tableRow(c, "slot:B-1|2027-05-11T00:15:00.000").querySelector("span"));
        expect([asked, failures()]).toEqual([1, 1]);
    } finally {
        logged.mockRestore();
    }
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

test("ruling 1 — a bin an edit moves under another key is the bin it was, edited: its Details name it by its key, pending, never a new bin; and Revert brings it back under the key the day holds it by, as it was, though its row builds another", async () => {
    const { container: c } = await h.mount(keyedYard);
    await waitFor(() => expect(card(c, "3113")).not.toBeNull());
    const before = await h.read(fx.moistureBins);
    // 3113 is stored apart from the key its row builds, B-2/1: unlinked, it moves under B-2/0.
    await press(card(c, "3113"));
    await press(button(details(c), "Unlink"));
    expect([details(c).querySelector("[data-inspector-kind]")?.textContent, details(c).querySelector("[data-state]")?.getAttribute("data-state")])
        .toEqual(["Bin B-2/0", "pending"]);
    await press(button(details(c), "Revert"));
    expect([card(c, "3113") !== null, card(c, "B-2/0"), card(c, "B-2/1")]).toEqual([true, null, null]);
    await press(save(c));
    const saved = await h.read(fx.moistureBins);
    expect([sameBin(saved.get("3113")!, before.get("3113")!), saved.has("B-2/0"), saved.has("B-2/1"), saved.size]).toEqual([true, false, false, before.size]);
});
