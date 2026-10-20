/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's editing session under test (#880) — ONE canvas, a row per press
 * that takes dropped jobs as its decisions, built by the e3-ui factory and
 * COMPILED over a source the test holds. The same canvas
 * inline and paged, so a test states one behaviour and runs it on both:
 *
 * - inline, over a `State.bind` handle written through the `onUpdate`
 *   adapter — the host renders again with its latest value, as a `Reactive`
 *   would ({@link EditingCanvas.confirm});
 * - paged, over a PINNED source — the only windowed kind a canvas edits —
 *   the presses' record on e3 itself (#1375), read with `Data.bindPaged` and
 *   saved with `Record.onApply` through its patch door: e3 commits each Save
 *   as a new revision, which the source reads once the test lets the reads
 *   after it land ({@link EditingCanvas.confirm}). A file whose canvases are
 *   paged calls {@link canvasHarness} once, at its top.
 *
 * The editing wire is PROBED, never replaced: every patch event is decoded
 * and kept, every apply request's bytes kept, and the real callback answers.
 */

import { useMemo, type ReactNode } from "react";
import { fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { BooleanType, East, StringType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { DragEventType, Editing, State } from "@elaraai/east-ui/internal";
import { Data, Plan, Record } from "@elaraai/e3-ui/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import { system, getRegisteredPlatformImplementations, DragLayerProvider, useDragSourceItem } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { pointAt } from "@elaraai/east-ui-components/testing";
import { patchRecord } from "../e3-web.test-utils.js";
import { E3Surface, currentHarness, e3Harness, settle as settleE3, type E3Harness } from "../e3-web-mount.test-utils.js";
import { act } from "../test-runs.test-utils.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanEventRows } from "./root/events.js";
import { rowKey, rowSel } from "./plan.test-utils.js";

// ── The canvas's data ───────────────────────────────────────────────────────

/** A job dropped on a press — a decision at the bucket it landed in. */
export const Job = records.PlanPressJob;
/** A press — its name, the crew that runs it (none yet), and the jobs dropped on it. */
export const Press = records.PlanPress;
/** The canvas's source — presses by key: the presses' record's type. */
export const Presses = records.planPresses.type;
/** One press, decoded. */
export type PressValue = ValueTypeOf<typeof Press>;

/** Three presses, no job on any: Press 2 has no crew yet — what the presses' record holds as it is deployed. */
export const SEED: ReadonlyMap<string, PressValue> = records.planPresses.default as ReadonlyMap<string, PressValue>;

/** The presses series' key — every press row's id is `entry { series, [key] }`. */
export const PRESSES = "presses";
/** The canvas's drop-target id. */
export const SURFACE = "presses-plan";
/** The library its jobs come from. */
export const JOBS = "jobs";

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
/** An ordinal axis's twelve phases. */
export const PHASES = Array.from({ length: 12 }, (_u, i) => `P${i + 1}`);

const AXES = {
    time: Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }),
    number: Plan.axis.number({ window: { min: 1, max: 13 }, step: 1 }),
    ordinal: Plan.axis.ordinal({ values: PHASES }),
};

/** The presses as rows — each taking a dropped job into `jobs`. */
const PRESS_ROWS = Plan.series.span(Press, {
    key: PRESSES, title: "Presses",
    label: (p) => p.label,
    runs: () => [],
    decisions: (p) => p.jobs.map((_$, j) => Plan.decision({ key: j.key, at: j.at, applied: false })),
    edit: { items: "jobs", create: (drop) => ({ key: drop.from.key, at: drop.at }) },
});
/** A second row per press that takes no gesture — its series names no field. */
const LOADS = Plan.series.span(Press, { key: "loads", title: "Loads", label: (p) => p.label, runs: () => [] });
/** The press's marks series' key. */
export const MARKS = "press-marks";
/** A row per press whose marks are its jobs, and move (#825) — a job's key and instant are a mark's. */
const MOVING = Plan.series.events(Press, {
    key: MARKS, title: "Marks", label: (p) => p.label,
    marks: (p) => p.jobs.map((_$, j) => Plan.mark({ key: j.key, at: j.at, kind: "milestone" })),
    edit: { items: "jobs", key: "key", at: "at" },
});
/** The author's check: a press holds one job at most, and runs one only with its crew. */
const READY = East.function([Press, StringType], Editing.Types.Readiness, ($, press) => {
    const result = $.let(variant("ready", null), Editing.Types.Readiness);
    $.if(press.jobs.size().greater(1n), ($2) => {
        $2.assign(result, variant("invalid", [{ field: "jobs", message: "One job per press" }]));
    });
    $.if(press.crew.hasTag("none").and(() => press.jobs.size().greater(0n)), ($2) => {
        $2.assign(result, variant("incomplete", [{ field: "crew", message: "A press runs a job only with its crew" }]));
    });
    return result;
});

/** A drop vetted by the canvas: a job lands on Press 1 alone. */
const PRESS_1_ROW = rowKey("p1", PRESSES);
const ONLY_PRESS_1 = East.function([DragEventType], BooleanType, ($, event) => {
    const allowed = $.let(false);
    $.match(event, { add: ($2, add) => { $2.assign(allowed, add.into.row.equal(PRESS_1_ROW)); } });
    return allowed;
});

// ── The presses on e3 ───────────────────────────────────────────────────────

const encodePresses = encodeBeast2For(Presses);
const decodePresses = decodeBeast2For(Presses);

/** The presses' record, as its dataset's requests name it. */
const PRESSES_DATASET = `records.${records.planPresses.name}`;

/** The e3-ui example module a paged canvas reads: a file's harness deploys it ({@link canvasHarness}, or among its own). */
export const CANVAS_MODULES = { "plan/plan-records": records } as const;

/** The file's e3, which deploys the presses' record. */
const e3Of = (): E3Harness => currentHarness();

/**
 * Gives a file whose canvases are paged, and that mounts nothing else on e3,
 * its e3: the presses' record deployed once, a workspace of its own for each
 * test. Called once, at the file's top. A file with an e3 harness of its own
 * deploys {@link CANVAS_MODULES} among its modules instead.
 *
 * @returns The harness
 */
export function canvasHarness(): E3Harness {
    return e3Harness(CANVAS_MODULES, { measure: false });
}

// ── The canvas ──────────────────────────────────────────────────────────────

/** Where the inline canvas's presses are bound. */
const STATE_KEY = "plan-880.presses";

/** How a test's canvas is built. */
export interface CanvasOptions {
    /** Where the rows come from — inline, or a paged source (a pinned one: it names its snapshot). */
    arm: "inline" | "paged";
    /** The axis kind (default `"time"`). */
    axis?: "time" | "number" | "ordinal";
    /** Whether the canvas declares editing (default `true`). */
    editing?: boolean;
    /** A second row per press beside the first, that takes no gesture. */
    alongside?: boolean;
    /** A row per press whose marks are its jobs, and move (#825). */
    moves?: boolean;
    /** Whether the canvas is a drop target — an `id` (default `true`). */
    target?: boolean;
    /** The libraries it takes jobs from (default `[JOBS]`). */
    sources?: string[];
    /** A `canDrop` that takes a job on Press 1 alone. */
    onlyPress1?: boolean;
    /** The author's readiness check ({@link READY}). */
    ready?: boolean;
    /** The presses (default {@link SEED}). */
    seed?: ReadonlyMap<string, PressValue>;
    /** Paged: windows past this element stay in flight. */
    heldFrom?: number;
    /** The canvas's storage key. */
    storageKey?: string;
    /** What the canvas renders inside — a message table, a locale. */
    wrap?: (plan: ReactNode) => ReactNode;
    /** Event kinds' rows ahead of the presses' (#1192), as a Plan of event kinds hands them over. */
    events?: PlanEventRows;
}

type Resolved = Required<Omit<CanvasOptions, "heldFrom" | "seed" | "events">> & Pick<CanvasOptions, "heldFrom" | "events"> & { seed: Map<string, PressValue> };

/** The root's chrome besides its rows and editing. */
function chromeOf(o: Resolved) {
    return {
        ...(o.target ? { id: SURFACE } : {}),
        sources: o.sources,
        ...(o.onlyPress1 ? { canDrop: ONLY_PRESS_1 } : {}),
    };
}

/** The canvas's program — the factory's payload, compiled with the test's platform. */
function compileCanvas(o: Resolved): () => PlanRootValue {
    const series = [PRESS_ROWS, ...(o.alongside ? [LOADS] : []), ...(o.moves ? [MOVING] : [])];
    const axis = AXES[o.axis];
    const chrome = chromeOf(o);
    const ready = o.ready ? { ready: READY } : {};
    const program = o.arm === "inline"
        ? East.function([], Plan.Types.Root, ($) => {
            const presses = $.const(State.bind([Presses], STATE_KEY, o.seed));
            return Plan.Root({
                axis, data: presses, series, ...chrome,
                ...(o.editing ? { editing: { onUpdate: presses.write, ...ready } } : {}),
            });
        })
        : East.function([], Plan.Types.Root, ($) => {
            // The presses' record on e3: read a window at a time, pinned, and saved through its patch door.
            const presses = $.const(Record.bind(records.planPresses, [records.planPressesPatch]));
            const source = $.const(Data.bindPaged(records.planPresses));
            const onApply = $.const(Record.onApply(presses, { keyed: true }));
            return Plan.Root({
                axis, data: source, series, ...chrome,
                ...(o.editing ? { editing: { onApply, ...ready } } : {}),
            });
        });
    return East.compile(program, getRegisteredPlatformImplementations()) as () => PlanRootValue;
}

/** One gesture's patch event, decoded. */
const PatchEventType = Plan.Types.PatchEvent(Press);
export type PlanPatch = ValueTypeOf<typeof PatchEventType>;
const decodePatch = decodeBeast2For(PatchEventType);

/** What a canvas's editing wire is probed with. */
interface Probe {
    patches: PlanPatch[];
    applies: Uint8Array[];
    loseAck: boolean;
    /** Told as each apply begins: what it writes is read back from here on. */
    writing: () => void;
}

/** The root with its editing wire probed — every patch kept, every apply request kept, the real callback answering. */
function probed(root: PlanRootValue, probe: Probe): PlanRootValue {
    if (root.editing.type !== "some") return root;
    const wire = root.editing.value;
    const apply = wire.onApply.type === "some" ? wire.onApply.value : undefined;
    const observe = wire.onPatch.type === "some" ? wire.onPatch.value : undefined;
    return {
        ...root,
        editing: some({
            ...wire,
            onPatch: some((bytes: Uint8Array) => {
                probe.patches.push(decodePatch(bytes));
                observe?.(bytes);
                return null;
            }),
            onApply: apply === undefined ? none : some(variant("async", async (bytes: Uint8Array) => {
                probe.applies.push(bytes.slice());
                probe.writing();
                const result = apply.type === "sync" ? apply.value(bytes) : await apply.value(bytes);
                // Persisted — and the answer lost on its way back.
                if (probe.loseAck) {
                    probe.loseAck = false;
                    throw new Error("Acknowledgement lost");
                }
                return result;
            })),
        }),
    } as unknown as PlanRootValue;
}

/** A job card in the jobs library — a drag source, by pointer or keyboard. */
function JobCard({ job }: { job: string }) {
    const drag = useDragSourceItem({ library: JOBS, key: job, label: job }, <div />);
    return <div data-testid={`job-${job}`} {...drag} />;
}

/** A mounted canvas, and what the test reads and drives it through. */
export interface EditingCanvas extends RenderResult {
    /** Which arm it is. */
    arm: CanvasOptions["arm"];
    /** Every gesture's patch event, in order. */
    patches: PlanPatch[];
    /** Every apply request's bytes, in order. */
    applies: Uint8Array[];
    /** What the source holds now: paged, what e3 holds, read as another session would. */
    stored: () => Promise<ReadonlyMap<string, PressValue>>;
    /** How many writes the source took: paged, the commits through the record's patch door since the canvas mounted. */
    writes: () => Promise<number>;
    /** The source reads back what it committed — inline, the host renders its latest value; paged, the refreshed revision lands. */
    confirm: () => Promise<void>;
    /** Another writer changes the source, and the canvas reads it. */
    move: (next: ReadonlyMap<string, PressValue>) => Promise<void>;
    /** Paged: another writer commits while the canvas's next Save is on its way to e3 — the Save then meets it. */
    race: (next: ReadonlyMap<string, PressValue>) => void;
    /** The next apply persists, then loses its acknowledgement. */
    loseNextAck: () => void;
    /** Let everything in flight land. */
    settle: () => Promise<void>;
}

const cleanups: (() => void)[] = [];

/** Unregister what a mounted canvas registered. Call after each test. */
export function releaseCanvases(): void {
    while (cleanups.length > 0) cleanups.pop()!();
}

/** The canvas, its program evaluated once the runtimes it reads through are installed. */
function Canvas({ view, storageKey, wrap, events }: {
    view: () => PlanRootValue; storageKey: string; wrap: (plan: ReactNode) => ReactNode; events: PlanEventRows | undefined;
}) {
    const value = useMemo(() => view(), [view]);
    return <>{wrap(<EastChakraPlan value={value} storageKey={storageKey} events={events} />)}</>;
}

/** Let everything in flight land — microtasks, timers queued behind them, and every request to e3. */
export async function settle(): Promise<void> {
    await settleE3();
}

/**
 * Build, compile and mount a canvas, and wait for its presses to draw.
 *
 * @param options - How the canvas is built ({@link CanvasOptions})
 * @returns The mounted canvas
 */
export async function mountCanvas(options: CanvasOptions): Promise<EditingCanvas> {
    const o: Resolved = {
        axis: "time", editing: true, alongside: false, moves: false, target: true, sources: [JOBS],
        onlyPress1: false, ready: false, storageKey: `plan-880-${options.arm}`, wrap: (plan) => plan, ...options,
        seed: new Map(options.seed ?? SEED),
    };
    // Paged: the windows read after a Save begins are held on their way to e3 until the test lets them land (`confirm`).
    let afterWrite = false;
    const probe: Probe = { patches: [], applies: [], loseAck: false, writing: () => { afterWrite = o.arm === "paged"; } };
    const program = compileCanvas(o);
    const h = o.arm === "paged" ? e3Of() : undefined;
    const readsBack = h?.e3.hold((request) => afterWrite && request.dataset === PRESSES_DATASET && request.kind === "page");
    const patchCommits = async () => (await e3Of().history(records.planPresses)).commits.filter((commit) => commit.mutation === "patch").length;
    // Presses of the test's own: another session's write, before the canvas mounts.
    if (h !== undefined && options.seed !== undefined) await h.patch(records.planPresses, new Map(options.seed));
    const baseline = h === undefined ? 0 : await patchCommits();
    const view = (): PlanRootValue => probed(program(), probe);
    const plan = (value: () => PlanRootValue) => <Canvas view={value} storageKey={o.storageKey} wrap={o.wrap} events={o.events} />;
    const tree = (value: () => PlanRootValue) => (
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <JobCard job="job-1" />
                <JobCard job="job-2" />
                {o.arm === "paged" ? <E3Surface>{plan(value)}</E3Surface> : plan(value)}
            </DragLayerProvider>
        </ChakraProvider>
    );
    // The inline host renders again with its latest value, as a `Reactive` does: a new view, evaluated afresh.
    let rendered = view;
    const utils = render(tree(rendered));
    const rerenderLatest = () => act(() => { rendered = () => view(); utils.rerender(tree(rendered)); });
    const stateBaseline = getStore().getKeyVersion(STATE_KEY);
    // The first press drawn — a row on the canvas, a card in the narrow layout.
    const first = [...o.seed.keys()][0]!;
    await waitFor(() => {
        if (utils.container.querySelector(`${rowSel(first, "data-plan-row", PRESSES)}, ${rowSel(first, "data-plan-card", PRESSES)}`) === null) {
            throw new Error("the presses have not drawn yet");
        }
    }, { timeout: 30_000 });
    await settle();
    return {
        ...utils,
        arm: o.arm,
        patches: probe.patches,
        applies: probe.applies,
        stored: async () => (h !== undefined ? await h.read(records.planPresses) : decodePresses(getStore().read(STATE_KEY)!)),
        writes: async () => (h !== undefined ? await patchCommits() - baseline : getStore().getKeyVersion(STATE_KEY) - stateBaseline),
        confirm: async () => {
            if (readsBack !== undefined) {
                afterWrite = false;
                await act(async () => { while (readsBack.held > 0) readsBack.releaseOne(); });
            } else rerenderLatest();
            await settle();
        },
        move: async (next) => {
            if (h !== undefined) await h.patch(records.planPresses, new Map(next));
            else {
                act(() => { getStore().write(STATE_KEY, encodePresses(new Map(next))); });
                rerenderLatest();
            }
            await settle();
        },
        race: (next) => {
            if (h === undefined) throw new Error("only a paged source commits unseen");
            const save = h.e3.hold((request) => request.kind === "mutate" && request.record === records.planPresses.name);
            void save.holding.then(() => h.e3.background((async () => {
                await patchRecord(h.e3, h.workspace, records.planPresses, new Map(next));
                save.release();
            })()));
        },
        loseNextAck: () => { probe.loseAck = true; },
        settle,
    };
}

// ── Reading and driving the canvas ──────────────────────────────────────────

/** A press's row. */
export const pressRow = (c: HTMLElement, press: string): HTMLElement =>
    c.querySelector<HTMLElement>(rowSel(press, "data-plan-row", PRESSES))!;

/** The draft mark a press wears — its row on the canvas, its card in the narrow layout: `pending`, `incomplete`, `invalid`, or none. */
export function markOf(c: HTMLElement, press: string): "pending" | "incomplete" | "invalid" | undefined {
    const drawn = c.querySelector<HTMLElement>(`${rowSel(press, "data-plan-row", PRESSES)}, ${rowSel(press, "data-plan-card", PRESSES)}`)!;
    if (!drawn.hasAttribute("data-draft")) return undefined;
    return drawn.hasAttribute("data-invalid") ? "invalid" : drawn.hasAttribute("data-incomplete") ? "incomplete" : "pending";
}

/** Every press's mark, by key. */
export const marks = (c: HTMLElement, presses: readonly string[] = [...SEED.keys()]) =>
    Object.fromEntries(presses.map((p) => [p, markOf(c, p)]));

/** The decisions a press's row draws — its jobs, by key. */
export const jobsDrawn = (c: HTMLElement, press: string): string[] =>
    [...pressRow(c, press).querySelectorAll("[data-mark]")].map((m) => m.getAttribute("data-mark")!);

/** A history bar button, by its name — the bar's own, never a banner's of the same name (#1193). */
export const historyButton = (canvas: RenderResult, name: string): HTMLButtonElement =>
    within(canvas.container.querySelector<HTMLElement>('[data-slot="history"]')!).getByRole("button", { name }) as HTMLButtonElement;

/** The frame's session banner of a kind (`conflict`, `rejected`, `unknown`, `confirm`, `stale`), if it shows. */
export const banner = (c: HTMLElement, kind: string): HTMLElement | null =>
    c.querySelector<HTMLElement>(`[data-frame-slot="banners"] [data-session-banner="${kind}"]`);

/** Press a banner's action — its Retry or its Discard — as a pointer does. */
export async function bannerAction(c: HTMLElement, kind: string, action: "apply" | "refresh" | "discard"): Promise<void> {
    const button = banner(c, kind)!.querySelector<HTMLButtonElement>(`[data-banner-action="${action}"]`)!;
    await act(async () => { fireEvent.click(button); });
    await settle();
}

/** Press a history bar button, as a pointer does. */
export async function history(canvas: RenderResult, name: string): Promise<void> {
    const button = historyButton(canvas, name);
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/** Press a key on the canvas. */
export async function key(c: HTMLElement, init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): Promise<void> {
    await act(async () => { fireEvent.keyDown(c.querySelector("[data-plan-body]")!, init); });
    await settle();
}

/** The history bar's status line, if it says anything — the canvas's own live region is a status too. */
export const statusLine = (canvas: RenderResult): string | null =>
    canvas.container.querySelector('[data-slot="history"] [role="status"]')?.textContent ?? null;

/** A press's drop cell — its plot, when the canvas takes a job there. */
export const dropCellOf = (c: HTMLElement, press: string): HTMLElement | null =>
    pressRow(c, press).querySelector<HTMLElement>("[data-drag-cell]");

/**
 * Drag a job card over a press's plot and hold it there — the drop not yet
 * made. One event at a time, the canvas rendering between them as a
 * browser's does; the move travels past the layer's 4px threshold, so the
 * drag engages on it. jsdom's zero-width rect puts the pointer in the FIRST
 * bucket.
 *
 * @param canvas - The mounted canvas
 * @param job - The card
 * @param press - The press it hovers
 * @returns Let go of the card
 */
export async function hoverJob(canvas: RenderResult, job: string, press: string): Promise<() => Promise<void>> {
    fireEvent.pointerDown(canvas.getByTestId(`job-${job}`), { clientX: 0, clientY: 0 });
    pointAt(dropCellOf(canvas.container, press));
    fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
    return async () => {
        fireEvent.pointerUp(document, { clientX: 10, clientY: 10 });
        await settle();
    };
}

/**
 * Drag a job card over a press's plot and let go.
 *
 * @param canvas - The mounted canvas
 * @param job - The card
 * @param press - The press it is dropped on
 */
export async function dropJob(canvas: RenderResult, job: string, press: string): Promise<void> {
    const letGo = await hoverJob(canvas, job, press);
    await letGo();
}
