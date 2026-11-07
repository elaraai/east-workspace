/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's model (#1502, `Flowchart Records Spec.md` R6, R7, D4, D12) —
 * pure and React-free: what the canvas, the inspector, Issues and the footer
 * draw from, made from the four records' rows with the drafts in place.
 *
 * - **The lanes** stand in their `order`, else by key (D4). A state whose lane
 *   names no lane stands in a last band, *No lane* (D12); with no lanes given,
 *   one band holds every state.
 * - **Each lane's states** stand in their `order`, else by key: the order e3
 *   returns a record in, kept under every index the rail picks, though a page
 *   of a source comes in its index's order (R7).
 * - **By key** is at the kind's record's key type (#1549): Integer keys stand
 *   `2`, `9`, `10`, never as their text would, each text read back once
 *   (`kind-keys.ts`).
 * - **An end no state is keyed by** is a ghost, *No state row*, beside its
 *   other end's lane, and its transition's line is unresolved. A transition
 *   from a state to itself folds into the state's `↻ n`.
 * - **A row the narrowing leaves out**, under `"dim"`, draws faded: `dimmed`,
 *   selected by no path and counted nowhere (R6).
 *
 * Stroke weights, the evidence badge and the planned · observed · unresolved
 * split are derived, never authored.
 *
 * @packageDocumentation
 */

import { FloatType, OptionType, StringType, compareFor, equalFor, none, some, variant, type EastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { Flowchart } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, type Formatters, type TickFormatOpt } from "@elaraai/east-ui-components";
import { STRING_KEYS, kindKeys, type KindKeys } from "../shared/schedule/kind-keys.js";
import type { FlowchartWords } from "./messages.js";

/** The decoded Flowchart payload — what `<Flowchart>` hands the renderer. */
export type FlowchartValue = ValueTypeOf<typeof Flowchart.Types.Payload>;

/** The decoded canvas: what the flowchart draws with besides its kinds. */
export type FlowchartCanvasValue = ValueTypeOf<typeof Flowchart.Types.Canvas>;

/** A state's roles, as its kind reads them from the app's row. */
export type FlowchartStateRoles = ValueTypeOf<typeof Flowchart.Types.StateRoles>;
/** A transition's roles. */
export type FlowchartTransitionRoles = ValueTypeOf<typeof Flowchart.Types.TransitionRoles>;
/** A lane's roles. */
export type FlowchartLaneRoles = ValueTypeOf<typeof Flowchart.Types.LaneRoles>;
/** A decision's roles. */
export type FlowchartDecisionRoles = ValueTypeOf<typeof Flowchart.Types.DecisionRoles>;
/** A transition's evidence, decoded. */
export type FlowchartEvidenceValue = ValueTypeOf<typeof Flowchart.Types.Evidence>;

/** One row of a record as the model takes it: its key, its roles and whether the narrowing leaves it out, drawn as context. */
export interface FlowchartRow<R> {
    /** Its key in its record. */
    readonly key: string;
    /** Its roles, as its kind reads them — its draft's, where it has one. */
    readonly roles: R;
    /** Whether the narrowing leaves it out, under `"dim"`: drawn faded, selected by no path. */
    readonly dimmed: boolean;
}

/** Each kind's keys (#1549): each key's text, read back at its record's key type, and the keys' order by it. */
export interface FlowchartKindKeys {
    /** The states'. */
    readonly states: KindKeys;
    /** The transitions'. */
    readonly transitions: KindKeys;
    /** The lanes'. */
    readonly lanes: KindKeys;
    /** The decisions'. */
    readonly decisions: KindKeys;
}

/** Every kind's keys, each record keyed by String. */
export const STRING_KIND_KEYS: FlowchartKindKeys = { states: STRING_KEYS, transitions: STRING_KEYS, lanes: STRING_KEYS, decisions: STRING_KEYS };

/**
 * Each of a Flowchart's kinds' keys, as its payload says each record is keyed (#1549).
 *
 * @param value - The payload
 * @returns Each kind's keys: a kind the Flowchart is not given, by String
 */
export function flowchartKindKeys(value: FlowchartValue): FlowchartKindKeys {
    const of = (kind: { readonly keyType: EastTypeValue } | undefined): KindKeys => (kind === undefined ? STRING_KEYS : kindKeys(kind.keyType));
    return {
        states: of(value.states), transitions: of(getSomeorUndefined(value.transitions)), lanes: of(getSomeorUndefined(value.lanes)),
        decisions: of(getSomeorUndefined(value.decisions)),
    };
}

/** The four records' rows, the drafts in place: what the model is made from. */
export interface FlowchartRows {
    /** The states. */
    readonly states: readonly FlowchartRow<FlowchartStateRoles>[];
    /** The transitions; none for a flowchart given none. */
    readonly transitions: readonly FlowchartRow<FlowchartTransitionRoles>[];
    /** The lanes; `undefined` for a flowchart given none, whose one band holds every state. */
    readonly lanes: readonly FlowchartRow<FlowchartLaneRoles>[] | undefined;
    /** The decisions; none for a flowchart given none. */
    readonly decisions: readonly FlowchartRow<FlowchartDecisionRoles>[];
    /** Each kind's keys: what each kind's rows are ordered by, by key. */
    readonly keys: FlowchartKindKeys;
}

/** Spec line classes (unresolved is derived, never authored). */
export type LinkClass = "planned" | "observed" | "unresolved";

/** One node in the view model — a state, or a ghost standing for an end no state is keyed by. */
export interface ModelNode {
    /** Its key: the state's, or the end's a ghost stands for. */
    readonly key: string;
    /** Its card's name; `undefined` for an empty label. */
    readonly label: string | undefined;
    /** Its band's place among the model's lanes. */
    readonly laneIndex: number;
    /** Its place in its band, from the first. */
    readonly laneOrder: number;
    /** The lane its row names, by key; `undefined` for none. */
    readonly lane: string | undefined;
    /** Its place in its lane, as its `order` gives it; `undefined` for a kind with no `order`. */
    readonly order: number | undefined;
    /** State-class member count (the ×N badge). */
    readonly members: bigint | undefined;
    /**
     * In-place transitions (self-loops) drawn as themselves, by key, in key
     * order — the `↻ n` badge, their selection surface: they have no route to
     * click. One the narrowing leaves out draws nowhere.
     */
    readonly inPlaceKeys: string[];
    /** True for the derived "No state row" ghost. */
    readonly ghost: boolean;
    /** Whether the narrowing leaves it out, drawn faded (R6); a ghost is, when every transition naming it is. */
    readonly dimmed: boolean;
}

/** One routed transition in the view model (in-place ones fold into their state's `↻ n` badge). */
export interface ModelLink {
    /** Its key in its record: never drawn — a transition is named by its ends. */
    readonly key: string;
    /** The state it leaves. */
    readonly from: string;
    /** The state it enters. */
    readonly to: string;
    /** How its line draws. */
    readonly cls: LinkClass;
    /** The decision it names, by key — the lettered diamond, drawn while the decisions hold it. */
    readonly trigger: string | undefined;
    /** Its evidence. */
    readonly evidence: FlowchartEvidenceValue | undefined;
    /** Stroke weight from evidence volume — log scale 1.6 / 2 / 2.5, floor 1.4. */
    readonly weight: number;
    /** Pre-formatted evidence badge ("17,350 parcels · 386"); undefined ⇒ no badge. */
    readonly badgeText: string | undefined;
    /** Whether the narrowing leaves it out, drawn faded (R6). */
    readonly dimmed: boolean;
}

/** A band of the canvas: a lane of the app's, the last band of states naming no lane, or the one band of a flowchart given no lanes. */
export type ModelBand = "lane" | "noLane" | "all";

/** One band of the canvas. */
export interface ModelLane {
    /** Its key: the lane's; {@link NO_LANE_KEY} or {@link ALL_LANE_KEY} for a band of no lane. */
    readonly key: string;
    /** Its header. */
    readonly label: string;
    /** Its place among the lanes, as its `order` gives it; `undefined` for a band of no lane, or a kind with no `order`. */
    readonly order: number | undefined;
    /** What the band is: only a lane of the app's takes a gesture of its own — a rename, its ×, "+ STATE". */
    readonly band: ModelBand;
}

/** One decision in the view model. */
export interface ModelTrigger {
    /** Its key. */
    readonly key: string;
    /** Its name. */
    readonly label: string;
    /** Its diamond's letter. */
    readonly letter: string;
    /** Who owns it. */
    readonly owner: string | undefined;
    /** The states queued at it, by key. */
    readonly queue: ReadonlyArray<string>;
    /** Its outcomes' summary line. */
    readonly outcomes: string | undefined;
    /** The routed transitions it governs, by key. */
    readonly governs: ReadonlyArray<string>;
}

/** What the flowchart holds, counted: what the narrowing leaves out counts nowhere. */
export interface ModelCounts {
    /** Its routed transitions. */
    readonly total: number;
    /** Of them, planned. */
    readonly planned: number;
    /** Of them, observed. */
    readonly observed: number;
    /** Of them, with an end no state is keyed by. */
    readonly unresolved: number;
    /** Its lanes. */
    readonly lanes: number;
    /** Its states. */
    readonly states: number;
    /** Its transitions, in-place ones among them. */
    readonly transitions: number;
    /** Its decisions. */
    readonly decisions: number;
}

/** The view model. */
export interface FlowchartModel {
    /** The bands, in their order: the lanes, then *No lane* when a state names no lane; one band with no lanes given. */
    readonly lanes: ReadonlyArray<ModelLane>;
    /** The states in their order — by `order`, else by key — then the ghosts: each knows its band, and its place in it. */
    readonly nodes: ReadonlyArray<ModelNode>;
    /** The nodes, by key. */
    readonly nodesByKey: ReadonlyMap<string, ModelNode>;
    /** The routed transitions, in key order. */
    readonly links: ReadonlyArray<ModelLink>;
    /** The decisions, by key. */
    readonly triggers: ReadonlyMap<string, ModelTrigger>;
    /** What it holds, counted. */
    readonly counts: ModelCounts;
    /** It holds no lane, no state and no transition: there is nothing to draw. */
    readonly blank: boolean;
    /** How many states each lane holds, by its key — every state the flowchart holds naming it: a lane holding states is not deleted (R8). */
    readonly laneStates: ReadonlyMap<string, number>;
    /** No lanes are given: `lanes` is one band holding every state, which no gesture renames or deletes. */
    readonly standIn: boolean;
    /** The states naming no lane the flowchart holds, by key, in their band's order: they stand in *No lane*, and Issues lists each (D12). */
    readonly noLane: ReadonlyArray<string>;
    /** Whether the states carry an `order`: a move within a lane, and a drop between two cards, write the middle of theirs (D4). */
    readonly ordered: boolean;
    /** Each kind's keys, as the rows gave them: what every list of a kind's rows orders them by, by key (#1549). */
    readonly keys: FlowchartKindKeys;
}

/** The key of the last band, *No lane*: a key no lane of the app's is given — an East String holds no lone NUL as a key's text. */
export const NO_LANE_KEY = "\u0000no-lane";

/** The key of the one band of a flowchart given no lanes. */
export const ALL_LANE_KEY = "";

const keyEqual = equalFor(StringType);
const compareFloat = compareFor(FloatType);

/**
 * Stroke weight from evidence volume — the spec's log ladder:
 * 1.6 / 2 / 2.5 px, floor 1.4 for links without volume. Normalised
 * min→max in log space so the observed range spreads across the tiers.
 *
 * @param volume - The transition's volume
 * @param minVolume - The smallest volume drawn
 * @param maxVolume - The largest volume drawn
 * @returns The stroke weight, in px
 */
export function evidenceWeight(volume: number | undefined, minVolume: number, maxVolume: number): number {
    if (volume === undefined || volume <= 0 || maxVolume <= 0) return 1.4;
    if (maxVolume <= minVolume) return 2;
    const t = (Math.log1p(volume) - Math.log1p(minVolume)) / (Math.log1p(maxVolume) - Math.log1p(minVolume));
    if (t >= 0.8) return 2.5;
    if (t >= 0.4) return 2;
    return 1.6;
}

/** A badge volume at or past a thousand: whole units. */
const VOLUME_WHOLE: TickFormatOpt = variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(0n), signDisplay: none });
/** A badge volume under a thousand: one decimal at most. */
const VOLUME_TENTH: TickFormatOpt = variant("number", { minimumFractionDigits: none, maximumFractionDigits: some(1n), signDisplay: none });

/**
 * Compact volume formatting for badges, in the app's locale (#850).
 *
 * @param v - The volume
 * @param words - The formatters
 * @returns The volume, printed
 */
export function fmtVolume(v: number, words: Formatters): string {
    return words.value(v, v >= 1000 ? VOLUME_WHOLE : VOLUME_TENTH);
}

/**
 * Grouped count formatting for badges, in the app's locale (#850).
 *
 * @param n - The count
 * @param words - The formatters
 * @returns The count, printed
 */
export function fmtCount(n: bigint, words: Formatters): string {
    return words.number(n);
}

/**
 * A transition's evidence badge, in the app's locale (#850) — `17,350 parcels
 * · 386`: its volume with its unit, and its count; none without a volume.
 *
 * @param evidence - The transition's evidence
 * @param words - The formatters
 * @returns The badge; `undefined` for none
 */
export function evidenceBadge(evidence: FlowchartEvidenceValue | undefined, words: Formatters): string | undefined {
    const volume = evidence === undefined ? undefined : getSomeorUndefined(evidence.volume);
    if (evidence === undefined || volume === undefined) return undefined;
    const count = getSomeorUndefined(evidence.count);
    const unit = getSomeorUndefined(evidence.unit);
    return `${fmtVolume(volume, words)}${unit !== undefined ? ` ${unit}` : ""}${count !== undefined ? ` · ${fmtCount(count, words)}` : ""}`;
}

/** A row as it is placed: its `order`, and its key's place in its kind's keys' order. */
interface Placed {
    readonly order: ValueTypeOf<OptionType<FloatType>>;
    readonly rank: number;
}

/**
 * Two rows in their order (D4): by `order` — a row with none after every row
 * with one — then by key, the record's order at its key type (#1549).
 *
 * @param a - One row's order and its key's place
 * @param b - The other's
 * @returns Negative, zero or positive
 */
function byOrder(a: Placed, b: Placed): number {
    if (a.order.type === "some" && b.order.type === "some") {
        const order = compareFloat(a.order.value, b.order.value);
        if (order !== 0) return order;
    } else if (a.order.type !== b.order.type) {
        return a.order.type === "some" ? -1 : 1;
    }
    return a.rank - b.rank;
}

/**
 * Builds the view model (see the module docs). Pure; unit-testable.
 *
 * @param rows - The four records' rows, the drafts in place
 * @param words - The flowchart's words: the badges' numbers in the app's locale, and the ghost's and *No lane*'s names
 * @returns The view model
 */
export function buildModel(rows: FlowchartRows, words: FlowchartWords): FlowchartModel {
    // ── The bands: the lanes in their order, then No lane while a state names none of them ──
    const given = rows.lanes;
    // Each kind's keys' places in their order at its key type, each key's text read back once (#1549).
    const laneRanks = rows.keys.lanes.ranks((given ?? []).map((lane) => lane.key));
    const stateRanks = rows.keys.states.ranks(rows.states.map((state) => state.key));
    const lanes: ModelLane[] = given === undefined ? [] : [...given]
        .sort((a, b) => byOrder({ order: a.roles.order, rank: laneRanks.get(a.key)! }, { order: b.roles.order, rank: laneRanks.get(b.key)! }))
        .map((lane) => ({
            key: lane.key,
            label: lane.roles.label.length === 0 ? lane.key : lane.roles.label,
            order: getSomeorUndefined(lane.roles.order),
            band: "lane" as const,
        }));
    const laneIndex = new Map<string, number>(lanes.map((lane, i) => [lane.key, i]));
    const states = [...rows.states].sort((a, b) => byOrder({ order: a.roles.order, rank: stateRanks.get(a.key)! }, { order: b.roles.order, rank: stateRanks.get(b.key)! }));
    // A state naming no lane the flowchart holds, while lanes are given: the last band's.
    const unplaced = given === undefined ? [] : states.filter((state) => {
        const lane = getSomeorUndefined(state.roles.lane);
        return lane === undefined || !laneIndex.has(lane);
    });
    if (given === undefined) lanes.push({ key: ALL_LANE_KEY, label: "", order: undefined, band: "all" });
    else if (unplaced.length > 0) lanes.push({ key: NO_LANE_KEY, label: words.m.noLaneBand(), order: undefined, band: "noLane" });
    const noLaneIndex = lanes.length - 1;
    const bandOf = (lane: string | undefined): number => {
        if (given === undefined) return 0;
        const at = lane === undefined ? undefined : laneIndex.get(lane);
        return at ?? noLaneIndex;
    };

    // ── The states, band by band, each band's in its order ──
    const perBand = new Array<number>(Math.max(lanes.length, 1)).fill(0);
    const nextInBand = (band: number): number => {
        const n = perBand[band] ?? 0;
        perBand[band] = n + 1;
        return n;
    };
    const nodes: ModelNode[] = [];
    const nodesByKey = new Map<string, ModelNode>();
    const laneStates = new Map<string, number>();
    for (const state of states) {
        const lane = getSomeorUndefined(state.roles.lane);
        const band = bandOf(lane);
        const node: ModelNode = {
            key: state.key,
            label: state.roles.label.length === 0 ? undefined : state.roles.label,
            laneIndex: band,
            laneOrder: nextInBand(band),
            lane,
            order: getSomeorUndefined(state.roles.order),
            members: getSomeorUndefined(state.roles.members),
            inPlaceKeys: [],
            ghost: false,
            dimmed: state.dimmed,
        };
        nodes.push(node);
        nodesByKey.set(node.key, node);
        if (lane !== undefined) laneStates.set(lane, (laneStates.get(lane) ?? 0) + 1);
    }

    // ── The transitions: in-place ones fold into `↻ n`; an end no state is keyed by is a ghost ──
    const transitionRanks = rows.keys.transitions.ranks(rows.transitions.map((transition) => transition.key));
    const transitions = [...rows.transitions].sort((a, b) => transitionRanks.get(a.key)! - transitionRanks.get(b.key)!);
    const volumes = transitions
        .map((t) => { const ev = getSomeorUndefined(t.roles.evidence); return ev === undefined ? undefined : getSomeorUndefined(ev.volume); })
        .filter((v): v is number => v !== undefined && v > 0);
    const maxVolume = volumes.length > 0 ? Math.max(...volumes) : 0;
    const minVolume = volumes.length > 0 ? Math.min(...volumes) : 0;
    // Each ghost, and whether every transition naming it is left out by the narrowing.
    const ghostLit = new Map<string, boolean>();
    const ensureGhost = (key: string, nearBand: number, dimmed: boolean): void => {
        if (nodesByKey.has(key) && !ghostLit.has(key)) return;
        ghostLit.set(key, (ghostLit.get(key) ?? false) || !dimmed);
        if (nodesByKey.has(key)) return;
        // Lanes given, none of them held and no state to place: the ghosts stand in No lane.
        if (lanes.length === 0) lanes.push({ key: NO_LANE_KEY, label: words.m.noLaneBand(), order: undefined, band: "noLane" });
        const band = Math.min(Math.max(nearBand, 0), lanes.length - 1);
        const ghost: ModelNode = {
            key, label: words.m.noStateRow(), laneIndex: band, laneOrder: nextInBand(band), lane: undefined, order: undefined,
            members: undefined, inPlaceKeys: [], ghost: true, dimmed,
        };
        nodes.push(ghost);
        nodesByKey.set(key, ghost);
    };

    const links: ModelLink[] = [];
    let planned = 0, observed = 0, unresolved = 0, held = 0;
    for (const transition of transitions) {
        const { from, to } = transition.roles;
        if (!transition.dimmed) held += 1;
        if (keyEqual(from, to)) {
            if (!nodesByKey.has(from) || ghostLit.has(from)) ensureGhost(from, 0, transition.dimmed);
            // One the narrowing leaves out draws nowhere: its state's `↻ n` counts those drawn as themselves.
            if (!transition.dimmed) nodesByKey.get(from)!.inPlaceKeys.push(transition.key);
            continue;
        }
        const missing = !nodesByKey.has(from) || !nodesByKey.has(to) || ghostLit.has(from) || ghostLit.has(to);
        if (missing) {
            // A ghost stands beside its resolved end's band, or in the first.
            const anchor = [nodesByKey.get(from), nodesByKey.get(to)].find((node) => node !== undefined && !node.ghost);
            const near = anchor === undefined ? 0 : anchor.laneIndex + 1;
            if (!nodesByKey.has(from) || ghostLit.has(from)) ensureGhost(from, near, transition.dimmed);
            if (!nodesByKey.has(to) || ghostLit.has(to)) ensureGhost(to, near, transition.dimmed);
        }
        const cls: LinkClass = missing ? "unresolved" : transition.roles.kind.type;
        if (!transition.dimmed) {
            if (cls === "planned") planned += 1;
            else if (cls === "observed") observed += 1;
            else unresolved += 1;
        }
        const ev = getSomeorUndefined(transition.roles.evidence);
        const vol = ev === undefined ? undefined : getSomeorUndefined(ev.volume);
        links.push({
            key: transition.key,
            from,
            to,
            cls,
            trigger: getSomeorUndefined(transition.roles.decision),
            evidence: ev,
            weight: cls === "unresolved" ? 1.4 : evidenceWeight(vol, minVolume, maxVolume),
            badgeText: evidenceBadge(ev, words),
            dimmed: transition.dimmed,
        });
    }
    // A ghost is faded only while every transition naming it is.
    for (const [key, lit] of ghostLit) {
        const ghost = nodesByKey.get(key)!;
        if (ghost.dimmed === !lit) continue;
        const next = { ...ghost, dimmed: !lit };
        nodes[nodes.indexOf(ghost)] = next;
        nodesByKey.set(key, next);
    }

    // ── The decisions ──
    const triggers = new Map<string, ModelTrigger>();
    const decisionRanks = rows.keys.decisions.ranks(rows.decisions.map((decision) => decision.key));
    for (const decision of [...rows.decisions].sort((a, b) => decisionRanks.get(a.key)! - decisionRanks.get(b.key)!)) {
        const label = decision.roles.label;
        triggers.set(decision.key, {
            key: decision.key,
            label,
            letter: getSomeorUndefined(decision.roles.letter) ?? (label.length > 0 ? label.charAt(0).toUpperCase() : "?"),
            owner: getSomeorUndefined(decision.roles.owner),
            queue: decision.roles.queue,
            outcomes: getSomeorUndefined(decision.roles.outcomes),
            governs: links.filter((link) => link.trigger !== undefined && keyEqual(link.trigger, decision.key)).map((link) => link.key),
        });
    }

    const shownLinks = links.filter((link) => !link.dimmed);
    return {
        lanes,
        nodes,
        nodesByKey,
        links,
        triggers,
        counts: {
            total: shownLinks.length, planned, observed, unresolved,
            lanes: lanes.filter((lane) => lane.band === "lane").length,
            states: nodes.filter((node) => !node.ghost && !node.dimmed).length,
            transitions: held,
            decisions: triggers.size,
        },
        blank: (given === undefined || given.length === 0) && rows.states.length === 0 && rows.transitions.length === 0,
        laneStates,
        standIn: given === undefined,
        noLane: unplaced.map((state) => state.key),
        ordered: states.some((state) => state.roles.order.type === "some"),
        keys: rows.keys,
    };
}
