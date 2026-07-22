/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart model — pure IR → view-model derivation. No React imports.
 *
 * Derives everything the spec calls "derived, never authored": unresolved
 * ghost nodes, in-place (self-loop) counts, per-link render classes and
 * evidence weights, and the footer's planned / observed split.
 */

import type { ValueTypeOf } from "@elaraai/east";
import type { Flowchart } from "@elaraai/east-ui/internal";

/** The decoded Flowchart root value. */
export type FlowchartValue = ValueTypeOf<typeof Flowchart.Types.Flowchart>;

export type FlowchartStateValue = ValueTypeOf<typeof Flowchart.Types.State>;
export type FlowchartLinkValue = ValueTypeOf<typeof Flowchart.Types.Link>;
export type FlowchartLaneValue = ValueTypeOf<typeof Flowchart.Types.Lane>;
export type FlowchartTriggerValue = ValueTypeOf<typeof Flowchart.Types.Trigger>;
export type FlowchartFieldDefValue = ValueTypeOf<typeof Flowchart.Types.FieldDef>;
export type FlowchartFieldValue = ValueTypeOf<typeof Flowchart.Types.FieldValue>;
export type FlowchartEvidenceValue = ValueTypeOf<typeof Flowchart.Types.Evidence>;

/** Spec line classes (unresolved is derived, never authored). */
export type LinkClass = "planned" | "observed" | "unresolved";

/** One node in the view model — a real state or a derived ghost. */
export interface ModelNode {
    key: string;
    label: string | undefined;
    laneIndex: number;
    /** Order within the lane (data order). */
    laneOrder: number;
    /** State-class member count (the ×N badge). */
    members: bigint | undefined;
    notes: string | undefined;
    fields: ReadonlyArray<FlowchartFieldValue>;
    /** Aggregated `↻ n` in-place transition count (self-loop links). */
    inPlace: number;
    /** True for the derived "No state row" ghost. */
    ghost: boolean;
}

/** One routed link in the view model (self-loops are excluded — they
 * collapse to the node's `↻ n` badge). */
export interface ModelLink {
    key: string;
    from: string;
    to: string;
    cls: LinkClass;
    /** Trigger key (0..1) — the lettered diamond. */
    trigger: string | undefined;
    evidence: FlowchartEvidenceValue | undefined;
    fields: ReadonlyArray<FlowchartFieldValue>;
    /** Stroke weight from evidence volume — log scale 1.6 / 2 / 2.5, floor 1.4. */
    weight: number;
}

export interface ModelLane {
    key: string;
    label: string;
}

export interface ModelTrigger {
    key: string;
    label: string;
    letter: string;
    owner: string | undefined;
    queue: ReadonlyArray<string>;
    outcomes: string | undefined;
    /** Links (by key) this trigger governs. */
    governs: ReadonlyArray<string>;
}

export interface FlowchartModel {
    lanes: ReadonlyArray<ModelLane>;
    /** Real states plus derived ghosts, in lane / lane-order. */
    nodes: ReadonlyArray<ModelNode>;
    nodesByKey: ReadonlyMap<string, ModelNode>;
    links: ReadonlyArray<ModelLink>;
    triggers: ReadonlyMap<string, ModelTrigger>;
    counts: { total: number; planned: number; observed: number; unresolved: number };
}

const unwrap = <T,>(opt: { type: "some"; value: T } | { type: "none"; value: null }): T | undefined =>
    opt.type === "some" ? opt.value : undefined;

/**
 * Stroke weight from evidence volume — the spec's log ladder:
 * 1.6 / 2 / 2.5 px, floor 1.4 for links without volume.
 */
export function evidenceWeight(volume: number | undefined, maxVolume: number): number {
    if (volume === undefined || volume <= 0 || maxVolume <= 0) return 1.4;
    const t = Math.log1p(volume) / Math.log1p(maxVolume); // 0..1
    if (t >= 0.85) return 2.5;
    if (t >= 0.45) return 2;
    return 1.6;
}

/** Default link key when none is authored. */
export function linkKey(from: string, to: string, index: number): string {
    return `${from}→${to}#${index}`;
}

/**
 * Builds the view model. Pure; unit-testable.
 */
export function buildModel(value: {
    states: ReadonlyArray<FlowchartStateValue>,
    links: ReadonlyArray<FlowchartLinkValue>,
    lanes: ReadonlyArray<FlowchartLaneValue>,
    triggers: ReadonlyArray<FlowchartTriggerValue>,
}): FlowchartModel {
    const lanes: ModelLane[] = value.lanes.map(l => ({
        key: l.key,
        label: unwrap(l.label) ?? l.key.toUpperCase(),
    }));
    const laneIndex = new Map<string, number>(lanes.map((l, i) => [l.key, i]));

    // Real states, keeping data order within each lane. A state naming an
    // unknown lane lands in the LAST lane rather than vanishing.
    const perLaneCount = new Array<number>(Math.max(lanes.length, 1)).fill(0);
    const nodes: ModelNode[] = [];
    const nodesByKey = new Map<string, ModelNode>();
    const nextLaneOrder = (li: number): number => {
        const n = perLaneCount[li] ?? 0;
        perLaneCount[li] = n + 1;
        return n;
    };
    for (const s of value.states) {
        const li = laneIndex.get(s.lane) ?? Math.max(lanes.length - 1, 0);
        const node: ModelNode = {
            key: s.key,
            label: unwrap(s.label),
            laneIndex: li,
            laneOrder: nextLaneOrder(li),
            members: unwrap(s.members),
            notes: unwrap(s.notes),
            fields: s.fields,
            inPlace: 0,
            ghost: false,
        };
        nodes.push(node);
        nodesByKey.set(node.key, node);
    }

    // Links: self-loops fold into `↻ n`; unknown endpoints derive ghosts.
    const links: ModelLink[] = [];
    const maxVolume = Math.max(0, ...value.links.map(l => {
        const ev = unwrap(l.evidence);
        return ev ? (unwrap(ev.volume) ?? 0) : 0;
    }));
    const ensureGhost = (key: string, nearLane: number): void => {
        if (nodesByKey.has(key)) return;
        const li = Math.min(Math.max(nearLane, 0), Math.max(lanes.length - 1, 0));
        const ghost: ModelNode = {
            key,
            label: "No state row",
            laneIndex: li,
            laneOrder: nextLaneOrder(li),
            members: undefined,
            notes: undefined,
            fields: [],
            inPlace: 0,
            ghost: true,
        };
        nodes.push(ghost);
        nodesByKey.set(key, ghost);
    };

    let planned = 0, observed = 0, unresolved = 0;
    value.links.forEach((l, i) => {
        if (l.from === l.to) {
            const node = nodesByKey.get(l.from);
            if (node) node.inPlace += 1;
            return;
        }
        const missing = !nodesByKey.has(l.from) || !nodesByKey.has(l.to);
        if (missing) {
            // Ghost lands beside the resolved endpoint's lane (or lane 0).
            const anchor = nodesByKey.get(l.from) ?? nodesByKey.get(l.to);
            const near = anchor ? anchor.laneIndex + 1 : 0;
            ensureGhost(l.from, near);
            ensureGhost(l.to, near);
        }
        const kind = unwrap(l.kind)?.type ?? "planned";
        const cls: LinkClass = missing ? "unresolved" : kind;
        if (cls === "planned") planned += 1;
        else if (cls === "observed") observed += 1;
        else unresolved += 1;
        const ev = unwrap(l.evidence);
        links.push({
            key: unwrap(l.key) ?? linkKey(l.from, l.to, i),
            from: l.from,
            to: l.to,
            cls,
            trigger: unwrap(l.trigger),
            evidence: ev,
            fields: l.fields,
            weight: cls === "unresolved" ? 1.4 : evidenceWeight(ev ? unwrap(ev.volume) : undefined, maxVolume),
        });
    });

    const triggers = new Map<string, ModelTrigger>();
    for (const t of value.triggers) {
        triggers.set(t.key, {
            key: t.key,
            label: t.label,
            letter: unwrap(t.letter) ?? (t.label.length > 0 ? t.label.charAt(0).toUpperCase() : "?"),
            owner: unwrap(t.owner),
            queue: unwrap(t.queue) ?? [],
            outcomes: unwrap(t.outcomes),
            governs: links.filter(l => l.trigger === t.key).map(l => l.key),
        });
    }

    return {
        lanes: lanes.length > 0 ? lanes : [{ key: "", label: "" }],
        nodes,
        nodesByKey,
        links,
        triggers,
        counts: { total: links.length, planned, observed, unresolved },
    };
}
