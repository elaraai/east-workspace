/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas controller (#815), framework-free: events in, state and effects
 * out. Every action runs its own effects before it returns, and notifies once;
 * a data change reconciles the UI state exactly as the canvas's first render of
 * it already showed; the source's channels outlive a disconnect.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { buildSliceHandle } from "../../../platform/slice/index.js";
import { initializeStore } from "../../../platform/state-runtime.js";
import { UIStore } from "../../../platform/state-store.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../../reactive/tracker.js";
import type { PlanRootValue, PlanRowId, PlanWireRow } from "../model.js";
import type { PlanPersisted } from "../persisted.js";
import { PLAN_PAGE_SIZE } from "../use-plan-paging.js";
import { createPlanController, reconciledUi, type PlanController, type PlanUiBindValue, type PlanUiStateValue } from "./index.js";
import { blocksSource, oneBlock, rowId, rowIdEqual, rowItem, rowKey } from "../plan.test-utils.js";

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none });
const group = () => variant("group", { summary: variant("none", null) });

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown = span(), parent?: string, series?: string): PlanWireRow {
    return {
        id: rowId(key, series),
        parent: parent !== undefined ? some(rowId(parent, series)) : none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: false, pinned: false, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow;
}

/** A decoded root — the inline stream unless a paged source is given;
 *  callbacks as the decoder hands them over (plain functions inside `some`). */
function root(rows: PlanWireRow[], opts: Partial<Record<string, unknown>> = {}): PlanRootValue {
    return {
        rows: opts.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(rows)),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [variant("week", null), variant("day", null)], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, review: none, pick: none,
        slice: none, footer: [], id: none, sources: [], onDrag: none, canDrop: none,
        onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none, style: none,
        ...opts,
    } as unknown as PlanRootValue;
}

const ROWS = [planRow("G", group()), planRow("g1", span(), "G"), planRow("r1"), planRow("r2"), planRow("r3")];
/** {@link ROWS} without one row. */
const without = (key: string) => ROWS.filter((r) => !rowIdEqual(r.id, rowId(key)));
/** A row's test key from its id. */
const nameOf = (id: PlanRowId) => id.value.path.join("/");

type SliceState = { range: { type: string; value?: { type: string; value: { from: Date; to: Date } } }; resolution: { type: string; value?: { type: string } } };

/** A bound slice (WEEK over the 12-week window) that counts its writes. */
function countingSlice(key: string) {
    const cfg = {
        fields: new Map<string, unknown>([
            ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
        ]),
        rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
    };
    const initial = {
        range: some(variant("datetime", { from: W27, to: W39 })),
        compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none,
        resolution: some(variant("week", null)),
    };
    const handle = buildSliceHandle(key, cfg as never, initial as never, [{ at: W27 }] as never, none) as Record<string, (...a: unknown[]) => unknown>;
    const calls = { write: 0, setRange: 0, setResolution: 0 };
    const slice = {
        ...handle,
        write: (s: unknown) => { calls.write += 1; return handle.write!(s); },
        setRange: (r: unknown) => { calls.setRange += 1; return handle.setRange!(r); },
        setResolution: (r: unknown) => { calls.setResolution += 1; return handle.setResolution!(r); },
    };
    const state = () => handle.read!() as SliceState;
    const window = (): [number, number] => {
        const r = state().range.value!.value;
        return [r.from.getTime(), r.to.getTime()];
    };
    return { chrome: some({ slice, affordances: [] }), calls, state, window };
}

/** A controller already showing `value`, with a count of its notifications. */
function show(value: PlanRootValue, persist?: (p: PlanPersisted) => void) {
    const c = createPlanController({ grain: "resource", collapsed: [], persist });
    c.setValue(value, value);
    let notified = 0;
    c.subscribe(() => { notified += 1; });
    return { c, notified: () => notified };
}

const microtasks = () => new Promise<void>((r) => queueMicrotask(r));

beforeEach(() => { initializeStore(new UIStore()); });

describe("actions run their own effects (#815)", () => {
    test("two effectful actions in ONE handler both run — `]` twice pans two periods", () => {
        const s = countingSlice("c815-pan");
        const { c } = show(root(ROWS, { slice: s.chrome }));
        const [from] = s.window();
        // One handler, two presses. The effect batch this replaces was
        // REPLACED by the second dispatch before it drained: one pan landed.
        c.dispatch({ t: "key", key: "]" });
        c.dispatch({ t: "key", key: "]" });
        expect(s.window()[0] - from).toBe(2 * WEEK);
        expect(s.calls.setRange).toBe(2);
    });

    test("two different effects in one handler both reach the author — a select, then a grain cycle", async () => {
        const calls: string[] = [];
        const { c } = show(root(ROWS, {
            onSelect: some((id: PlanRowId) => { calls.push(`select ${nameOf(id)}`); }),
            onGrainChange: some((g: { type: string }) => { calls.push(`grain ${g.type}`); }),
        }));
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        c.dispatch({ t: "key", key: "g" });
        // Callbacks fire after the handler, never inside it.
        expect(calls).toEqual([]);
        await microtasks();
        expect(calls).toEqual(["select r1", "grain group"]);
    });

    test("a resolution change is ONE slice write — the resolution and its window together", () => {
        const s = countingSlice("c815-res");
        const { c, notified } = show(root(ROWS, { slice: s.chrome }));
        const store = c.getSnapshot().store;
        c.dispatch({ t: "resolution.set", resolution: "day" });
        // Two writes rendered once in between at DAY over the 12-week window.
        expect(s.calls).toEqual({ write: 1, setRange: 0, setResolution: 0 });
        expect(s.state().resolution.value!.type).toBe("day");
        // Zoomed keeping the column count: twelve days from the window's start.
        expect(s.window()).toEqual([W27.getTime(), W27.getTime() + 12 * DAY]);
        // The machine's state did not move — the slice is the window's truth.
        // The one notification is the live region's (#819).
        expect(c.getSnapshot().store).toBe(store);
        expect(c.getSnapshot().announce?.text).toBe("Resolution: day");
        expect(notified()).toBe(1);
    });
});

describe("one notification per action", () => {
    test("an action that changes something notifies once; one that changes nothing, never", () => {
        const { c, notified } = show(root(ROWS));
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        expect(notified()).toBe(1);
        // Re-selecting holds (selection is idempotent) — nothing moved.
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        expect(notified()).toBe(1);
        // The same value again is no change at all.
        const same = c.getSnapshot();
        expect(c.getSnapshot()).toBe(same);
    });
});

describe("reconcile is the view the canvas already drew (#610, #815)", () => {
    test("a value without the selected, focused row drops both — and setValue commits exactly the render's view", () => {
        const v1 = root(ROWS);
        const { c } = show(v1);
        c.dispatch({ t: "row.select", key: rowKey("r2") });
        c.dispatch({ t: "focus.links", key: rowKey("r2") });
        const v2 = root(without("r2"));
        // What the canvas's first render of v2 draws — before anything commits.
        const view = reconciledUi(c.getSnapshot().store, {
            alive: new Set(["G", "g1", "r1", "r3"].map((k) => rowKey(k))), complete: true,
            declaredCollapsed: new Set(), declaredGrain: "resource",
        });
        expect(view.selected).toBeNull();
        expect(view.focus).toBeNull();
        c.setValue(v2, v2);
        expect(c.getSnapshot().store.ui).toEqual(view);
        // The row coming back is a NEW row: its old selection does not return.
        c.setValue(v1, v1);
        expect(c.getSnapshot().store.ui.selected).toBeNull();
    });

    test("the commit of a drawn reconcile notifies nobody — the value renders once", () => {
        const { c, notified } = show(root(ROWS));
        c.dispatch({ t: "row.select", key: rowKey("r2") });
        const n = notified();
        const v2 = root(without("r2"));
        c.setValue(v2, v2);
        // Pruned for real, and silently: the canvas drew exactly this.
        expect(c.getSnapshot().store.ui.selected).toBeNull();
        expect(notified()).toBe(n);
    });

    test("a changed DECLARED grain notifies — it clears the selection of a row that is still there", () => {
        const { c, notified } = show(root(ROWS));
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        const n = notified();
        const regrained = root(ROWS, { grain: some(variant("group", null)) });
        c.setValue(regrained, regrained);
        expect(c.getSnapshot().store.ui.selected).toBeNull();
        expect(c.getSnapshot().store.ui.grain).toBe("group");
        expect(notified()).toBe(n + 1);
    });

    test("a closure-only change (same data identity) reconciles nothing", () => {
        const v = root(ROWS);
        const { c, notified } = show(v);
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        const n = notified();
        const before = c.getSnapshot().store;
        c.setValue(root(ROWS, { onSelect: some(() => undefined) }), v);
        expect(c.getSnapshot().store).toBe(before);
        expect(notified()).toBe(n);
    });
});

describe("the open element overlay", () => {
    const BODY = { body: "A" } as never;
    const runRef = (run: string) => variant("run", { row: rowId("r1"), run }) as never;

    test("the resolver runs first — only a `some` body opens; one element's surface at a time", () => {
        const resolved: string[] = [];
        const { c } = show(root(ROWS, {
            popover: some((ref: { value: { run: string } }) => {
                resolved.push(ref.value.run);
                return ref.value.run === "none" ? none : some(BODY);
            }),
        }));
        c.overlayIntent("popover", runRef("none"), true);
        expect(c.getSnapshot().overlay.popover).toBeNull();
        c.overlayIntent("popover", runRef("a"), true);
        expect(c.getSnapshot().overlay.popover).toMatchObject({ body: BODY });
        // Another element opening takes the surface; the first's late close
        // intent then closes nothing.
        c.overlayIntent("popover", runRef("b"), true);
        c.overlayIntent("popover", runRef("a"), false);
        expect(c.getSnapshot().overlay.popover?.ref).toEqual(runRef("b"));
        c.overlayIntent("popover", runRef("b"), false);
        expect(c.getSnapshot().overlay.popover).toBeNull();
        expect(resolved).toEqual(["none", "a", "b"]);
    });

    test("an element already open is not resolved again; a popover takes the surface from a hover card", () => {
        const resolved: string[] = [];
        const resolver = (kind: string) => (ref: { value: { run: string } }) => {
            resolved.push(`${kind}:${ref.value.run}`);
            return some(BODY);
        };
        const { c, notified } = show(root(ROWS, { popover: some(resolver("pop")), hover: some(resolver("hov")) }));
        c.overlayIntent("hover", runRef("a"), true);
        const n = notified();
        c.overlayIntent("hover", runRef("a"), true);
        expect(resolved).toEqual(["hov:a"]);
        expect(notified()).toBe(n);
        c.overlayIntent("popover", runRef("a"), true);
        expect(c.getSnapshot().overlay.popover).not.toBeNull();
        expect(c.getSnapshot().overlay.hover).toBeNull();
        expect(resolved).toEqual(["hov:a", "pop:a"]);
    });

    test("a tooltip opens with its mark's text and closes; the same mark again changes nothing", () => {
        const { c, notified } = show(root(ROWS));
        c.tooltipIntent({ key: "r1|port|0", text: "IN" });
        expect(c.getSnapshot().overlay.tooltip).toEqual({ key: "r1|port|0", text: "IN" });
        const n = notified();
        c.tooltipIntent({ key: "r1|port|0", text: "IN" });
        expect(notified()).toBe(n);
        // Another mark with the same text is another anchor.
        c.tooltipIntent({ key: "r2|port|0", text: "IN" });
        expect(c.getSnapshot().overlay.tooltip?.key).toBe("r2|port|0");
        c.tooltipIntent(null);
        expect(c.getSnapshot().overlay.tooltip).toBeNull();
    });

    test("a resolver that throws opens nothing, and says why", () => {
        const errors: unknown[] = [];
        const original = console.error;
        console.error = (...a: unknown[]) => { errors.push(a[0]); };
        try {
            const { c } = show(root(ROWS, { hover: some(() => { throw new Error("bad lookup"); }) }));
            c.overlayIntent("hover", runRef("a"), true);
            expect(c.getSnapshot().overlay.hover).toBeNull();
            expect(String(errors[0])).toMatch(/hover resolver failed/);
        } finally {
            console.error = original;
        }
    });
});

describe("the author's callbacks", () => {
    test("every element click reaches the ONE onElementClick with its ref; a drop reports to onDrag — after the handler (#824)", async () => {
        const calls: string[] = [];
        const { c } = show(root(ROWS, {
            onElementClick: some((ref: { type: string; value: { key?: string } }) => { calls.push(`${ref.type}${ref.value.key !== undefined ? ` ${ref.value.key}` : ""}`); }),
            onDrag: some(() => { calls.push("drag"); }),
        }));
        c.elementClick(variant("event", { row: rowId("r1"), event: "e1" }) as never);
        c.elementClick(variant("run", { row: rowId("r1"), run: "x1" }) as never);
        c.elementClick(variant("link", { key: "t1", from: { row: rowId("r1"), run: "x1" }, to: { row: rowId("r2"), run: "y1" } }) as never);
        c.drop({} as never);
        expect(calls).toEqual([]);
        await microtasks();
        expect(calls).toEqual(["event", "run", "link t1", "drag"]);
    });

    test("with no onElementClick declared, a click reports to no one", async () => {
        const { c } = show(root(ROWS));
        c.elementClick(variant("run", { row: rowId("r1"), run: "x1" }) as never);
        await microtasks();
        expect(c.getSnapshot().store.ui.selected).toBeNull();
    });
});

describe("payloads name rows by their typed id (#822)", () => {
    test("onSelect, onGroupToggle and the review callbacks receive the row's id — never its key", async () => {
        const selected: PlanRowId[] = [];
        const toggled: { row: PlanRowId; expanded: boolean }[] = [];
        const approved: PlanRowId[] = [];
        const rejected: PlanRowId[] = [];
        const { c } = show(root(ROWS, {
            onSelect: some((id: PlanRowId) => { selected.push(id); }),
            onGroupToggle: some((e: { row: PlanRowId; expanded: boolean }) => { toggled.push(e); }),
            review: some({
                onApprove: some((id: PlanRowId) => { approved.push(id); }),
                onReject: some((id: PlanRowId) => { rejected.push(id); }),
                onApproveAll: none, onRejectAll: none, onRerun: none,
            }),
        }));
        c.dispatch({ t: "row.select", key: rowKey("r2") });
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        c.approveRow(rowKey("r1"));
        c.rejectRow(rowKey("r3"));
        await microtasks();
        expect(selected).toHaveLength(1);
        expect(rowIdEqual(selected[0]!, rowId("r2"))).toBe(true);
        expect(toggled).toHaveLength(1);
        expect(rowIdEqual(toggled[0]!.row, rowId("G"))).toBe(true);
        expect(toggled[0]!.expanded).toBe(false);
        expect(approved.map(nameOf)).toEqual(["r1"]);
        expect(rejected.map(nameOf)).toEqual(["r3"]);
        expect(rowIdEqual(approved[0]!, rowId("r1"))).toBe(true);
    });

    test("a repeated id's row still names the id it repeats", async () => {
        const selected: PlanRowId[] = [];
        const { c } = show(root([...ROWS, planRow("r1")], { onSelect: some((id: PlanRowId) => { selected.push(id); }) }));
        c.dispatch({ t: "row.select", key: `${rowKey("r1")}#1` });
        await microtasks();
        expect(selected).toHaveLength(1);
        expect(rowIdEqual(selected[0]!, rowId("r1"))).toBe(true);
    });
});

describe("keyboard navigation (#819)", () => {
    test("a move takes the tab stop, asks for focus once, and asks the frame to scroll only when told how", () => {
        const { c, notified } = show(root(ROWS));
        c.focusItem("r:r2", "auto");
        const moved = c.getSnapshot();
        expect(moved.nav.active).toBe("r:r2");
        expect(moved.nav.request).toEqual({ key: "r:r2", seq: 1 });
        expect(moved.scroll).toMatchObject({ owner: "nav", nav: { key: "r:r2", align: "auto", seq: 1 } });
        expect(notified()).toBe(1);
        // The row took focus: the request is spent — a remount will not take it again.
        c.focusDone(1);
        expect(c.getSnapshot().nav).toEqual({ active: "r:r2", request: null });
        // A move beside the focused row asks for no scroll: the scroll target stays.
        c.focusItem("r:r3");
        expect(c.getSnapshot().scroll.nav).toEqual({ key: "r:r2", align: "auto", seq: 1 });
        expect(c.getSnapshot().nav.request).toEqual({ key: "r:r3", seq: 2 });
        // A stale focusDone spends nothing.
        c.focusDone(1);
        expect(c.getSnapshot().nav.request).toEqual({ key: "r:r3", seq: 2 });
    });

    test("focus landing in an item (a click) moves the tab stop, and nothing else", () => {
        const { c, notified } = show(root(ROWS));
        c.itemFocused("r:r1");
        expect(c.getSnapshot().nav).toEqual({ active: "r:r1", request: null });
        expect(c.getSnapshot().scroll.owner).toBe("search");
        const n = notified();
        c.itemFocused("r:r1");
        expect(notified()).toBe(n);
    });
});

describe("the live region (#819)", () => {
    test("says what an interaction changed — and nothing for one that changed nothing", () => {
        const { c } = show(root(ROWS));
        const said = () => c.getSnapshot().announce?.text;
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        expect(said()).toBe("Selected r1");
        const seq = c.getSnapshot().announce!.seq;
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        expect(c.getSnapshot().announce!.seq).toBe(seq);
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        expect(said()).toBe("G collapsed");
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        expect(said()).toBe("G expanded");
        c.dispatch({ t: "chart.toggle", key: rowKey("r3") });
        expect(said()).toBe("r3 chart expanded");
        c.dispatch({ t: "focus.links", key: rowKey("r2") });
        expect(said()).toBe("Showing rows linked to r2");
        // The esc ladder, a rung at a time.
        c.dispatch({ t: "key", key: "esc" });
        expect(said()).toBe("Showing all rows");
        c.dispatch({ t: "key", key: "esc" });
        expect(said()).toBe("Selection cleared");
        c.dispatch({ t: "key", key: "g" });
        expect(said()).toBe("Grain: group");
    });

    test("a resolution the write could not change says nothing — an unbound canvas has nowhere to write it", () => {
        const { c } = show(root(ROWS));
        c.dispatch({ t: "resolution.set", resolution: "day" });
        expect(c.getSnapshot().announce).toBeNull();
    });
});

describe("what survives a remount (#813)", () => {
    test("a toggle is written once, when it moves; a selection is never written", () => {
        const writes: PlanPersisted[] = [];
        const { c } = show(root(ROWS), (p) => writes.push(p));
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        expect(writes).toHaveLength(1);
        expect(writes[0]!.collapse).toEqual([[rowKey("G"), true]]);
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        c.dispatch({ t: "chart.toggle", key: rowKey("r3") });
        expect(writes).toHaveLength(2);
        expect(writes[1]!.charts).toEqual([rowKey("r3")]);
    });
});

describe("a bound ui state (#824)", () => {
    /** A host's bound state — a handle over one value, writes heard through
     *  `subscribe` as the state store's are — and what the canvas wrote to it. */
    function hostState(initial: Partial<PlanUiStateValue> = {}) {
        let state: PlanUiStateValue = { selected: none, collapsed: [], expanded: [], charts: [], focus: none, ...initial };
        const writes: PlanUiStateValue[] = [];
        const listeners = new Set<() => void>();
        const notify = () => { for (const l of [...listeners]) l(); };
        const handle = {
            read: () => state,
            write: (s: PlanUiStateValue) => { state = s; writes.push(s); notify(); return null; },
            has: () => true,
        } as unknown as PlanUiBindValue;
        return {
            handle, writes,
            subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
            state: () => state,
            /** The host writes it. */
            set: (s: Partial<PlanUiStateValue>) => { state = { ...state, ...s }; notify(); },
        };
    }
    /** A controller mounted over a bound root, listening. */
    function mount(rows: PlanWireRow[], host: ReturnType<typeof hostState>, opts: { grain?: "group" | "resource"; collapsed?: string[]; persist?: (p: PlanPersisted) => void; root?: Partial<Record<string, unknown>> } = {}) {
        const v = root(rows, { ui: some(host.handle), ...(opts.grain === "group" ? { grain: some(variant("group", null)) } : {}), ...opts.root });
        const c = createPlanController({
            grain: opts.grain ?? "resource", collapsed: (opts.collapsed ?? []).map((k) => rowKey(k)),
            ui: host.handle, subscribeUi: host.subscribe, persist: opts.persist,
        });
        c.setValue(v, v);
        c.connect();
        let notified = 0;
        c.subscribe(() => { notified += 1; });
        return { c, notified: () => notified };
    }
    const folded = (key: string) => ({ ...planRow(key, group()), collapsed: true }) as PlanWireRow;

    test("the host's state is the canvas's from its first frame — selection, folds, opened rows and charts", () => {
        const host = hostState({ selected: some(rowId("r1")), collapsed: [rowId("G")], charts: [rowId("r3")] });
        const c = createPlanController({ grain: "resource", collapsed: [], ui: host.handle });
        const ui = c.getSnapshot().store.ui;
        expect(ui.selected).toBe(rowKey("r1"));
        expect([...ui.collapsed]).toEqual([rowKey("G")]);
        expect([...ui.chartsExpanded]).toEqual([rowKey("r3")]);
        // Opened against its declaration: a declared fold the host opened is open.
        const opened = createPlanController({ grain: "resource", collapsed: [rowKey("G")], ui: hostState({ expanded: [rowId("G")] }).handle });
        expect(opened.getSnapshot().store.ui.collapsed.has(rowKey("G"))).toBe(false);
    });

    test("a host write is taken on the store's notification — and a row in neither list follows its declaration again", () => {
        const host = hostState({ expanded: [rowId("G")] });
        const { c, notified } = mount([folded("G"), planRow("g1", span(), "G"), planRow("r1"), planRow("r3")], host, { collapsed: ["G"] });
        expect(c.getSnapshot().store.ui.collapsed.has(rowKey("G"))).toBe(false);
        host.set({ selected: some(rowId("r1")), charts: [rowId("r3")] });
        expect(c.getSnapshot().store.ui.selected).toBe(rowKey("r1"));
        expect(c.getSnapshot().store.ui.chartsExpanded.has(rowKey("r3"))).toBe(true);
        expect(notified()).toBe(1);
        host.set({ expanded: [] });
        expect(c.getSnapshot().store.ui.collapsed.has(rowKey("G"))).toBe(true);
        // A write that moved nothing the canvas holds renders nothing.
        const n = notified();
        host.set({ collapsed: [] });
        expect(notified()).toBe(n);
    });

    test("the user's actions are written back once, after the handler — and a write that moves nothing, never", async () => {
        const host = hostState({ charts: [rowId("r3")] });
        const { c } = mount(ROWS, host);
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        expect(host.writes).toHaveLength(0);
        await microtasks();
        expect(host.writes).toHaveLength(1);
        expect(host.state()).toEqual({
            selected: some(rowId("r1")), collapsed: [rowId("G")], expanded: [], charts: [rowId("r3")], focus: none,
        });
        // Its own write, heard back through the store, is nothing new.
        expect(c.getSnapshot().store.ui.selected).toBe(rowKey("r1"));
        c.dispatch({ t: "row.select", key: rowKey("r1") });
        await microtasks();
        expect(host.writes).toHaveLength(1);
        // Reopened, G is no longer overridden against a declaration it does not
        // have — it leaves `collapsed` for `expanded`, keeping the lists' order.
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        await microtasks();
        expect(host.state().collapsed).toEqual([]);
        expect(host.state().expanded).toEqual([rowId("G")]);
    });

    test("bound, the canvas persists no toggles of its own — the host holds them", () => {
        const writes: PlanPersisted[] = [];
        const { c } = mount(ROWS, hostState(), { persist: (p) => writes.push(p) });
        c.dispatch({ t: "group.toggle", key: rowKey("G") });
        c.dispatch({ t: "chart.toggle", key: rowKey("r3") });
        expect(writes).toEqual([]);
        // Nor are stored toggles restored over the host's state.
        const restored = createPlanController({
            grain: "resource", collapsed: [], ui: hostState().handle,
            restored: { collapse: [[rowKey("G"), true]], charts: [rowKey("r3")], anchor: null },
        });
        expect(restored.getSnapshot().store.ui.collapsed.size).toBe(0);
        expect(restored.getSnapshot().store.ui.chartsExpanded.size).toBe(0);
    });

    test("focus is a REQUEST: spent at once, then served — the folded ancestors open, the row scrolls to the top and holds the tab stop", async () => {
        const host = hostState();
        const { c } = mount([folded("G"), planRow("g1", span(), "G"), planRow("r1")], host, { collapsed: ["G"] });
        host.set({ selected: some(rowId("g1")), focus: some(rowId("g1")) });
        const snap = c.getSnapshot();
        expect(snap.store.ui.collapsed.has(rowKey("G"))).toBe(false);
        expect(snap.store.ui.selected).toBe(rowKey("g1"));
        expect(snap.scroll).toMatchObject({ owner: "nav", nav: { key: rowItem("g1"), align: "start" } });
        // The tab stop, not DOM focus: the host asked for the row to be shown.
        expect(snap.nav).toEqual({ active: rowItem("g1"), request: null });
        await microtasks();
        expect(host.state().focus).toEqual(none);
        // The ancestor it opened is the host's to hold, like any open.
        expect(host.state().expanded).toEqual([rowId("G")]);
        expect(host.state().selected).toEqual(some(rowId("g1")));
    });

    test("the group grain gives way to a request for a row inside a top group — keeping the host's selection", () => {
        const host = hostState();
        const { c } = mount(ROWS, host, { grain: "group" });
        host.set({ selected: some(rowId("g1")), focus: some(rowId("g1")) });
        expect(c.getSnapshot().store.ui.grain).toBe("resource");
        expect(c.getSnapshot().store.ui.selected).toBe(rowKey("g1"));
    });

    test("a request for a row the inline canvas does not hold is dropped — and still spent", async () => {
        const host = hostState();
        const { c } = mount(ROWS, host);
        const scroll = c.getSnapshot().scroll;
        host.set({ focus: some(rowId("nowhere")) });
        expect(c.getSnapshot().scroll).toBe(scroll);
        await microtasks();
        expect(host.state().focus).toEqual(none);
    });

    /** 50 windows of one group entry and ten members each; the key search
     *  answers with the window its key names (`g<w>c<i>`). */
    function pagedSource() {
        return {
            id: "c824-paged",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                return some([planRow(`g${w}`, group()), ...Array.from({ length: 10 }, (_u, i) => planRow(`g${w}c${i}`, span(), `g${w}`))]);
            },
            total: () => some(BigInt(50 * PLAN_PAGE_SIZE)),
            seek: some((q: { type: string; value: string }) => {
                const w = Number(/g(\d+)/u.exec(q.value)?.[1] ?? "0");
                return some({ found: true, row: BigInt(w * PLAN_PAGE_SIZE), count: 1n });
            }),
            revision: () => none,
            refresh: () => null,
        };
    }

    test("a paged row seen before has its window opened, then is scrolled to", () => {
        const host = hostState();
        const { c } = mount([], host, { root: { rows: variant("paged", blocksSource(pagedSource())) } });
        // Move away: window 1's rows leave the canvas.
        c.search.jump(30 * PLAN_PAGE_SIZE);
        c.committed(c.getSnapshot().paging);
        expect(c.getSnapshot().paging.rows.some((r) => r.key === rowKey("g1c3"))).toBe(false);
        host.set({ focus: some(rowId("g1c3")) });
        expect(c.getSnapshot().paging.rows.some((r) => r.key === rowKey("g1c3"))).toBe(true);
        expect(c.getSnapshot().scroll.nav).toMatchObject({ key: rowItem("g1c3"), align: "start" });
    });

    test("a paged row never seen is sought by its element's key, jumped to and scrolled to — leaving no search behind", async () => {
        const host = hostState();
        const { c } = mount([], host, { root: { rows: variant("paged", blocksSource(pagedSource())) } });
        host.set({ focus: some(rowId("g40c2")) });
        await microtasks();
        await microtasks();
        expect(c.getSnapshot().paging.rows.some((r) => r.key === rowKey("g40c2"))).toBe(true);
        expect(c.getSnapshot().scroll).toMatchObject({ owner: "nav", nav: { key: rowItem("g40c2"), align: "start" } });
        expect(c.getSnapshot().seek.sought).toBeNull();
    });
});

describe("the source's channels (#815)", () => {
    /** A tracker with explicit channels, and a source whose windows are in
     *  flight until `open` — each window's read registers its channel. */
    function heldSource(windows: number) {
        const subs = new Map<string, Set<() => void>>();
        let recording: string[] | null = null;
        const tracker: ReactiveTracker = {
            id: "c815-channels",
            enableTracking() { recording = []; },
            disableTracking() { const r = recording ?? []; recording = null; return r; },
            getStore: () => ({
                subscribe(key, cb) {
                    const set = subs.get(key) ?? new Set<() => void>();
                    set.add(cb);
                    subs.set(key, set);
                    return () => { set.delete(cb); };
                },
                getKeyVersion: () => 0,
            }),
        };
        const state = { open: false };
        const source = {
            id: "c815-held",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                recording?.push(`w${w}`);
                if (!state.open) return none;
                return some([0, 1].map((i) => planRow(`w${w}r${i}`)));
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const fire = (key: string) => { for (const cb of [...(subs.get(key) ?? [])]) cb(); };
        return { tracker, source, state, fire };
    }

    let unregister: (() => void) | undefined;
    afterEach(() => { unregister?.(); unregister = undefined; });

    test("a landing is ONE notification, however many windows it settles", () => {
        const h = heldSource(10);
        unregister = registerReactiveTracker(h.tracker);
        const { c, notified } = show(root([], { source: h.source }));
        expect(c.getSnapshot().paging.rows).toHaveLength(0);
        const n = notified();
        h.state.open = true;
        h.fire("w0");
        // Window 0 landed, the ledger learned it, the demand ring advanced and
        // its windows landed too — one settle, one notification.
        expect(c.getSnapshot().paging.rows.length).toBeGreaterThan(2);
        expect(notified()).toBe(n + 1);
        // The live region says what landed, in that same notification (#819).
        const resident = c.getSnapshot().paging.resident!;
        expect(c.getSnapshot().announce?.text)
            .toBe(`Loaded elements 1–${resident.to.toLocaleString()} of ${(10 * PLAN_PAGE_SIZE).toLocaleString()}`);
    });

    test("connect after a disconnect listens again — a rehearsed unmount does not deafen the canvas", () => {
        const h = heldSource(10);
        unregister = registerReactiveTracker(h.tracker);
        const { c } = show(root([], { source: h.source }));
        // StrictMode mounts, unmounts and mounts again.
        const disconnect = c.connect();
        disconnect();
        h.state.open = true;
        h.fire("w0");
        expect(c.getSnapshot().paging.rows).toHaveLength(0);
        const again = c.connect();
        // Reconnecting reads again — what landed meanwhile arrives.
        expect(c.getSnapshot().paging.rows.length).toBeGreaterThan(0);
        again();
    });

    test("once disconnected for good, a landing reaches nobody", () => {
        const h = heldSource(10);
        unregister = registerReactiveTracker(h.tracker);
        const { c, notified }: { c: PlanController; notified: () => number } = show(root([], { source: h.source }));
        c.connect()();
        const n = notified();
        h.state.open = true;
        h.fire("w0");
        expect(notified()).toBe(n);
    });
});

describe("a new source revision (#821)", () => {
    /** A source that answers a key search at once and names its revision;
     *  reading the revision registers the "rev" channel, as the runtime's
     *  source-level channel does. */
    function revisionedSource() {
        const subs = new Map<string, Set<() => void>>();
        let recording: string[] | null = null;
        const tracker: ReactiveTracker = {
            id: "c821-revision",
            enableTracking() { recording = []; },
            disableTracking() { const r = recording ?? []; recording = null; return r; },
            getStore: () => ({
                subscribe(key, cb) {
                    const set = subs.get(key) ?? new Set<() => void>();
                    set.add(cb);
                    subs.set(key, set);
                    return () => { set.delete(cb); };
                },
                getKeyVersion: () => 0,
            }),
        };
        const state: { revision: string | undefined } = { revision: undefined };
        const source = {
            id: "c821",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                return some([0, 1].map((i) => planRow(`w${w}r${i}`)));
            },
            total: () => some(BigInt(2 * PLAN_PAGE_SIZE)),
            seek: some(() => some({ found: true, row: 0n, count: 1n })),
            revision: () => {
                recording?.push("rev");
                return state.revision === undefined ? none : some(state.revision);
            },
            refresh: () => null,
        };
        const fire = (key: string) => { for (const cb of [...(subs.get(key) ?? [])]) cb(); };
        return { tracker, source, state, fire };
    }

    let unregister: (() => void) | undefined;
    afterEach(() => { unregister?.(); unregister = undefined; });

    test("drops a standing search — its matches index the previous snapshot — and re-keys the control", async () => {
        const h = revisionedSource();
        h.state.revision = "A";
        unregister = registerReactiveTracker(h.tracker);
        const { c } = show(root([], { source: h.source }));
        expect(await c.search.find({ prefix: "w0" })).toEqual({ found: true, row: 0, count: 1 });
        expect(c.getSnapshot().seek.sought).not.toBeNull();
        expect(c.getSnapshot().seek.epoch).toBe(0);
        h.state.revision = "B";
        h.fire("rev");
        expect(c.getSnapshot().paging.revision).toBe("B");
        expect(c.getSnapshot().seek.sought).toBeNull();
        expect(c.getSnapshot().seek.epoch).toBe(1);
    });

    test("a key search targets the first row its element placed — a `views` entry's first view row (#822)", async () => {
        // Each element places two view rows and a child under the first:
        // the stream is `jobs/e0, util/e0, jobs-child/e0/c, jobs/e1, …`.
        const elements = ["e0", "e1", "e2", "e3"];
        const viewRows = elements.flatMap((e) => [
            planRow(e, span(), undefined, "jobs"),
            planRow(e, span(), undefined, "util"),
            { ...planRow(`${e}-c`, span(), undefined, "jobs-child"),
                id: variant("entry", { series: "jobs-child", path: [e, "c"] }),
                parent: some(rowId(e, "jobs")) } as unknown as PlanWireRow,
        ]);
        const source = {
            id: "c822-seek",
            page: () => some(viewRows),
            total: () => some(BigInt(elements.length)),
            seek: some(() => some({ found: true, row: 2n, count: 1n })),
            revision: () => none,
            refresh: () => null,
        };
        const { c } = show(root([], { source }));
        await c.search.find({ key: '"e2"' });
        expect(c.getSnapshot().scroll.targetKey).toBe(rowKey("e2", "jobs"));
        // A prefix, or a key between two, lands on the next element's first row.
        await c.search.find({ prefix: "e1" });
        expect(c.getSnapshot().scroll.targetKey).toBe(rowKey("e1", "jobs"));
        await c.search.find({ key: '"e10"' });
        expect(c.getSnapshot().scroll.targetKey).toBe(rowKey("e2", "jobs"));
        // The labels are the elements, each once, in key order from the key.
        expect(await c.search.listRange(0, 3)).toEqual(["e2", "e3"]);
    });

    test("the first revision a source names is not a move — a search asked before it survives", async () => {
        const h = revisionedSource();
        unregister = registerReactiveTracker(h.tracker);
        const { c } = show(root([], { source: h.source }));
        await c.search.find({ prefix: "w0" });
        h.state.revision = "A";
        h.fire("rev");
        expect(c.getSnapshot().paging.revision).toBe("A");
        expect(c.getSnapshot().seek.sought).not.toBeNull();
        expect(c.getSnapshot().seek.epoch).toBe(0);
    });
});

describe("paged heights follow the canvas (#823)", () => {
    /** 50 windows, each ONE group entry with ten members — 346px at rest (a
     *  26px band + 10 × 32px, above the ledger's 1px-per-element floor for its
     *  200 elements), 26px folded. */
    function groupedSource() {
        return {
            id: "c823-grouped",
            page: (offset: bigint) => {
                const w = Number(offset) / PLAN_PAGE_SIZE;
                return some([
                    planRow(`g${w}`, group()),
                    ...Array.from({ length: 10 }, (_u, i) => planRow(`g${w}c${i}`, span(), `g${w}`)),
                ]);
            },
            total: () => some(BigInt(50 * PLAN_PAGE_SIZE)),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
    }
    const headOf = (c: PlanController) => c.getSnapshot().paging.blocks[0]!.head!;

    test("collapse all with rows in EVICTED windows moves the head band exactly — and back", () => {
        const { c } = show(root([], { source: groupedSource() }));
        // A jump to window 30 leaves windows 0–2 — seen at first paint —
        // evicted into the head band with the 26 never-seen windows before 29.
        c.search.jump(30 * PLAN_PAGE_SIZE);
        c.committed(c.getSnapshot().paging);
        expect(c.getSnapshot().paging.blocks[0]!.resident!.from).toBe(29 * PLAN_PAGE_SIZE);
        const before = headOf(c).px;
        expect(before).toBe(29 * 346);
        // Collapse all: the group grain folds every entry to its band. The
        // windows the canvas has seen draw at 26px now — exactly what their
        // rows would draw inline — and the never-seen ones stay estimates.
        c.dispatch({ t: "grain.set", grain: "group" });
        expect(headOf(c).px).toBe(before - 3 * (346 - 26));
        // And back.
        c.dispatch({ t: "grain.set", grain: "resource" });
        expect(headOf(c).px).toBe(before);
    });

    test("a collapse toggle re-measures the window its row sits in; a selection re-measures nothing", () => {
        const { c } = show(root([], { source: groupedSource() }));
        c.search.jump(30 * PLAN_PAGE_SIZE);
        c.committed(c.getSnapshot().paging);
        const before = c.getSnapshot().paging.blocks[0]!;
        c.dispatch({ t: "row.select", key: rowKey("g30c1") });
        expect(c.getSnapshot().paging.blocks[0]).toBe(before);
        // Folding a RESIDENT entry changes no band — only evicted windows are
        // bands — but it is measured, so the band follows once it leaves.
        c.dispatch({ t: "group.toggle", key: rowKey("g30") });
        expect(c.getSnapshot().paging.blocks[0]!.head).toBe(before.head);
        c.search.jump(45 * PLAN_PAGE_SIZE);
        c.committed(c.getSnapshot().paging);
        // Windows 0–2 and 29–33 are evicted now; window 30 draws 26px.
        const head = c.getSnapshot().paging.blocks[0]!.head!;
        expect(head.px).toBe(44 * 346 - (346 - 26));
    });
});
