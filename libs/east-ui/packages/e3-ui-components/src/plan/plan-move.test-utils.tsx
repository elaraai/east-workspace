/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's moves under test (#825) — ONE canvas, built by the e3-ui
 * factory and COMPILED over a `State.bind` handle written through the
 * `onUpdate` adapter, whose presses hold four lists, each a series that
 * declares a move's fields:
 *
 * - `jobs` — runs (a span series) of the `Job` item type;
 * - `backlog` — more runs of the SAME item type, on another series;
 * - `shifts` — chips (a cards series) of the `Shift` item type;
 * - `slots` — tiles (a buckets series) of the `Slot` item type.
 *
 * Each series is a block of the presses' rows, in that order. jsdom has no
 * layout, so {@link layOutPlots} stacks every row's plot at a fixed rect —
 * twelve weeks, 100px each — and `document.elementFromPoint` answers from them.
 *
 * The editing wire is PROBED, never replaced: every patch event is decoded
 * and kept.
 */

import { act, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, StringType, StructType,
    decodeBeast2For, some, type ValueTypeOf,
} from "@elaraai/east";
import { DragEventType, State } from "@elaraai/east-ui/internal";
import { Plan } from "@elaraai/e3-ui/internal";
import { system, getRegisteredPlatformImplementations, DragLayerProvider } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { layOut } from "@elaraai/east-ui-components/testing";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { rowKey, rowSel } from "./plan.test-utils.js";

// ── The canvas's data ───────────────────────────────────────────────────────

/** Monday of ISO week `n`, 2026 — W27 is 2026-06-29. */
export const W = (n: number): Date => new Date(Date.UTC(2026, 5, 29 + 7 * (n - 27)));
/** A day after a Monday. */
export const D = (n: number, day: number): Date => new Date(W(n).getTime() + day * 86_400_000);

export const Job = StructType({ key: StringType, label: StringType, start: DateTimeType, end: DateTimeType });
export const Shift = StructType({ key: StringType, label: StringType, from: DateTimeType, to: DateTimeType });
export const Slot = StructType({ key: StringType, label: StringType, at: DateTimeType });
export const Press = StructType({
    label: StringType, jobs: ArrayType(Job), backlog: ArrayType(Job), shifts: ArrayType(Shift), slots: ArrayType(Slot),
});
export const Presses = DictType(StringType, Press);
export type PressValue = ValueTypeOf<typeof Press>;
export type JobValue = ValueTypeOf<typeof Job>;

/** Press 1 holds one of everything; Press 2 nothing. */
export const SEED: Map<string, PressValue> = new Map([
    ["m1", {
        label: "M1",
        jobs: [{ key: "j1", label: "J1", start: W(28), end: W(30) }],
        backlog: [],
        shifts: [{ key: "s1", label: "S1", from: W(27), to: W(29) }],
        slots: [{ key: "t1", label: "T1", at: W(29) }],
    }],
    ["m2", { label: "M2", jobs: [], backlog: [], shifts: [], slots: [] }],
]);

/** The canvas's drop-target id. */
export const SURFACE = "presses-plan";
/** The series, in layout order. */
export const SERIES_KEYS = ["jobs", "backlog", "shifts", "slots"] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];

const SERIES = [
    Plan.series.span(Press, {
        key: "jobs", title: "Jobs", label: (m) => m.label,
        runs: (m) => m.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: "confirmed" })),
        edit: { items: "jobs", key: "key", start: "start", end: "end" },
    }),
    Plan.series.span(Press, {
        key: "backlog", title: "Backlog", label: (m) => m.label,
        runs: (m) => m.backlog.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: "confirmed" })),
        edit: { items: "backlog", key: "key", start: "start", end: "end" },
    }),
    Plan.series.cards(Press, {
        key: "shifts", title: "Shifts", label: (m) => m.label,
        chips: (m) => m.shifts.map((_$, s) => Plan.chip({ key: s.key, from: s.from, to: s.to, label: s.label, state: "confirmed" })),
        edit: { items: "shifts", key: "key", start: "from", end: "to" },
    }),
    Plan.series.buckets(Press, {
        key: "slots", title: "Slots", label: (m) => m.label,
        events: (m) => m.slots.map((_$, t) => Plan.event({ key: t.key, at: t.at, label: t.label, state: "confirmed" })),
        edit: { items: "slots", key: "key", at: "at" },
    }),
];

/** A `canDrop` that refuses every move onto Press 2's jobs row. */
const M2_JOBS = rowKey("m2", "jobs");
const NOT_M2_JOBS = East.function([DragEventType], BooleanType, ($, event) => {
    const allowed = $.let(true);
    $.match(event, { move: ($2, m) => { $2.assign(allowed, m.to.row.equal(M2_JOBS).not()); } });
    return allowed;
});

/** Twelve weeks, W27 to W38. */
const AXIS = Plan.axis({ window: { min: W(27), max: W(39) }, resolution: "week" });

const STATE_KEY = "plan-825.presses";

// ── The canvas ──────────────────────────────────────────────────────────────

/** One gesture's patch event, decoded. */
const PatchEventType = Plan.Types.PatchEvent(Press);
export type MovePatch = ValueTypeOf<typeof PatchEventType>;
const decodePatch = decodeBeast2For(PatchEventType);
const decodePresses = decodeBeast2For(Presses);

/** A mounted canvas, and what the test reads and drives it through. */
export interface MoveCanvas extends RenderResult {
    /** Every gesture's patch event, in order. */
    patches: MovePatch[];
    /** What the source holds now. */
    stored: () => ReadonlyMap<string, PressValue>;
    /** Let everything in flight land. */
    settle: () => Promise<void>;
}

/** Let everything in flight land — microtasks, and timers queued behind them. */
export async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/**
 * Build, compile and mount the presses canvas, and wait for it to draw.
 *
 * @param options - `veto`: a `canDrop` that refuses Press 2's jobs row; `seed`: the presses, in place of
 *   {@link SEED}; `id: false`: the canvas declares no drop-target id
 * @returns The mounted canvas
 */
export async function mountMoves(options: { veto?: boolean; seed?: Map<string, PressValue>; id?: boolean } = {}): Promise<MoveCanvas> {
    const seed = options.seed ?? SEED;
    const program = East.compile(East.function([], Plan.Types.Root, ($) => {
        const presses = $.const(State.bind([Presses], STATE_KEY, seed));
        return Plan.Payload({
            axis: AXIS,
            data: presses,
            series: SERIES,
            ...(options.id !== false ? { id: SURFACE } : {}),
            ...(options.veto === true ? { canDrop: NOT_M2_JOBS } : {}),
            editing: { onUpdate: presses.write },
        });
    }), getRegisteredPlatformImplementations());
    const patches: MovePatch[] = [];
    const view = (): PlanRootValue => {
        const root = program();
        if (root.editing.type !== "some") return root;
        const wire = root.editing.value;
        return {
            ...root,
            editing: some({
                ...wire,
                onPatch: some((bytes: Uint8Array) => {
                    patches.push(decodePatch(bytes));
                    return null;
                }),
            }),
        } as unknown as PlanRootValue;
    };
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraPlan value={view()} storageKey="plan-825" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await waitFor(() => {
        if (utils.container.querySelector(rowSel("m1", "data-plan-row", "jobs")) === null) throw new Error("the presses have not drawn yet");
    });
    await settle();
    return {
        ...utils,
        patches,
        stored: () => decodePresses(getStore().read(STATE_KEY)!),
        settle,
    };
}

// ── Reading and driving the canvas ──────────────────────────────────────────

/** A press's row in a series. */
export const rowOf = (c: HTMLElement, series: SeriesKey, press: string): HTMLElement =>
    c.querySelector<HTMLElement>(rowSel(press, "data-plan-row", series))!;

/** A row's plot — its drop cell. */
export const plotOf = (c: HTMLElement, series: SeriesKey, press: string): HTMLElement =>
    rowOf(c, series, press).querySelector<HTMLElement>("[data-plan-plot]")!;

/** The element a series draws for an item, in a press's row. */
export function elementOf(c: HTMLElement, series: SeriesKey, press: string, key: string): HTMLElement | null {
    const attr = series === "shifts" ? "data-chip" : series === "slots" ? "data-event" : "data-run";
    return rowOf(c, series, press).querySelector<HTMLElement>(`[${attr}=${JSON.stringify(key)}]`);
}

/** The keys a press's row draws, in order. */
export function keysOf(c: HTMLElement, series: SeriesKey, press: string): string[] {
    const attr = series === "shifts" ? "data-chip" : series === "slots" ? "data-event" : "data-run";
    return [...rowOf(c, series, press).querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr)!);
}

/** A row's draft mark, when a draft changed it. */
export function markOf(c: HTMLElement, series: SeriesKey, press: string): "pending" | "incomplete" | "invalid" | undefined {
    const row = rowOf(c, series, press);
    if (!row.hasAttribute("data-draft")) return undefined;
    return row.hasAttribute("data-invalid") ? "invalid" : row.hasAttribute("data-incomplete") ? "incomplete" : "pending";
}

/** The plots' left edge, and the week's width in px — twelve weeks, W27 to W38. */
export const PLOT_LEFT = 200;
export const WEEK_PX = 100;
/** The client x of a point `days` into week `n`. */
export const xAt = (n: number, days = 3.5): number => PLOT_LEFT + (n - 27) * WEEK_PX + (days / 7) * WEEK_PX;

/**
 * Lay out every row's plot: stacked 40px apart in layout order, each spanning
 * the twelve weeks — and `document.elementFromPoint` answering from them.
 *
 * @param c - The canvas
 * @returns Each plot's vertical centre, by series and press
 */
export function layOutPlots(c: HTMLElement): (series: SeriesKey, press: string) => number {
    const rects = new Map<Element, { left: number; top: number; width: number; height: number }>();
    const tops = new Map<string, number>();
    let top = 0;
    for (const series of SERIES_KEYS) {
        for (const press of ["m1", "m2"]) {
            rects.set(plotOf(c, series, press), { left: PLOT_LEFT, top, width: 12 * WEEK_PX, height: 32 });
            tops.set(`${series}/${press}`, top + 16);
            top += 40;
        }
    }
    layOut(rects);
    return (series, press) => tops.get(`${series}/${press}`)!;
}

/**
 * Press an element (or one of its end handles) and carry it past the drag's
 * threshold to a point — the drop not yet made. One event at a time, the
 * canvas rendering between them as a browser's does.
 *
 * @param from - The element or handle pressed
 * @param at - Where it is pressed
 * @param to - Where the pointer rests
 * @param shiftKey - Whether Shift is held on the way
 * @returns Let go there
 */
export async function carry(
    from: HTMLElement, at: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false,
): Promise<() => Promise<void>> {
    await act(async () => { fireEvent.pointerDown(from, { clientX: at.x, clientY: at.y, button: 0, shiftKey }); });
    await act(async () => { fireEvent.pointerMove(document, { clientX: at.x + 6, clientY: at.y, shiftKey }); });
    await act(async () => { fireEvent.pointerMove(document, { clientX: to.x, clientY: to.y, shiftKey }); });
    return async () => {
        await act(async () => { fireEvent.pointerUp(document, { clientX: to.x, clientY: to.y, shiftKey }); });
        await settle();
    };
}

/**
 * Drag an element from one point to another and let go.
 *
 * @param from - The element or handle pressed
 * @param at - Where it is pressed
 * @param to - Where it is let go
 * @param shiftKey - Whether Shift is held
 */
export async function dragTo(from: HTMLElement, at: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false): Promise<void> {
    const letGo = await carry(from, at, to, shiftKey);
    await letGo();
}

/** Press a key on the focused element — it bubbles to the canvas. */
export async function keyOn(init: { key: string; shiftKey?: boolean; altKey?: boolean }): Promise<void> {
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, init); });
    await settle();
}

/** What the keyboard carry last said. */
export function carrySaid(c: HTMLElement): string {
    return c.querySelector("[data-plan-carry-announce]")?.textContent ?? "";
}
