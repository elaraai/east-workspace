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
import type { PlanRootValue, PlanRowValue } from "../model.js";
import type { PlanPersisted } from "../persisted.js";
import { PLAN_PAGE_SIZE } from "../use-plan-paging.js";
import { createPlanController, reconciledUi, type PlanController } from "./index.js";

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const DAY = 86_400_000;
const WEEK = 7 * DAY;

const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });
const group = () => variant("group", { summary: none, summaryAggregate: none, collapsed: none });

function planRow(key: string, kind: unknown = span(), parent?: string): PlanRowValue {
    return {
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}

/** A decoded root — inline rows unless a paged source is given; callbacks as
 *  the decoder hands them over (plain functions inside `some`). */
function root(rows: PlanRowValue[], opts: Partial<Record<string, unknown>> = {}): PlanRootValue {
    return {
        rows: opts.source !== undefined ? variant("paged", opts.source) : variant("inline", new Map(rows.map((r) => [r.key, r]))),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [variant("week", null), variant("day", null)], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, review: none, pick: none,
        slice: none, footer: [], id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none, style: none,
        ...opts,
    } as unknown as PlanRootValue;
}

const ROWS = [planRow("G", group()), planRow("g1", span(), "G"), planRow("r1"), planRow("r2"), planRow("r3")];

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
            onSelect: some((e: { key: string }) => { calls.push(`select ${e.key}`); }),
            onGrainChange: some((g: { type: string }) => { calls.push(`grain ${g.type}`); }),
        }));
        c.dispatch({ t: "row.select", key: "r1" });
        c.dispatch({ t: "key", key: "g" });
        // Callbacks fire after the handler, never inside it.
        expect(calls).toEqual([]);
        await microtasks();
        expect(calls).toEqual(["select r1", "grain group"]);
    });

    test("a resolution change is ONE slice write — the resolution and its window together", () => {
        const s = countingSlice("c815-res");
        const { c, notified } = show(root(ROWS, { slice: s.chrome }));
        c.dispatch({ t: "resolution.set", resolution: "day" });
        // Two writes rendered once in between at DAY over the 12-week window.
        expect(s.calls).toEqual({ write: 1, setRange: 0, setResolution: 0 });
        expect(s.state().resolution.value!.type).toBe("day");
        // Zoomed keeping the column count: twelve days from the window's start.
        expect(s.window()).toEqual([W27.getTime(), W27.getTime() + 12 * DAY]);
        // The machine's state did not move — the slice is the window's truth.
        expect(notified()).toBe(0);
    });
});

describe("one notification per action", () => {
    test("an action that changes something notifies once; one that changes nothing, never", () => {
        const { c, notified } = show(root(ROWS));
        c.dispatch({ t: "row.select", key: "r1" });
        expect(notified()).toBe(1);
        // Re-selecting holds (selection is idempotent) — nothing moved.
        c.dispatch({ t: "row.select", key: "r1" });
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
        c.dispatch({ t: "row.select", key: "r2" });
        c.dispatch({ t: "focus.links", key: "r2" });
        const v2 = root(ROWS.filter((r) => r.key !== "r2"));
        // What the canvas's first render of v2 draws — before anything commits.
        const view = reconciledUi(c.getSnapshot().store, {
            alive: new Set(["G", "g1", "r1", "r3"]), complete: true, declaredCollapsed: new Set(), declaredGrain: "resource",
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
        c.dispatch({ t: "row.select", key: "r2" });
        const n = notified();
        const v2 = root(ROWS.filter((r) => r.key !== "r2"));
        c.setValue(v2, v2);
        // Pruned for real, and silently: the canvas drew exactly this.
        expect(c.getSnapshot().store.ui.selected).toBeNull();
        expect(notified()).toBe(n);
    });

    test("a changed DECLARED grain notifies — it clears the selection of a row that is still there", () => {
        const { c, notified } = show(root(ROWS));
        c.dispatch({ t: "row.select", key: "r1" });
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
        c.dispatch({ t: "group.toggle", key: "G" });
        const n = notified();
        const before = c.getSnapshot().store;
        c.setValue(root(ROWS, { onSelect: some(() => undefined) }), v);
        expect(c.getSnapshot().store).toBe(before);
        expect(notified()).toBe(n);
    });
});

describe("the open element overlay", () => {
    const BODY = { body: "A" } as never;
    const runRef = (run: string) => variant("run", { row: "r1", run }) as never;

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
    test("an element click routes by the ref's own tag; a drop reports to onDrag — after the handler", async () => {
        const calls: string[] = [];
        const { c } = show(root(ROWS, {
            onRunClick: some((r: { run: string }) => { calls.push(`run ${r.run}`); }),
            onEventClick: some((e: { event: string }) => { calls.push(`event ${e.event}`); }),
            onDrag: some(() => { calls.push("drag"); }),
        }));
        c.elementClick(variant("event", { row: "r1", event: "e1" }) as never);
        c.elementClick(variant("run", { row: "r1", run: "x1" }) as never);
        c.drop({} as never);
        expect(calls).toEqual([]);
        await microtasks();
        expect(calls).toEqual(["event e1", "run x1", "drag"]);
    });
});

describe("what survives a remount (#813)", () => {
    test("a toggle is written once, when it moves; a selection is never written", () => {
        const writes: PlanPersisted[] = [];
        const { c } = show(root(ROWS), (p) => writes.push(p));
        c.dispatch({ t: "group.toggle", key: "G" });
        expect(writes).toHaveLength(1);
        expect(writes[0]!.collapse).toEqual([["G", true]]);
        c.dispatch({ t: "row.select", key: "r1" });
        c.dispatch({ t: "chart.toggle", key: "r3" });
        expect(writes).toHaveLength(2);
        expect(writes[1]!.charts).toEqual(["r3"]);
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
                return some(new Map([0, 1].map((i) => {
                    const row = planRow(`w${w}r${i}`);
                    return [row.key, row] as const;
                })));
            },
            total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
            seek: none,
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
