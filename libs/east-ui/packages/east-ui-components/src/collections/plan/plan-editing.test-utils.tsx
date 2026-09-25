/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's editing session under test (#880) — ONE canvas, a row per press
 * that takes a verdict and takes dropped jobs as its decisions, built by the
 * east-ui factory and COMPILED over a source the test holds. The same canvas
 * inline and paged, so a test states one behaviour and runs it on both:
 *
 * - inline, over a `State.bind` handle written through the `onUpdate`
 *   adapter — the host renders again with its latest value, as a `Reactive`
 *   would ({@link EditingCanvas.confirm});
 * - paged, over a source whose windows, total, revision and refresh are
 *   platform calls into a {@link PressStore} — its `onApply` commits a new
 *   revision, which the source serves once refreshed to it and the refreshed
 *   read has landed ({@link EditingCanvas.confirm}).
 *
 * The editing wire is PROBED, never replaced: every patch event is decoded
 * and kept, every apply request's bytes kept, and the real callback answers.
 */

import type { ReactNode } from "react";
import { act, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, BooleanType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf, type option,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { ApprovalStateType, DragEventType, Editing, Plan, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { getStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../reactive/tracker.js";
import { DragLayerProvider, useDragSourceItem } from "../../dnd/drag-layer";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { rowKey, rowSel } from "./plan.test-utils.js";

// ── The canvas's data ───────────────────────────────────────────────────────

/** A job dropped on a press — a decision at the bucket it landed in. */
export const Job = StructType({ key: StringType, at: Plan.Types.Instant });
/** A press — its name, its verdict, and the jobs dropped on it. */
export const Press = StructType({ label: StringType, approval: ApprovalStateType, jobs: ArrayType(Job) });
/** The canvas's source — presses by key. */
export const Presses = DictType(StringType, Press);
/** One press, decoded. */
export type PressValue = ValueTypeOf<typeof Press>;
type Verdict = ValueTypeOf<typeof ApprovalStateType>;

export const PENDING: Verdict = variant("pending", null);
export const APPROVED: Verdict = variant("approved", null);
export const REJECTED: Verdict = variant("rejected", null);

/** Three presses: two awaiting a verdict, one approved. */
export const SEED: ReadonlyMap<string, PressValue> = new Map([
    ["p1", { label: "Press 1", approval: PENDING, jobs: [] }],
    ["p2", { label: "Press 2", approval: PENDING, jobs: [] }],
    ["p3", { label: "Press 3", approval: APPROVED, jobs: [] }],
]);

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

/** The presses as rows — each taking a verdict into `approval`, and a dropped job into `jobs`. */
const TAKEN = [
    Plan.series.span(Press, {
        key: PRESSES, title: "Presses",
        label: (p) => p.label,
        runs: () => [],
        decisions: (p) => p.jobs.map((_$, j) => Plan.decision({ key: j.key, at: j.at, applied: false })),
        review: { verdict: "approval" },
        edit: { items: "jobs", create: (drop) => ({ key: drop.from.key, at: drop.at }) },
    }),
];
/** A second row per press that takes no gesture — its series names no field. */
const LOADS = Plan.series.span(Press, { key: "loads", title: "Loads", label: (p) => p.label, runs: () => [] });
/** The presses as rows that only SHOW their verdict — no field a gesture writes. */
const SHOWN = [
    Plan.series.span(Press, {
        key: PRESSES, title: "Presses",
        label: (p) => p.label,
        runs: () => [],
        approval: (p) => some(p.approval),
    }),
];

/** The author's check: a press holds one job at most, and a rejected press needs one. */
const READY = East.function([Press, StringType], Editing.Types.Readiness, ($, press) => {
    const result = $.let(variant("ready", null), Editing.Types.Readiness);
    $.if(press.jobs.size().greater(1n), ($2) => {
        $2.assign(result, variant("invalid", [{ field: "jobs", message: "One job per press" }]));
    });
    $.if(press.approval.hasTag("rejected").and(() => press.jobs.size().equal(0n)), ($2) => {
        $2.assign(result, variant("incomplete", [{ field: "approval", message: "A rejected press needs a job" }]));
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

// ── The platform the test holds ─────────────────────────────────────────────

const Committed = StructType({ revision: StringType, presses: Presses });
const Batch = Editing.Types.ChangeSet(Press, StringType);

/** The paged source's store, and the Rerun probe — platform calls the test answers. */
const Host = {
    page: East.platform("plan_880_page", [IntegerType, IntegerType], OptionType(Presses)),
    total: East.platform("plan_880_total", [], OptionType(IntegerType)),
    revision: East.platform("plan_880_revision", [], OptionType(StringType)),
    refresh: East.platform("plan_880_refresh", [OptionType(StringType)], NullType),
    committed: East.platform("plan_880_committed", [], Committed),
    replay: East.platform("plan_880_replay", [StringType], OptionType(StringType)),
    commit: East.platform("plan_880_commit", [StringType, Presses], StringType),
    rerun: East.platform("plan_880_rerun", [], NullType),
};

const PAGE = East.function([IntegerType, IntegerType], OptionType(Presses), (_$, offset, limit) => Host.page(offset, limit));
const TOTAL = East.function([], OptionType(IntegerType), () => Host.total());
const REVISION = East.function([], OptionType(StringType), () => Host.revision());
const REFRESH = East.function([OptionType(StringType)], NullType, ($, target) => { $(Host.refresh(target)); });
const RERUN = East.function([], NullType, ($) => { $(Host.rerun()); });

/**
 * The paged author's apply: a request it has answered before answers the same
 * (a retry after a lost acknowledgement writes nothing twice); a new one is
 * applied to the committed presses, against the revision it began from, and
 * committed as the next revision.
 */
const APPLY = East.function([Batch], Editing.Types.ApplyResult, ($, batch) => {
    const result = $.let(variant("conflict", []), Editing.Types.ApplyResult);
    const answered = $.let(Host.replay(batch.requestId));
    $.match(answered, {
        some: ($2, revision) => { $2.assign(result, variant("applied", { revision: some(revision) })); },
        none: ($2) => {
            const apply = $2.const(Editing.apply(Presses));
            const now = $2.let(Host.committed());
            const applied = $2.let(apply(now.presses, batch, some(now.revision)));
            $2.match(applied, {
                conflict: ($3, issues) => { $3.assign(result, variant("conflict", issues)); },
                applied: ($3, next) => {
                    const revision = $3.let(Host.commit(batch.requestId, next));
                    $3.assign(result, variant("applied", { revision: some(revision) }));
                },
            });
        },
    });
    return result;
});

const encodePresses = encodeBeast2For(Presses);
const decodePresses = decodeBeast2For(Presses);
const byKey = compareFor(StringType);

/** A snapshot of the presses at a revision. */
interface Snapshot { revision: string; presses: ReadonlyMap<string, PressValue> }

/**
 * What a paged canvas's source holds: the revision it SERVES, and the one its
 * last batch COMMITTED — a refresh to the committed revision is asked, and
 * lands only when the test lets it ({@link PressStore.land}).
 */
export class PressStore {
    private served: Snapshot;
    /** The revision the last write committed. */
    committed: Snapshot;
    /** Every write the source took. */
    writes = 0;
    /** Windows past this element stay in flight. */
    heldFrom = Number.POSITIVE_INFINITY;
    private asked: string | undefined;
    private readonly answered = new Map<string, string>();
    private version = 0;
    private readonly listeners = new Set<() => void>();
    private recording: string[] | null = null;

    constructor(seed: ReadonlyMap<string, PressValue>) {
        this.committed = { revision: "r1", presses: new Map(seed) };
        this.served = this.committed;
    }

    page(offset: bigint, limit: bigint): option<Map<string, PressValue>> {
        this.touch();
        if (Number(offset) >= this.heldFrom) return none;
        const all = [...this.served.presses].sort(([a], [b]) => byKey(a, b));
        // A copy: nothing the canvas does to a window reaches the store.
        return some(decodePresses(encodePresses(new Map(all.slice(Number(offset), Number(offset + limit))))));
    }
    total(): option<bigint> {
        this.touch();
        return some(BigInt(this.served.presses.size));
    }
    revision(): option<string> {
        this.touch();
        return some(this.served.revision);
    }
    refresh(target: option<string>): null {
        if (target.type === "none") {
            this.served = this.committed;
            this.notify();
        } else if (target.value !== this.committed.revision) {
            throw new Error(`no revision ${target.value}`);
        } else {
            this.asked = target.value;
        }
        return null;
    }
    replay(requestId: string): option<string> {
        const revision = this.answered.get(requestId);
        return revision === undefined ? none : some(revision);
    }
    commit(requestId: string, next: ReadonlyMap<string, PressValue>): string {
        const revision = `r${Number(this.committed.revision.slice(1)) + 1}`;
        this.committed = { revision, presses: next };
        this.answered.set(requestId, revision);
        this.writes += 1;
        return revision;
    }
    /** The refreshed revision's reads land. */
    land(): void {
        if (this.asked === undefined) return;
        this.asked = undefined;
        this.served = this.committed;
        this.notify();
    }
    /** Another writer commits, and the source serves it at once. */
    move(next: ReadonlyMap<string, PressValue>): void {
        this.commit(`elsewhere-${this.version}`, next);
        this.served = this.committed;
        this.notify();
    }
    /** The source's channel, as the canvas's tracked reads subscribe to it. */
    tracker(): ReactiveTracker {
        return {
            id: "plan-880",
            enableTracking: () => { this.recording = []; },
            disableTracking: () => {
                const read = this.recording ?? [];
                this.recording = null;
                return read;
            },
            getStore: () => ({
                subscribe: (_key, callback) => {
                    this.listeners.add(callback);
                    return () => { this.listeners.delete(callback); };
                },
                getKeyVersion: () => this.version,
            }),
        };
    }
    private touch(): void { this.recording?.push("presses"); }
    private notify(): void {
        this.version += 1;
        for (const listener of [...this.listeners]) listener();
    }
}

/** The mounted canvas's store and probes — what the platform calls answer from. */
let store: PressStore | undefined;
let reruns = 0;
const held = (): PressStore => {
    if (store === undefined) throw new Error("no paged canvas is mounted");
    return store;
};

const HOST = [
    Host.page.implement((offset, limit) => held().page(offset, limit)),
    Host.total.implement(() => held().total()),
    Host.revision.implement(() => held().revision()),
    Host.refresh.implement((target) => held().refresh(target)),
    Host.committed.implement(() => ({ revision: held().committed.revision, presses: new Map(held().committed.presses) })),
    Host.replay.implement((requestId) => held().replay(requestId)),
    Host.commit.implement((requestId, next) => held().commit(requestId, next)),
    Host.rerun.implement(() => {
        reruns += 1;
        return null;
    }),
];

// ── The canvas ──────────────────────────────────────────────────────────────

/** Where the inline canvas's presses are bound. */
const STATE_KEY = "plan-880.presses";

/** How a test's canvas is built. */
export interface CanvasOptions {
    /** Where the rows come from — inline, or a paged source. */
    arm: "inline" | "paged";
    /** The axis kind (default `"time"`). */
    axis?: "time" | "number" | "ordinal";
    /** Whether the canvas declares editing (default `true`). */
    editing?: boolean;
    /** Whether it declares review chrome (default `true`). */
    review?: boolean;
    /** Whether its review declares Rerun. */
    rerun?: boolean;
    /** The presses' verdicts: taken by the canvas (default), or only shown. */
    verdicts?: "taken" | "shown";
    /** A second row per press beside the first, that takes no gesture. */
    alongside?: boolean;
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
}

type Resolved = Required<Omit<CanvasOptions, "heldFrom" | "seed">> & Pick<CanvasOptions, "heldFrom"> & { seed: Map<string, PressValue> };

/** The root's chrome besides its rows and editing. */
function chromeOf(o: Resolved) {
    return {
        ...(o.review ? { review: o.rerun ? { onRerun: RERUN } : {} } : {}),
        ...(o.target ? { id: SURFACE } : {}),
        sources: o.sources,
        ...(o.onlyPress1 ? { canDrop: ONLY_PRESS_1 } : {}),
    };
}

/** The canvas's program — the factory's, compiled with the test's platform. */
function compileCanvas(o: Resolved): () => ValueTypeOf<typeof UIComponentType> {
    const series = [...(o.verdicts === "taken" ? TAKEN : SHOWN), ...(o.alongside ? [LOADS] : [])];
    const axis = AXES[o.axis];
    const chrome = chromeOf(o);
    const ready = o.ready ? { ready: READY } : {};
    const program = o.arm === "inline"
        ? East.function([], UIComponentType, ($) => {
            const presses = $.const(State.bind([Presses], STATE_KEY, o.seed));
            return Plan.Root({
                axis, data: presses, series, ...chrome,
                ...(o.editing ? { editing: { onUpdate: presses.write, ...ready } } : {}),
            });
        })
        : East.function([], UIComponentType, ($) => {
            const source = $.const({
                id: "plan-880-presses", page: PAGE, total: TOTAL, seek: none, revision: REVISION, refresh: REFRESH,
            }, Paged.Types.Source(Presses));
            const onApply = $.const(APPLY);
            return Plan.Root({
                axis, data: source, series, ...chrome,
                ...(o.editing ? { editing: { onApply, ...ready } } : {}),
            });
        });
    return East.compile(program, [...getRegisteredPlatformImplementations(), ...HOST]) as () => ValueTypeOf<typeof UIComponentType>;
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

/** A job card in the jobs library — a drag source. */
function JobCard({ job }: { job: string }) {
    const onPointerDown = useDragSourceItem({ library: JOBS, key: job, label: job }, <div />);
    return <div data-testid={`job-${job}`} onPointerDown={onPointerDown} />;
}

/** A mounted canvas, and what the test reads and drives it through. */
export interface EditingCanvas extends RenderResult {
    /** Which arm it is. */
    arm: CanvasOptions["arm"];
    /** Every gesture's patch event, in order. */
    patches: PlanPatch[];
    /** Every apply request's bytes, in order. */
    applies: Uint8Array[];
    /** How many times Rerun ran. */
    reruns: () => number;
    /** What the source holds now. */
    stored: () => ReadonlyMap<string, PressValue>;
    /** How many writes the source took. */
    writes: () => number;
    /** The source reads back what it committed — inline, the host renders its latest value; paged, the refreshed revision lands. */
    confirm: () => Promise<void>;
    /** Another writer changes the source, and the canvas reads it. */
    move: (next: ReadonlyMap<string, PressValue>) => Promise<void>;
    /** The next apply persists, then loses its acknowledgement. */
    loseNextAck: () => void;
    /** Let everything in flight land. */
    settle: () => Promise<void>;
}

const cleanups: (() => void)[] = [];

/** Unregister what a mounted canvas registered. Call after each test. */
export function releaseCanvases(): void {
    while (cleanups.length > 0) cleanups.pop()!();
    store = undefined;
}

/** Let everything in flight land — microtasks, and timers queued behind them. */
export async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/**
 * Build, compile and mount a canvas, and wait for its presses to draw.
 *
 * @param options - How the canvas is built ({@link CanvasOptions})
 * @returns The mounted canvas
 */
export async function mountCanvas(options: CanvasOptions): Promise<EditingCanvas> {
    const o: Resolved = {
        axis: "time", editing: true, review: true, rerun: false, verdicts: "taken", alongside: false, target: true, sources: [JOBS],
        onlyPress1: false, ready: false, storageKey: `plan-880-${options.arm}`, wrap: (plan) => plan, ...options,
        seed: new Map(options.seed ?? SEED),
    };
    const probe: Probe = { patches: [], applies: [], loseAck: false };
    reruns = 0;
    const program = compileCanvas(o);
    let paged: PressStore | undefined;
    if (o.arm === "paged") {
        paged = new PressStore(o.seed);
        if (o.heldFrom !== undefined) paged.heldFrom = o.heldFrom;
        store = paged;
        cleanups.push(registerReactiveTracker(paged.tracker()));
    }
    const view = (): PlanRootValue => {
        const ui = program();
        if (ui.type !== "Plan") throw new Error(`Expected a Plan, got ${ui.type}`);
        return probed(ui.value as PlanRootValue, probe);
    };
    const tree = (value: PlanRootValue) => (
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <JobCard job="job-1" />
                <JobCard job="job-2" />
                {o.wrap(<EastChakraPlan value={value} storageKey={o.storageKey} />)}
            </DragLayerProvider>
        </ChakraProvider>
    );
    const utils = render(tree(view()));
    // The inline host renders again with its latest value, as a `Reactive` does.
    const rerenderLatest = () => act(() => { utils.rerender(tree(view())); });
    const baseline = getStore().getKeyVersion(STATE_KEY);
    // The first press drawn — a row on the canvas, a card in the narrow layout.
    const first = [...o.seed.keys()][0]!;
    await waitFor(() => {
        if (utils.container.querySelector(`${rowSel(first, "data-plan-row", PRESSES)}, ${rowSel(first, "data-plan-card", PRESSES)}`) === null) {
            throw new Error("the presses have not drawn yet");
        }
    });
    await settle();
    return {
        ...utils,
        arm: o.arm,
        patches: probe.patches,
        applies: probe.applies,
        reruns: () => reruns,
        stored: () => (paged !== undefined ? paged.committed.presses : decodePresses(getStore().read(STATE_KEY)!)),
        writes: () => (paged !== undefined ? paged.writes : getStore().getKeyVersion(STATE_KEY) - baseline),
        confirm: async () => {
            if (paged !== undefined) act(() => { paged.land(); });
            else rerenderLatest();
            await settle();
        },
        move: async (next) => {
            if (paged !== undefined) act(() => { paged.move(next); });
            else {
                act(() => { getStore().write(STATE_KEY, encodePresses(new Map(next))); });
                rerenderLatest();
            }
            await settle();
        },
        loseNextAck: () => { probe.loseAck = true; },
        settle,
    };
}

// ── Reading and driving the canvas ──────────────────────────────────────────

/** A press's row. */
export const pressRow = (c: HTMLElement, press: string): HTMLElement =>
    c.querySelector<HTMLElement>(rowSel(press, "data-plan-row", PRESSES))!;

/** A press's decision cell — its verdict as drawn. */
export const verdictOf = (c: HTMLElement, press: string): string | null =>
    pressRow(c, press).querySelector('[data-slot="decisionCell"]')!.getAttribute("data-verdict");

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

/** A press's Approve / Reject button. */
export const verdictButton = (c: HTMLElement, press: string, verdict: "approve" | "reject"): HTMLButtonElement =>
    c.querySelector<HTMLButtonElement>(rowSel(press, `data-plan-${verdict}`, PRESSES))!;

/** Click a press's Approve or Reject. */
export async function decide(c: HTMLElement, press: string, verdict: "approve" | "reject"): Promise<void> {
    await act(async () => { fireEvent.click(verdictButton(c, press, verdict)); });
    await settle();
}

/** The review foot's batch button. */
export const batchButton = (c: HTMLElement, verb: "approve" | "reject" | "rerun"): HTMLButtonElement | null =>
    c.querySelector<HTMLButtonElement>(`[data-review-batch="${verb}"]`);

/** Click the foot's Approve all / Reject all / Rerun. */
export async function batch(c: HTMLElement, verb: "approve" | "reject" | "rerun"): Promise<void> {
    await act(async () => { fireEvent.click(batchButton(c, verb)!); });
    await settle();
}

/** A history bar button, by its name. */
export const historyButton = (canvas: RenderResult, name: string): HTMLButtonElement =>
    canvas.getByRole("button", { name }) as HTMLButtonElement;

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

/** Point the layer at an element — jsdom has no layout, so the drag reads it here. */
function pointAt(el: Element | null): void {
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el;
}

/** A press's drop cell — its plot, when the canvas takes a job there. */
export const dropCellOf = (c: HTMLElement, press: string): HTMLElement | null =>
    pressRow(c, press).querySelector<HTMLElement>("[data-drag-cell]");

/**
 * Drag a job card over a press's plot and hold it there — the drop not yet
 * made. One event at a time, the canvas rendering between them as a
 * browser's does: the drag starting re-registers every cell, and a move
 * batched with it would be answered before that. jsdom's zero-width rect puts
 * the pointer in the FIRST bucket.
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
