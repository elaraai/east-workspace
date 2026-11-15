/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Allocation (#1409, #1420, east-workspace#1622; `Optimise
 * Spec.md` §5.1, §9.5, R26): the run's request — the day in view, the run's
 * number and the rail's narrowing, and no row: the function reads the bins,
 * the arrivals and the resources itself, the board's unsaved edits laid over
 * them — and its answer, a patch of the bins' record, landed on the bins the
 * page holds as one edit: each key the patch touches, recorded as one step
 * (`ScheduleEditing.record`, origin `optimise`), and what the landing draws
 * kept until Apply — each bin's operation and its provenance, the ghosts of
 * the bins a run moved or removed where they stood, which lanes the latest
 * run changed, whether an arrival left the Arrivals tab or came back to it,
 * and the links the runs added or changed with the kilns they land on, which
 * the Timeline draws outlined in the Elara tone and glows for the highlight.
 * While a run is out the commands are locked (R2): every gesture refused,
 * the day's drafts kept. A bin the answer changes that the page does not hold
 * is read by its key first (rule 8); one it changes outside the day it was
 * asked of — where the bin stood, or where the answer puts it — refuses the
 * answer whole (rule 11).
 *
 * @packageDocumentation
 */

import { DictType, StringType, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import { AllocationOptimiseRequestType, AllocationOptimiseResultTypeFor } from "@elaraai/e3-ui/internal";
import { optimiseMessages } from "@elaraai/east-ui-components";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { landOptimisePatches, type OptimiseRowRef } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import type { OptimiseCounts, OptimiseRefused } from "../shared/func/use-optimise.js";
import type { AllocationCommands } from "./actions.js";
import type { AllocationEditing } from "./editing.js";
import { binCode } from "./inspector-model.js";
import { DAY, compareDate, compareFloat, partsOf, type AllocationDomain, type AllocationValue, type Bin, type Context, type Day } from "./model.js";

/** The run's request: the day, the run's number and the rail's narrowing. */
export type AllocationOptimiseRequest = ValueTypeOf<typeof AllocationOptimiseRequestType>;

/** The run's answer: the patch of the bins' record. */
export interface AllocationOptimiseResult {
    readonly bins: unknown;
}

/** One operation a run left on a bin, until Apply (R17): what it did, the run that made it, and what its hover says. */
export interface AllocationBinOp {
    readonly op: "add" | "chg";
    /** The run's number, formatted. */
    readonly run: string;
    /** `Added by Elara · run #7`, or `Was B-1 06:15 on K-203 · Elara run #7`. */
    readonly provenance: string;
}

/** Where a bin stood before a run removed it (`del`) or moved it (`from`): its ghost, for the highlight (R15). */
export interface AllocationGhost {
    readonly id: string;
    readonly op: "del" | "from";
    readonly run: string;
    /** The lane slot it stood in. */
    readonly lane: string;
    readonly at: Date;
    /** Its code — `LD-2231`, or `Reserved`. */
    readonly label: string;
    /** Where it stood, in words: `B-1 06:15 on K-203`. */
    readonly where: string;
    /** `Removed by Elara · run #7`, or `Moved by Elara · run #7`. */
    readonly title: string;
}

/**
 * What the runs left on the Allocation's bins, until Apply (R17): each bin's
 * operation, a later run's over an earlier's on the same bin; the ghosts of
 * the bins the runs moved or removed, where they stood; the lanes the latest
 * run changed; and whether it booked an arrival or returned one.
 */
export interface AllocationOptimised {
    readonly ops: ReadonlyMap<string, AllocationBinOp>;
    readonly ghosts: readonly AllocationGhost[];
    /** The lanes whose bins the latest run added, moved or removed: their heads' figures flash. */
    readonly lanes: ReadonlySet<string>;
    /** Whether the latest run booked an arrival or returned one to Arrivals: the Arrivals tab's count flashes. */
    readonly arrivalsChanged: boolean;
    /**
     * The links the runs added or changed, by bin — each kiln whose part is new or differs from before the run, an
     * earlier run's kept while the bin still has it — while still the runs' drafts: the Timeline draws them for the
     * highlight, outlined in the Elara tone, never filled, so a result's many links stay readable.
     */
    readonly links: ReadonlyMap<string, ReadonlySet<string>>;
    /** Their kilns: each one's load takes the landing and the highlight with the cards. */
    readonly resources: ReadonlySet<string>;
}

/** What the bound optimiser is called with, as the tag held it to, and the bins' record type. */
export interface AllocationOptimiseTypes {
    readonly request: EastType;
    readonly result: EastType;
    /** The bins' record type, `Dict<String, R>`: what the answer's patch is read by. */
    readonly record: DictType<EastType, EastType>;
}

/**
 * The request and result types over the app's bin row type: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param rowType - The bin kind's row type
 * @returns The request and result East types, and the bins' record type
 */
export function allocationOptimiseTypes(rowType: EastType): AllocationOptimiseTypes {
    const record = DictType(StringType, rowType);
    return { request: AllocationOptimiseRequestType, result: AllocationOptimiseResultTypeFor(record), record };
}

/**
 * The run's request (R1, R26, O3; east-workspace#1622, rule 1): the day in
 * view, the run's number and the rail's narrowing. No row: the function reads
 * the bins, the arrivals and the resources itself, the board's unsaved edits
 * laid over them.
 *
 * @param day - The plan day
 * @param slice - Each rail source's narrowing now
 * @param run - The run's number
 * @returns The request
 */
export function allocationOptimiseRequest(day: Date, slice: OptimiseSlice, run: number): AllocationOptimiseRequest {
    return { day, run: BigInt(run), slice };
}

/**
 * Where a bin stands, as its provenance and its ghost say it: `B-1 06:15 on
 * K-203`, `B-2 10:35 · not linked`.
 *
 * @param value - The payload: the lanes' labels
 * @param context - Every resource, by key
 * @param bin - The bin
 * @returns The words
 */
export function allocationPlaceWords(value: AllocationValue, context: Context, bin: Bin): string {
    const lane = value.lanes.find(l => l.key === bin.lane)?.label ?? bin.lane;
    const first = partsOf(bin)[0];
    const on = first === undefined ? " · not linked" : ` on ${context.resources.get(first.key)?.label ?? first.key}`;
    return `${lane} ${formatDatePattern("HH:mm", bin.at)}${on}`;
}

/** What a landing is made over. */
export interface AllocationLanding {
    readonly value: AllocationValue;
    readonly domain: AllocationDomain;
    /** The bins' record type. */
    readonly types: AllocationOptimiseTypes;
    /** The editing the step is recorded in. */
    readonly editing: AllocationEditing;
    /** A row as the page holds it, read by its key where it holds none: what the answer lands on. */
    readonly held: (kind: string, id: string) => option<unknown> | undefined;
    readonly request: AllocationOptimiseRequest;
    readonly result: AllocationOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** The day's words, which a refusal names. */
    readonly period: string;
    /** The day as drafted before the run: where a ghost goes, and what the provenance says a bin was. */
    readonly plan: Day;
    readonly context: Context;
    /** What earlier runs left on the bins, still the session's drafts. */
    readonly before: AllocationOptimised | undefined;
}

/** What a landing answers that is no landing: bins to read first, by their keys (rule 8). */
export interface AllocationOptimiseMissing {
    readonly missing: readonly OptimiseRowRef[];
}

/**
 * The result landed (R7, R8, R10, §12; east-workspace#1622, rules 7, 8, 10,
 * 11): the answer's patch landed key by key on the bins the page holds, and
 * recorded as one step of the history, origin `optimise`. A bin the
 * result adds is an add — booked, its arrival leaves the Arrivals tab; one it
 * changes is a change, with a ghost at its old lane slot when it moved; one
 * it drops is a remove, its ghost where it stood, its arrival back in
 * Arrivals (§9.5). A result that changes nothing records nothing and leaves
 * what earlier runs left as it is (R10); one that does lays its operations,
 * its ghosts and its links over theirs. One that changes a bin outside the
 * day it was asked of — where the bin stood, or where the answer puts it — is
 * refused whole, naming the bin; one that touches a bin the page does not hold
 * names it, to be read by its key.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the bins — unchanged by a run that changed nothing;
 *   the bins to read first; a refusal, naming the bin; `undefined` for an answer that does not fit the bins the page
 *   holds, or one the session would not take
 */
export function landAllocationOptimise(args: AllocationLanding,
): { counts: OptimiseCounts; optimised: AllocationOptimised | undefined } | AllocationOptimiseMissing | OptimiseRefused | undefined {
    const { value, domain, types, editing, held, request, result, label, runText, period, plan, context, before } = args;
    const kind = value.bin.kind.key;
    const landed = landOptimisePatches<unknown>([{ kind, record: types.record, patch: result.bins }], held);
    if (landed === undefined) return undefined;
    if ("missing" in landed) return { missing: landed.missing };
    // No bin is half made: every draft is a whole row.
    if ("incomplete" in landed) return undefined;
    const diff = landed[0]!;
    // Outside the day it was asked of (rule 11): where a bin stood, or where the answer puts it. The bin is named as the
    // board names one — its load's code, or a reservation — as the day holds it, else as its own row reads.
    const from = request.day.getTime(), to = from + DAY;
    const binOf = (row: unknown): Bin => ({ ...value.bin.read(domain.encodeRow(row)), row }) as Bin;
    const outside = (bin: Bin | undefined): boolean => bin !== undefined && (bin.at.getTime() < from || bin.at.getTime() >= to);
    for (const [key, op] of diff.ops) {
        const was = "previous" in op ? binOf(op.previous) : undefined;
        const now = "row" in op ? binOf(op.row) : undefined;
        if (outside(was) || outside(now)) {
            const named = plan.bins.get(key.slice(kind.length + 1)) ?? was ?? now!;
            return { refused: optimiseMessages.refusedOutside({ row: binCode(context, named, value.labels), period }) };
        }
    }
    if (diff.changes.length === 0) return { counts: diff.counts, optimised: undefined };
    if (!editing.schedule.record(diff.changes, "optimise", label)) return undefined;
    // This run's operations over the earlier runs': a bin it touched again is its, and an earlier ghost of it gives way.
    const touched = new Set([...diff.ops.keys()].map(key => key.slice(kind.length + 1)));
    const ops = new Map<string, AllocationBinOp>(before?.ops ?? []);
    const links = new Map<string, ReadonlySet<string>>(before?.links ?? []);
    const ghosts = (before?.ghosts ?? []).filter(ghost => !touched.has(ghost.id));
    const lanes = new Set<string>();
    let arrivalsChanged = false;
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        const was = plan.bins.get(id);
        if (op.op === "del") {
            ops.delete(id);
            links.delete(id);
            if (was === undefined) continue;
            lanes.add(was.lane);
            if (was.arrival.type === "some") arrivalsChanged = true;
            ghosts.push({ id, op: "del", run: runText, lane: was.lane, at: was.at, label: binCode(context, was, value.labels), where: allocationPlaceWords(value, context, was),
                title: optimiseMessages.ghostRemoved({ run: runText }) });
            continue;
        }
        // The row's roles, as the kind reads them: where the bin is now.
        const roles = value.bin.read(domain.encodeRow(op.row));
        lanes.add(roles.lane);
        if (op.op === "add" || was === undefined) {
            ops.set(id, { op: "add", run: runText, provenance: optimiseMessages.entryAdded({ run: runText }) });
            if (roles.arrival.type === "some") arrivalsChanged = true;
            if (roles.parts.size > 0) links.set(id, new Set(roles.parts.keys()));
            continue;
        }
        ops.set(id, { op: "chg", run: runText, provenance: optimiseMessages.entryChanged({ previous: allocationPlaceWords(value, context, was), run: runText }) });
        lanes.add(was.lane);
        // The parts this run added or changed, with an earlier run's the bin still has: the links the highlight draws.
        const parts = new Set([...(links.get(id) ?? [])].filter(kiln => roles.parts.has(kiln)));
        for (const [kiln, quantity] of roles.parts) {
            const had = was.parts.get(kiln);
            if (had === undefined || compareFloat(had, quantity) !== 0) parts.add(kiln);
        }
        if (parts.size > 0) links.set(id, parts); else links.delete(id);
        // Booked or unbooked: the arrival leaves or returns.
        if (was.arrival.type !== roles.arrival.type || (was.arrival.type === "some" && roles.arrival.type === "some" && was.arrival.value !== roles.arrival.value)) arrivalsChanged = true;
        // Moved to another lane slot: a ghost where it stood.
        if (was.lane !== roles.lane || compareDate(was.at, roles.at) !== 0) {
            ghosts.push({ id, op: "from", run: runText, lane: was.lane, at: was.at, label: binCode(context, was, value.labels), where: allocationPlaceWords(value, context, was),
                title: optimiseMessages.ghostMoved({ run: runText }) });
        }
    }
    const resources = new Set<string>();
    for (const kilns of links.values()) for (const kiln of kilns) resources.add(kiln);
    return { counts: diff.counts, optimised: { ops, ghosts, lanes, arrivalsChanged, links, resources } };
}

/**
 * The commands while a run is out (R2): the day takes no gesture — every
 * command refused, Publish off — the session the views read kept, so they
 * keep drawing their drafts while nothing is written.
 *
 * @param commands - The commands
 * @returns The commands, locked
 */
export function lockAllocationCommands(commands: AllocationCommands): AllocationCommands {
    const refused = () => false;
    const nothing = () => undefined;
    return {
        ...commands, available: false, canEdit: () => false,
        remove: nothing, revert: nothing, unlink: nothing, unbook: nothing, publish: nothing,
        setQuantity: refused, row: refused, field: refused, split: refused, setPart: refused, move: refused, link: refused, fill: refused,
        book: refused, replace: refused, fillWith: refused, reserve: refused, restore: refused, restoreInto: refused,
    };
}
