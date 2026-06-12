/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table projection of an ontology value — the pure derivation behind the
 * editor's table view. Internal to the component (not exported from the
 * package index): nothing here is public API.
 *
 * The projection renders the ontology as a value-driver-tree-shaped table:
 *
 * - **Objective forest** — apex objectives (those that don't `drive`
 *   another objective) at the top, sub-objectives indented beneath via
 *   `objective --drives--> objective` chains.
 * - **KPI tier** — within an objective, processes partition under the KPI
 *   that connects them to it (`process --results_in--> kpi` /
 *   `kpi --measures--> process`, then `kpi --drives--> objective`).
 * - **Process rows** — the leaves, ordered by **value-chain stage**: the
 *   longest-path layering of the process-precedence DAG induced by
 *   resource flow (`A produces r` ∧ `B uses r` ⇒ `A ≺ B`), with
 *   strongly-connected components condensed first so resource cycles
 *   (cash → materials → goods → cash) are honest: every member shares a
 *   stage and is flagged `cyclic` instead of breaking the sort.
 * - **Lints** — REA-duality and reachability checks (a process with no
 *   inputs or no outputs, an unmeasured process, a decision driving
 *   nothing, an unreachable objective, orphan links).
 *
 * @packageDocumentation
 */

import type { Ontology, OntologyNodeKind } from './types.js';

// ============================================================================
// Output shape.
// ============================================================================

/** A node reference rendered as a chip in a table cell. */
export interface NodeChip {
    id: string;
    name: string;
    kind: OntologyNodeKind;
}

/** A process adjacent in the resource flow, with the resources that
 *  connect it — the row-level answer to "how does this process affect
 *  the next one". */
export interface FlowNeighbor {
    id: string;
    name: string;
    /** Names of the resources carrying the dependency. */
    via: string[];
}

/** One process leaf row. */
export interface ProcessRow {
    id: string;
    name: string;
    description: string | undefined;
    /** 1-based global value-chain stage (longest-path layer of the SCC
     *  condensation). Identical for every member of a resource cycle. */
    stage: number;
    /** True iff this process is in a resource-flow cycle (SCC size > 1). */
    cyclic: boolean;
    /** Names of the other processes in the same cycle (empty if acyclic). */
    cycleWith: string[];
    /** Processes that produce a resource this one uses (what feeds me). */
    upstream: FlowNeighbor[];
    /** Processes that use a resource this one produces (what I feed). */
    downstream: FlowNeighbor[];
    uses: NodeChip[];
    produces: NodeChip[];
    kpis: NodeChip[];
    data: NodeChip[];
    decisions: NodeChip[];
    policies: NodeChip[];
    agents: NodeChip[];
    /** KPIs (beyond the section's own) that also connect this row to the
     *  enclosing objective — rendered as "also via …" chips. */
    alsoVia: NodeChip[];
    /** Row-level completeness warnings (REA duality etc.). */
    lints: string[];
}

/** A KPI sub-section within an objective group. `kpi === null` collects
 *  processes that reach the objective without a connecting KPI (direct
 *  `process --drives--> objective`). */
export interface KpiSection {
    kpi: NodeChip | null;
    rows: ProcessRow[];
}

/** An objective group — one node of the objective forest. */
export interface ObjectiveGroup {
    /** `null` for the synthetic "Unassigned" group. */
    id: string | null;
    name: string;
    description: string | undefined;
    /** Indent depth in the objective forest (apex = 0). */
    depth: number;
    /** KPI sub-sections. A single section with `kpi: null` when the
     *  objective has at most one connecting KPI (no tier tax). */
    sections: KpiSection[];
    /** Sub-objectives indented beneath this one. */
    children: ObjectiveGroup[];
    /** Totals across this group (excluding children). */
    processCount: number;
    decisionCount: number;
    lintCount: number;
}

/** The full table projection. */
export interface TableProjection {
    groups: ObjectiveGroup[];
    /** Graph-level warnings (unattached KPIs, idle decisions, orphan links…). */
    lints: string[];
    /** Highest stage number assigned (for the stage legend). */
    stageCount: number;
    /** Total process count (for the empty state). */
    processCount: number;
}

// ============================================================================
// Internal graph helpers.
// ============================================================================

interface FlatNode {
    id: string;
    name: string;
    description: string | undefined;
    kind: OntologyNodeKind;
}

/** Tarjan strongly-connected components over a directed adjacency map.
 *  Returns one array of node ids per component, and the component index
 *  per node. Iterative (explicit stack) so deep chains can't overflow. */
function tarjanScc(
    ids: string[],
    adj: Map<string, Set<string>>,
): { components: string[][]; componentOf: Map<string, number> } {
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const components: string[][] = [];
    const componentOf = new Map<string, number>();
    let counter = 0;

    for (const root of ids) {
        if (index.has(root)) continue;
        // Each frame: [node, iterator position into its successors].
        const work: Array<[string, string[], number]> = [[root, [...(adj.get(root) ?? [])], 0]];
        index.set(root, counter);
        lowlink.set(root, counter);
        counter += 1;
        stack.push(root);
        onStack.add(root);

        while (work.length > 0) {
            const frame = work[work.length - 1]!;
            const [v, succs] = frame;
            if (frame[2] < succs.length) {
                const w = succs[frame[2]]!;
                frame[2] += 1;
                if (!index.has(w)) {
                    index.set(w, counter);
                    lowlink.set(w, counter);
                    counter += 1;
                    stack.push(w);
                    onStack.add(w);
                    work.push([w, [...(adj.get(w) ?? [])], 0]);
                } else if (onStack.has(w)) {
                    lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
                }
            } else {
                work.pop();
                if (work.length > 0) {
                    const parent = work[work.length - 1]![0];
                    lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!));
                }
                if (lowlink.get(v) === index.get(v)) {
                    const component: string[] = [];
                    for (;;) {
                        const w = stack.pop()!;
                        onStack.delete(w);
                        component.push(w);
                        if (w === v) break;
                    }
                    const ci = components.length;
                    components.push(component);
                    for (const w of component) componentOf.set(w, ci);
                }
            }
        }
    }
    return { components, componentOf };
}

/** Longest-path layering of a DAG: layer(n) = 1 + max(layer(preds)). */
function longestPathLayers(count: number, edges: Array<[number, number]>): number[] {
    const preds: number[][] = Array.from({ length: count }, () => []);
    const outDeg: number[] = Array.from({ length: count }, () => 0);
    const inDeg: number[] = Array.from({ length: count }, () => 0);
    for (const [a, b] of edges) {
        preds[b]!.push(a);
        outDeg[a]! += 1;
        inDeg[b]! += 1;
    }
    // Kahn order, then relax. (The graph is a condensation, hence acyclic.)
    const layer: number[] = Array.from({ length: count }, () => 1);
    const queue: number[] = [];
    const remaining = [...inDeg];
    for (let i = 0; i < count; i++) if (remaining[i] === 0) queue.push(i);
    const order: number[] = [];
    while (queue.length > 0) {
        const n = queue.shift()!;
        order.push(n);
        for (const [a, b] of edges) {
            if (a !== n) continue;
            remaining[b]! -= 1;
            if (remaining[b] === 0) queue.push(b);
        }
    }
    for (const n of order) {
        for (const p of preds[n]!) layer[n] = Math.max(layer[n]!, layer[p]! + 1);
    }
    return layer;
}

// ============================================================================
// The projection.
// ============================================================================

export function projectTable(ontology: Ontology): TableProjection {
    // ---- Flatten + index. -------------------------------------------------
    const nodes: FlatNode[] = ontology.nodes.map(n => ({
        id: n.id,
        name: n.name,
        description: n.description.type === 'some' ? n.description.value : undefined,
        kind: n.type.type,
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const lints: string[] = [];

    interface FlatLink { source: string; target: string; kind: string }
    const links: FlatLink[] = [];
    for (const l of ontology.links) {
        if (!byId.has(l.source) || !byId.has(l.target)) {
            lints.push(`Orphan link ${l.id}: ${l.source} → ${l.target}`);
            continue;
        }
        links.push({ source: l.source, target: l.target, kind: l.type.type });
    }

    const chip = (id: string): NodeChip => {
        const n = byId.get(id)!;
        return { id: n.id, name: n.name, kind: n.kind };
    };
    const ofKind = (kind: OntologyNodeKind) => nodes.filter(n => n.kind === kind);
    const processes = ofKind('process');
    const sortChips = (cs: NodeChip[]) => [...new Map(cs.map(c => [c.id, c])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));

    // ---- Per-process relations (liberal across canonical directions). -----
    const rel = new Map<string, {
        uses: NodeChip[]; produces: NodeChip[]; kpis: NodeChip[]; data: NodeChip[];
        decisions: NodeChip[]; policies: NodeChip[]; agents: NodeChip[]; directObjectives: string[];
    }>();
    for (const p of processes) {
        rel.set(p.id, { uses: [], produces: [], kpis: [], data: [], decisions: [], policies: [], agents: [], directObjectives: [] });
    }
    const kindOf = (id: string) => byId.get(id)!.kind;

    for (const l of links) {
        const sk = kindOf(l.source);
        const tk = kindOf(l.target);
        // process ↔ resource flow
        if (sk === 'process' && tk === 'resource' && l.kind === 'uses') rel.get(l.source)!.uses.push(chip(l.target));
        if (sk === 'resource' && tk === 'process' && l.kind === 'used_by') rel.get(l.target)!.uses.push(chip(l.source));
        if (sk === 'process' && tk === 'resource' && l.kind === 'produces') rel.get(l.source)!.produces.push(chip(l.target));
        // process ↔ kpi
        if (sk === 'kpi' && tk === 'process' && l.kind === 'measures') rel.get(l.target)!.kpis.push(chip(l.source));
        if (sk === 'process' && tk === 'kpi' && l.kind === 'results_in') rel.get(l.source)!.kpis.push(chip(l.target));
        // process ↔ data / computation
        if (sk === 'data' && tk === 'process') rel.get(l.target)!.data.push(chip(l.source));
        if (sk === 'process' && tk === 'data') rel.get(l.source)!.data.push(chip(l.target));
        if (sk === 'computation' && tk === 'process') rel.get(l.target)!.data.push(chip(l.source));
        if (sk === 'process' && tk === 'computation') rel.get(l.source)!.data.push(chip(l.target));
        // decision → process
        if (sk === 'decision' && tk === 'process' && l.kind === 'drives') rel.get(l.target)!.decisions.push(chip(l.source));
        // policy ↔ process
        if (sk === 'policy' && tk === 'process' && l.kind === 'constrains') rel.get(l.target)!.policies.push(chip(l.source));
        if (sk === 'process' && tk === 'policy' && l.kind === 'executes') rel.get(l.source)!.policies.push(chip(l.target));
        // agent ↔ process
        if (sk === 'agent' && tk === 'process' && l.kind === 'executes') rel.get(l.target)!.agents.push(chip(l.source));
        if (sk === 'process' && tk === 'agent' && l.kind === 'uses') rel.get(l.source)!.agents.push(chip(l.target));
        // process → objective (direct)
        if (sk === 'process' && tk === 'objective' && l.kind === 'drives') rel.get(l.source)!.directObjectives.push(l.target);
    }

    // ---- Value-chain stages (SCC condensation + longest-path layers). -----
    // A ≺ B iff A produces a resource B uses.
    const producersOf = new Map<string, string[]>(); // resource id -> process ids
    const usersOf = new Map<string, string[]>();
    for (const p of processes) {
        for (const r of rel.get(p.id)!.produces) {
            producersOf.set(r.id, [...(producersOf.get(r.id) ?? []), p.id]);
        }
        for (const r of rel.get(p.id)!.uses) {
            usersOf.set(r.id, [...(usersOf.get(r.id) ?? []), p.id]);
        }
    }
    const prec = new Map<string, Set<string>>(processes.map(p => [p.id, new Set<string>()]));
    // a → b via resource r: a produces r, b uses r. `flowVia` remembers the
    // carrying resources so rows can explain *how* they affect each other.
    const flowVia = new Map<string, Set<string>>(); // "a>b" -> resource names
    for (const [resourceId, producers] of producersOf) {
        for (const a of producers) {
            for (const b of usersOf.get(resourceId) ?? []) {
                if (a === b) continue;
                prec.get(a)!.add(b);
                const key = `${a}>${b}`;
                if (!flowVia.has(key)) flowVia.set(key, new Set());
                flowVia.get(key)!.add(byId.get(resourceId)!.name);
            }
        }
    }
    const neighborsOf = (pid: string): { upstream: FlowNeighbor[]; downstream: FlowNeighbor[] } => {
        const upstream: FlowNeighbor[] = [];
        const downstream: FlowNeighbor[] = [];
        for (const [a, succs] of prec) {
            if (a === pid) {
                for (const b of succs) {
                    downstream.push({ id: b, name: byId.get(b)!.name, via: [...flowVia.get(`${a}>${b}`)!].sort() });
                }
            } else if (succs.has(pid)) {
                upstream.push({ id: a, name: byId.get(a)!.name, via: [...flowVia.get(`${a}>${pid}`)!].sort() });
            }
        }
        upstream.sort((x, y) => x.name.localeCompare(y.name));
        downstream.sort((x, y) => x.name.localeCompare(y.name));
        return { upstream, downstream };
    };
    const { components, componentOf } = tarjanScc(processes.map(p => p.id), prec);
    const condensedEdges: Array<[number, number]> = [];
    const seenEdge = new Set<string>();
    for (const [a, succs] of prec) {
        for (const b of succs) {
            const ca = componentOf.get(a)!;
            const cb = componentOf.get(b)!;
            if (ca === cb) continue;
            const key = `${ca}>${cb}`;
            if (seenEdge.has(key)) continue;
            seenEdge.add(key);
            condensedEdges.push([ca, cb]);
        }
    }
    const layers = longestPathLayers(components.length, condensedEdges);
    const stageOf = (pid: string) => layers[componentOf.get(pid)!]!;
    const cycleOf = (pid: string) => components[componentOf.get(pid)!]!;
    const stageCount = layers.reduce((m, l) => Math.max(m, l), 0);

    // Within a cycle there is no topological order, but there is a best
    // reading order: enter at the member the rest of the value chain flows
    // into (an upstream producer *outside* the SCC), then follow the loop —
    // every row is fed by the row above it, and only the wrap-around edge
    // points back. Ties (no external inflow) fall back to name.
    const nameOf = (id: string) => byId.get(id)!.name;
    const cycleRank = new Map<string, number>();   // walk position within the SCC
    const sccKey = new Map<string, string>();      // clusters SCC members in the sort
    for (const component of components) {
        if (component.length === 1) {
            const only = component[0]!;
            cycleRank.set(only, 0);
            sccKey.set(only, nameOf(only));
            continue;
        }
        const inScc = new Set(component);
        const externalInflow = (m: string) => {
            let n = 0;
            for (const [a, succs] of prec) {
                if (!inScc.has(a) && succs.has(m)) n += 1;
            }
            return n;
        };
        const entry = [...component].sort((a, b) =>
            externalInflow(b) - externalInflow(a) || nameOf(a).localeCompare(nameOf(b)))[0]!;
        const order: string[] = [];
        const visited = new Set<string>();
        const walk = (m: string) => {
            visited.add(m);
            order.push(m);
            const nexts = [...(prec.get(m) ?? [])]
                .filter(x => inScc.has(x) && !visited.has(x))
                .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
            for (const x of nexts) walk(x);
        };
        walk(entry);
        for (const m of [...component].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
            if (!visited.has(m)) walk(m);
        }
        order.forEach((m, i) => {
            cycleRank.set(m, i);
            sccKey.set(m, nameOf(entry));
        });
    }

    // ---- KPI → objective reachability (drives chains). ---------------------
    const drivesAdj = new Map<string, Set<string>>();
    for (const l of links) {
        if (l.kind !== 'drives') continue;
        if (!drivesAdj.has(l.source)) drivesAdj.set(l.source, new Set());
        drivesAdj.get(l.source)!.add(l.target);
    }
    /** Objectives reachable from `start` over `drives` edges. */
    const reachObjectives = (start: string): Set<string> => {
        const seen = new Set<string>([start]);
        const out = new Set<string>();
        const queue = [start];
        while (queue.length > 0) {
            const n = queue.shift()!;
            for (const next of drivesAdj.get(n) ?? []) {
                if (seen.has(next)) continue;
                seen.add(next);
                if (kindOf(next) === 'objective') out.add(next);
                queue.push(next);
            }
        }
        return out;
    };
    const kpiObjectives = new Map<string, Set<string>>();
    for (const k of ofKind('kpi')) kpiObjectives.set(k.id, reachObjectives(k.id));

    // ---- Build process rows. -----------------------------------------------
    const rowOf = (p: FlatNode): ProcessRow => {
        const r = rel.get(p.id)!;
        const cycle = cycleOf(p.id);
        const rowLints: string[] = [];
        if (r.uses.length === 0) rowLints.push('No inputs (uses)');
        if (r.produces.length === 0) rowLints.push('No outputs (produces)');
        if (r.kpis.length === 0) rowLints.push('No KPI');
        if (r.decisions.length === 0) rowLints.push('No decision');
        const { upstream, downstream } = neighborsOf(p.id);
        return {
            id: p.id,
            name: p.name,
            description: p.description,
            stage: stageOf(p.id),
            cyclic: cycle.length > 1,
            cycleWith: cycle.filter(id => id !== p.id).map(id => byId.get(id)!.name).sort(),
            upstream,
            downstream,
            uses: sortChips(r.uses),
            produces: sortChips(r.produces),
            kpis: sortChips(r.kpis),
            data: sortChips(r.data),
            decisions: sortChips(r.decisions),
            policies: sortChips(r.policies),
            agents: sortChips(r.agents),
            alsoVia: [],
            lints: rowLints,
        };
    };

    // ---- Objective forest. --------------------------------------------------
    const objectives = ofKind('objective');
    const objectiveIds = new Set(objectives.map(o => o.id));
    // child --drives--> parent: the child contributes to the parent, so it
    // indents beneath it. Apexes have no outgoing drives to an objective.
    const parentOf = new Map<string, string>();
    for (const l of links) {
        if (l.kind !== 'drives') continue;
        if (!objectiveIds.has(l.source) || !objectiveIds.has(l.target)) continue;
        if (!parentOf.has(l.source)) parentOf.set(l.source, l.target);
    }

    // Processes per objective: via KPIs (and direct drives).
    const processObjectives = new Map<string, Set<string>>();
    for (const p of processes) {
        const r = rel.get(p.id)!;
        const objs = new Set<string>(r.directObjectives);
        for (const k of r.kpis) {
            for (const o of kpiObjectives.get(k.id) ?? []) objs.add(o);
        }
        processObjectives.set(p.id, objs);
    }

    // Stage first (the global value chain); within a stage, cycle members
    // stay contiguous (sccKey) and follow the loop walk (cycleRank).
    const sortRows = (rows: ProcessRow[]) =>
        rows.sort((a, b) =>
            a.stage - b.stage
            || (sccKey.get(a.id) ?? a.name).localeCompare(sccKey.get(b.id) ?? b.name)
            || (cycleRank.get(a.id) ?? 0) - (cycleRank.get(b.id) ?? 0)
            || a.name.localeCompare(b.name));

    const buildGroup = (o: FlatNode, depth: number): ObjectiveGroup => {
        const members = processes.filter(p => processObjectives.get(p.id)!.has(o.id));
        // Partition by the first KPI connecting the process to this objective.
        const connecting = (p: FlatNode): NodeChip[] =>
            sortChips(rel.get(p.id)!.kpis.filter(k => (kpiObjectives.get(k.id) ?? new Set()).has(o.id)));
        const kpiIds = sortChips(members.flatMap(connecting));
        let sections: KpiSection[];
        if (kpiIds.length <= 1) {
            // No KPI tier tax for simple objectives.
            sections = [{ kpi: kpiIds[0] ?? null, rows: sortRows(members.map(rowOf)) }];
        } else {
            const byKpi = new Map<string, ProcessRow[]>(kpiIds.map(k => [k.id, []]));
            const direct: ProcessRow[] = [];
            for (const p of members) {
                const ks = connecting(p);
                const row = rowOf(p);
                if (ks.length === 0) {
                    direct.push(row);
                } else {
                    row.alsoVia = ks.slice(1);
                    byKpi.get(ks[0]!.id)!.push(row);
                }
            }
            sections = kpiIds
                .map(k => ({ kpi: k, rows: sortRows(byKpi.get(k.id)!) }))
                .filter(s => s.rows.length > 0);
            if (direct.length > 0) sections.push({ kpi: null, rows: sortRows(direct) });
        }
        const children = objectives
            .filter(c => parentOf.get(c.id) === o.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => buildGroup(c, depth + 1));
        const allRows = sections.flatMap(s => s.rows);
        return {
            id: o.id,
            name: o.name,
            description: o.description,
            depth,
            sections,
            children,
            processCount: allRows.length,
            decisionCount: new Set(allRows.flatMap(r => r.decisions.map(d => d.id))).size,
            lintCount: allRows.reduce((n, r) => n + r.lints.length, 0),
        };
    };

    const apexes = objectives
        .filter(o => !parentOf.has(o.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    const groups = apexes.map(o => buildGroup(o, 0));

    // Unassigned group — processes serving no objective. Elicitation debt,
    // surfaced on purpose.
    const unassigned = processes.filter(p => processObjectives.get(p.id)!.size === 0);
    if (unassigned.length > 0) {
        const rows = sortRows(unassigned.map(rowOf));
        groups.push({
            id: null,
            name: 'Unassigned',
            description: undefined,
            depth: 0,
            sections: [{ kpi: null, rows }],
            children: [],
            processCount: rows.length,
            decisionCount: new Set(rows.flatMap(r => r.decisions.map(d => d.id))).size,
            lintCount: rows.reduce((n, r) => n + r.lints.length, 0),
        });
    }

    // ---- Graph-level lints. --------------------------------------------------
    const attachedKpis = new Set(processes.flatMap(p => rel.get(p.id)!.kpis.map(k => k.id)));
    for (const k of ofKind('kpi')) {
        if (!attachedKpis.has(k.id)) lints.push(`KPI "${k.name}": measures nothing`);
    }
    const drivingDecisions = new Set<string>();
    for (const l of links) {
        if (kindOf(l.source) === 'decision' && (l.kind === 'drives' || l.kind === 'executes')) drivingDecisions.add(l.source);
    }
    for (const d of ofKind('decision')) {
        if (!drivingDecisions.has(d.id)) lints.push(`Decision "${d.name}": drives nothing`);
    }
    const reachedObjectives = new Set<string>(
        [...processObjectives.values()].flatMap(s => [...s]),
    );
    for (const o of objectives) {
        const hasChild = objectives.some(c => parentOf.get(c.id) === o.id);
        if (!reachedObjectives.has(o.id) && !hasChild) lints.push(`Objective "${o.name}": nothing drives it`);
    }

    return {
        groups,
        lints,
        stageCount,
        processCount: processes.length,
    };
}
