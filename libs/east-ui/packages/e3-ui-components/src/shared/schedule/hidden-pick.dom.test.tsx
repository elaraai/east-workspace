/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The shared hidden pick's parts on e3 itself (`hidden.ts`, `hidden-pick.tsx`):
 * the maintenance work orders bound as a builder's source of the rail, over
 * their dispatch queue's index — by status, then due — and narrowed to the
 * open orders due in the week from 24 September 2026, as the rail narrows
 * them. Each source's pick read in a component of its own (`HideSources`);
 * which choices hide a row a list shows or an issue names, asked of e3 a source
 * at a time (`askHiding`) and said as far as e3 has (`hiddenOf`,
 * `hiddenLine`); a pick of one clearing just those choices (`clearHidden`), a
 * window a builder's navigation writes kept; the pick landing once the builder
 * draws the row (`useHiddenPick`); and a box's lines listed again as a pick
 * moves (`useRelist`).
 */

import { useEffect, useState } from "react";
import { expect, test } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { DateTimeType, East, SortedMap, StringType, compareFor, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, bindRecord, type RecordSliceBindType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { StateRuntime, formatters, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import type { PickingSource } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/bind/data/data";
import { act, e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { askHiding, clearHidden, hiddenByText, hiddenLine, hiddenOf, useMoves, useRelist, useSourceHidden, type HiddenWords, type SourceHidden } from "./hidden.js";
import { HideSources, useHiddenPick, type HiddenPick, type HiddenPicks, type HiddenSource } from "./hidden-pick.js";

const h = e3Harness({ "bind/data/data": ex }, { measure: false });

type Bind = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
const printString = printFor(StringType);
const printDate = printFor(DateTimeType);
const whereEqual = equalFor(RecordSliceWhereType);

/**
 * The work orders as a builder's sources of the rail — the same record twice, each its own narrowing — their status
 * and due date over the dispatch queue's index, status then due: a due date the rail holds only after a status.
 */
const program = East.function([], undefined, ($) => {
    const orders = $.let(Data.bindPaged(ex.workOrders, { indexes: ["by_status"] }));
    const fields = { status: { label: "Status" }, due: { label: "Due" } };
    return {
        week: bindRecord("hidden-pick.week", orders, { fields }),
        late: bindRecord("hidden-pick.late", orders, { fields }),
    };
});

/** The two sources' parts. */
interface Bound {
    readonly week: Bind;
    readonly late: Bind;
}

/** Installs the runtimes over the test's workspace, as a mounted page's providers install them, and binds the sources. */
async function bound(): Promise<Bound> {
    await h.install({ fn: program });
    return East.compile(program, getRegisteredPlatformImplementations())() as unknown as Bound;
}

const OPEN: Choice = variant("values", [printString("open")]);
const LATE: Choice = variant("values", [printString("late")]);
/** The week from 24 September. */
const WEEK: Choice = variant("range", { from: printDate(new Date("2026-09-24T00:00:00Z")), to: printDate(new Date("2026-09-28T00:00:00Z")) });
/** The week after it. */
const NEXT_WEEK: Choice = variant("range", { from: printDate(new Date("2026-09-28T00:00:00Z")), to: printDate(new Date("2026-10-05T00:00:00Z")) });
const where = (choices: [string, Choice][]): Where => new SortedMap(choices, compareString);
/**
 * The open orders due in the week from 24 September: WO-1003, WO-1004, WO-1009 and WO-1016 — never WO-1006, open and
 * due on the 29th, which its due date alone hides, nor a late order such as WO-1005, which its status hides.
 */
const OPEN_THIS_WEEK = where([["status", OPEN], ["due", WEEK]]);
const OPEN_ALONE = where([["status", OPEN]]);

/** Writes a source's narrowing, as the rail's chips write it. */
async function narrow(part: Bind, to: Where): Promise<void> {
    await act(async () => { part.write({ ...part.read(), where: to, preset: none }); });
    await settle();
}

/** The app's formatters, and a builder's words for a row the rail hides, in English. */
const format = formatters("en-US");
const WORDS: HiddenWords = { hiddenByFilters: () => "hidden by the filters", hiddenBy: ({ filters, also }) => hiddenByText(filters, also) };

/** What a builder's pick has done: the rows it selected and gave the keyboard as each landed, and what it said of a clear that threw. */
interface Landed {
    readonly selected: string[];
    readonly focused: string[];
    readonly said: string[];
}

/** A builder's pick, as the test drives it, and what the builder draws. */
interface Probe {
    readonly pick: HiddenPick<string>;
    readonly draw: (ids: readonly string[]) => void;
}

/** A builder over the picks: its hidden pick, landing on the rows it draws. */
function Builder({ landed, onProbe }: { landed: Landed; onProbe: (probe: Probe) => void }) {
    const [drawn, setDrawn] = useState<readonly string[]>([]);
    const pick = useHiddenPick<string>({
        onError: (said) => { landed.said.push(said); },
        uncleared: "The filters hiding the order could not be cleared",
        landing: {
            drawn: (id) => drawn.some((one) => stringEqual(one, id)),
            selects: (id) => { landed.selected.push(id); },
            focus: (id) => { landed.focused.push(id); },
        },
    });
    useEffect(() => { onProbe({ pick, draw: setDrawn }); });
    return null;
}

/**
 * Renders each source's pick in a component of its own, and a builder over them.
 *
 * @param sources - The sources, in order
 * @returns The picks as last handed on, how often what renders with them has, the builder, and what it has done
 */
function mount(sources: readonly HiddenSource[]) {
    const seen: { picks: HiddenPicks | undefined; renders: number; probe: Probe | undefined } = { picks: undefined, renders: 0, probe: undefined };
    const landed: Landed = { selected: [], focused: [], said: [] };
    render(
        <HideSources name="Test" sources={sources}>
            {(picks) => {
                seen.picks = picks;
                seen.renders++;
                return <Builder landed={landed} onProbe={(probe) => { seen.probe = probe; }} />;
            }}
        </HideSources>,
    );
    const pickOf = (key: string): SourceHidden => {
        const pick = seen.picks?.get(key);
        if (pick === undefined) throw new Error(`no pick of ${key}`);
        return pick;
    };
    const probe = (): Probe => {
        if (seen.probe === undefined) throw new Error("the builder has not rendered");
        return seen.probe;
    };
    return { seen, landed, pickOf, probe };
}

/** What e3 has said hides a row of a source, once it has. */
const answerOf = (pick: SourceHidden, id: string) => hiddenOf([{ pick, id }])?.[0]?.answer;

test("each source's pick is read in a component of its own and handed on by its key, in the sources' order — a step of the window a builder's navigation writes renders nothing under them", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    const { seen, pickOf } = mount([{ key: "week", part: b.week, window: "due" }, { key: "late", part: b.late }]);
    await waitFor(() => expect(pickOf("week").ready && pickOf("late").ready).toBe(true));
    expect([...seen.picks!.keys()]).toEqual(["week", "late"]);
    // The week's pick asks of its choices but the window its navigation writes, which hides no row: the status alone.
    expect(whereEqual(pickOf("week").where!, OPEN_ALONE)).toBe(true);
    expect(pickOf("late").where!.size).toBe(0);
    const week = pickOf("week");
    const renders = seen.renders;
    // A step of the window alone: the pick holds, and nothing under the picks renders again.
    await narrow(b.week, where([["status", OPEN], ["due", NEXT_WEEK]]));
    expect(pickOf("week")).toBe(week);
    expect(seen.renders).toBe(renders);
    // A choice moves it: the pick is another, and what renders with the picks renders again.
    await narrow(b.week, where([["status", LATE], ["due", NEXT_WEEK]]));
    expect(pickOf("week")).not.toBe(week);
    expect(seen.renders).toBeGreaterThan(renders);
});

test("askHiding asks e3 of a source's rows once, and hiddenOf says what hides each: nothing the narrowing holds; a choice the rail holds after another, once that one holds the row; and one it cannot tell apart, cleared with the one that hides it", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    const { pickOf } = mount([{ key: "week", part: b.week }]);
    await waitFor(() => expect(pickOf("week").ready).toBe(true));
    const ask = () => askHiding(["WO-1003", "WO-1006", "WO-1005"].map((id) => ({ pick: pickOf("week"), id })), false);
    await act(async () => { ask(); });
    await settle();
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1005")).toBeDefined());
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1006")).toBeDefined());
    // WO-1003, open and due on the 25th: the narrowing holds it.
    expect(hiddenOf([{ pick: pickOf("week"), id: "WO-1003" }])).toBeUndefined();
    // WO-1006, open and due on the 29th: its due date alone hides it, and a pick leaves the status standing.
    const due = answerOf(pickOf("week"), "WO-1006")!;
    expect([due.by, due.also]).toEqual([["due"], []]);
    expect(whereEqual(due.where, OPEN_ALONE)).toBe(true);
    // WO-1005, late: its status hides it, and whether its due date does is not told apart — the rail holds a due date
    // only after a status — so a pick clears the due date with the status.
    const status = answerOf(pickOf("week"), "WO-1005")!;
    expect([status.by, status.also]).toEqual([["status"], ["due"]]);
    expect(status.where.size).toBe(0);
    // Asked again at the same revision and narrowing: nothing more is read.
    const asked = h.requests().length;
    await act(async () => { ask(); });
    await settle();
    expect(h.requests()).toHaveLength(asked);
});

test("hiddenLine says the filters until e3 has said for every source that hides the row, then each choice as the rail words it, every source's in the order given", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    await narrow(b.late, where([["status", LATE]]));
    const { pickOf } = mount([{ key: "week", part: b.week }, { key: "late", part: b.late }]);
    await waitFor(() => expect(pickOf("week").ready && pickOf("late").ready).toBe(true));
    const line = (id: string, keys: readonly string[]) => hiddenLine(hiddenOf(keys.map((key) => ({ pick: pickOf(key), id })))!, format, WORDS);
    // Asked nothing yet: the filters hide it.
    expect(line("WO-1006", ["week"])).toBe("hidden by the filters");
    await act(async () => { askHiding([{ pick: pickOf("week"), id: "WO-1006" }, { pick: pickOf("week"), id: "WO-1005" }], true); });
    await settle();
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1005")).toBeDefined());
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1006")).toBeDefined());
    expect(line("WO-1005", ["week"])).toMatch(/^hidden by Status: open — picking it clears that filter, and Due: .+ with it$/);
    expect(line("WO-1006", ["week"])).toMatch(/^hidden by Due: .+ — picking it clears that filter$/);
    // The late orders' status hides WO-1006 too: until that source has said, the filters; then both sources' choices.
    expect(line("WO-1006", ["week", "late"])).toBe("hidden by the filters");
    await act(async () => { askHiding([{ pick: pickOf("late"), id: "WO-1006" }], true); });
    await settle();
    await waitFor(() => expect(answerOf(pickOf("late"), "WO-1006")).toBeDefined());
    expect(line("WO-1006", ["week", "late"])).toMatch(/^hidden by Due: .+; Status: late — picking it clears those filters$/);
});

test("clearHidden clears just the choices that hide the row — every choice of a source while e3 has not said — keeps a builder's window, and writes nothing of a source that narrows nothing", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    // A builder whose navigation writes the source's status — a field that stands alone on its index, as an event kind's
    // range does on its own: what it writes hides no row.
    const { pickOf } = mount([{ key: "week", part: b.week }, { key: "windowed", part: b.week, window: "status" }, { key: "late", part: b.late }]);
    await waitFor(() => expect(pickOf("week").ready && pickOf("windowed").ready && pickOf("late").ready).toBe(true));
    await act(async () => { askHiding([{ pick: pickOf("week"), id: "WO-1006" }], true); });
    await settle();
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1006")).toBeDefined());
    // WO-1006, said: just its due date cleared, the status kept.
    await act(async () => { clearHidden(hiddenOf([{ pick: pickOf("week"), id: "WO-1006" }])!); });
    await settle();
    expect(whereEqual(b.week.read().where, OPEN_ALONE)).toBe(true);
    // Not said: every choice of the source cleared…
    await narrow(b.week, OPEN_THIS_WEEK);
    await act(async () => { clearHidden([{ pick: pickOf("week"), answer: undefined }]); });
    await settle();
    expect(b.week.read().where.size).toBe(0);
    // …but the field a builder's navigation writes into it, which hides no row.
    await narrow(b.week, OPEN_THIS_WEEK);
    await act(async () => { clearHidden([{ pick: pickOf("windowed"), answer: undefined }]); });
    await settle();
    expect(whereEqual(b.week.read().where, OPEN_ALONE)).toBe(true);
    // A source whose narrowing holds no choice hides nothing: nothing of it is written.
    const store = StateRuntime.getStore();
    const version = store.getKeyVersion(b.late.key);
    await act(async () => { clearHidden([{ pick: pickOf("late"), answer: undefined }]); });
    expect(store.getKeyVersion(b.late.key)).toBe(version);
});

test("a pick clears what hides the row, goes, and lands once the builder draws it: selected, and handed the keyboard where the box's pick armed it — never after a step of the box, nor where the builder draws the row nowhere", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    const { landed, pickOf, probe } = mount([{ key: "week", part: b.week }]);
    await waitFor(() => expect(pickOf("week").ready).toBe(true));
    await act(async () => { askHiding([{ pick: pickOf("week"), id: "WO-1006" }], true); });
    await settle();
    await waitFor(() => expect(answerOf(pickOf("week"), "WO-1006")).toBeDefined());
    // The box's source as the builder hands it on: a pick of the box's arms the keyboard's hand-off, a step drops it.
    const source: PickingSource = { jump: () => {}, clear: () => {} };
    const box = probe().pick.search(source);
    await act(async () => {
        box.jump(0, "pick");
        probe().pick.pick(hiddenOf([{ pick: pickOf("week"), id: "WO-1006" }]), "WO-1006", () => true);
    });
    await settle();
    // Just the due date cleared; nothing lands until the builder draws the row.
    expect(whereEqual(b.week.read().where, OPEN_ALONE)).toBe(true);
    expect(landed.selected).toEqual([]);
    await act(async () => { probe().draw(["WO-1006"]); });
    expect(landed.selected).toEqual(["WO-1006"]);
    await waitFor(() => expect(landed.focused).toEqual(["WO-1006"]));
    // A step of the box: it lands, selected, and the keyboard stays where it is.
    await act(async () => {
        box.jump(1, "step");
        probe().pick.pick(undefined, "WO-1003", () => true);
    });
    await act(async () => { probe().draw(["WO-1006", "WO-1003"]); });
    expect(landed.selected).toEqual(["WO-1006", "WO-1003"]);
    // A go that draws the row nowhere — an event of a backlog: nothing lands, however the builder draws later.
    await act(async () => {
        box.jump(2, "pick");
        probe().pick.pick(undefined, "WO-1004", () => false);
    });
    await act(async () => { probe().draw(["WO-1006", "WO-1003", "WO-1004"]); });
    await settle();
    expect(landed.selected).toEqual(["WO-1006", "WO-1003"]);
    expect(landed.focused).toEqual(["WO-1006"]);
});

test("a clear that throws is said in its own words, and nothing goes nor lands: the narrowing stands", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    const { landed, pickOf, probe } = mount([{ key: "week", part: b.week }]);
    await waitFor(() => expect(pickOf("week").ready).toBe(true));
    // The source's part refusing the write, as a rail that cannot write a narrowing refuses it.
    const refusing: SourceHidden = { ...pickOf("week"), part: { ...b.week, write: () => { throw new Error("The rail refused the narrowing"); } } };
    let went = false;
    await act(async () => { probe().pick.pick([{ pick: refusing, answer: undefined }], "WO-1006", () => { went = true; return true; }); });
    expect(landed.said).toEqual(["The rail refused the narrowing"]);
    expect(went).toBe(false);
    await act(async () => { probe().draw(["WO-1006"]); });
    expect(landed.selected).toEqual([]);
    expect(whereEqual(b.week.read().where, OPEN_THIS_WEEK)).toBe(true);
    // The clear alone, as a builder whose own reveal lands its rows asks it: refused, said so; and nothing to clear, cleared.
    let cleared = true;
    await act(async () => { cleared = probe().pick.clear([{ pick: refusing, answer: undefined }]); });
    expect(cleared).toBe(false);
    expect(landed.said).toEqual(["The rail refused the narrowing", "The rail refused the narrowing"]);
    expect(probe().pick.clear(undefined)).toBe(true);
});

test("useRelist moves as e3 says which choices hide a row, or a choice moves the narrowing — never as a step of a window the builder keeps", async () => {
    const b = await bound();
    await narrow(b.week, OPEN_THIS_WEEK);
    const { result } = renderHook(() => {
        const pick = useSourceHidden("Test", b.week, "due");
        return { pick, relist: useRelist([pick]) };
    });
    await waitFor(() => expect(result.current.pick.ready).toBe(true));
    const ready = result.current.relist;
    await narrow(b.week, where([["status", OPEN], ["due", NEXT_WEEK]]));
    expect(result.current.relist).toBe(ready);
    await act(async () => { askHiding([{ pick: result.current.pick, id: "WO-1005" }], true); });
    await settle();
    await waitFor(() => expect(answerOf(result.current.pick, "WO-1005")).toBeDefined());
    expect(result.current.relist).toBeGreaterThan(ready);
    const said = result.current.relist;
    await narrow(b.week, where([["status", LATE]]));
    expect(result.current.relist).toBeGreaterThan(said);
});

test("useMoves counts each time one of some values is another object, or their number moves — never a render that holds them", () => {
    const one = {};
    const two = {};
    const { result, rerender } = renderHook(({ values }: { values: readonly unknown[] }) => useMoves(values), { initialProps: { values: [one] as readonly unknown[] } });
    expect(result.current).toBe(0);
    rerender({ values: [one] });
    expect(result.current).toBe(0);
    rerender({ values: [two] });
    expect(result.current).toBe(1);
    rerender({ values: [two, one] });
    expect(result.current).toBe(2);
    rerender({ values: [two, one] });
    expect(result.current).toBe(2);
});
