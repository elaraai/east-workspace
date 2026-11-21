/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run's answer landed on a record, key by key (#1409, east-workspace#1622,
 * rules 7, 8 and 11; `Optimise Spec.md` §6 "The one step", §9.2 R7). The
 * answer is East's patch of the record; e3-ui's `optimiseChangesFor` reads
 * it key by key — a patch of the whole Dict among it, never the record
 * replaced — and each key lands on the row the page holds: an insert adds the
 * row under the optimiser's key, an update changes the held row by its patch,
 * a delete removes it. A row the answer updates or deletes that the page does
 * not hold is named, to be read by its key before the answer lands (rule 8);
 * one whose own edit is still incomplete refuses the answer (rule 11). The
 * landing becomes the builder's changes — `{ kind, id, row, created }`,
 * `{ kind, id, row }`, `{ kind, id, remove }` — for one `record` call, and
 * the operations the landing draws and the provenance says (`data-op`,
 * `Was {previous} · Elara run #n`), kept until Apply. An answer is an edit
 * like any other (east-workspace#1709, ruling 14): where the app builds a
 * row's key from its fields (`key`), the step moves a row whose key the answer
 * changed under the key it then builds, and what the run leaves on the row is
 * kept under that key; a step a row's key refuses says why, in the words every
 * refused key is said in.
 *
 * @packageDocumentation
 */

import { East, PatchType, encodeBeast2For, equalFor, parseFor, printFor, type DictType, type EastType, type option } from "@elaraai/east";
import { optimiseChangesFor } from "@elaraai/e3-ui/internal";
import type { ScheduleChange, ScheduleEditing } from "../schedule/editing.js";
import { keyRefusedText } from "../schedule/words.js";
import type { OptimiseCounts, OptimiseMissing, OptimiseRefused } from "./use-optimise.js";

/**
 * One operation of a run on an entry (R7): the entry — its kind and its key's
 * text, which {@link opKey} keeps it under — what the run did, and the row
 * before it, for the provenance.
 *
 * @typeParam R - The entry's row
 */
export type OptimiseOp<R = unknown> =
    | { readonly kind: string; readonly id: string; readonly op: "add"; readonly row: R }
    | { readonly kind: string; readonly id: string; readonly op: "chg"; readonly row: R; readonly previous: R }
    | { readonly kind: string; readonly id: string; readonly op: "del"; readonly previous: R };

/**
 * A run's diff: its changes for one `record`, its operations by entry, and
 * what it counted.
 *
 * @typeParam R - The entries' row
 */
export interface OptimiseDiff<R = unknown> {
    readonly changes: readonly ScheduleChange[];
    /** Each operation, under {@link opKey}. */
    readonly ops: ReadonlyMap<string, OptimiseOp<R>>;
    readonly counts: OptimiseCounts;
}

/** No operations. */
export const NO_OPTIMISE_DIFF: OptimiseDiff<never> = { changes: [], ops: new Map(), counts: { added: 0, changed: 0, removed: 0 } };

/**
 * The key an entry's operation is kept under: its kind and its id, so two
 * kinds' entries of one id never meet.
 *
 * @param kind - The kind's slot, or the record's key
 * @param id - The entry's key's text
 * @returns The key
 */
export function opKey(kind: string, id: string): string {
    return `${kind}\u0000${id}`;
}

/**
 * An operation's key ({@link opKey}) once its run's step is recorded: its row's kind, and the key the row stands under
 * now ({@link OptimiseUnder}) — another than the one it had where the step moved the row under the key its fields build.
 *
 * @param key - The operation's key, as it was kept before the step
 * @param under - Where each row stands once the step is recorded
 * @returns The key it is kept under now
 */
export function opKeyUnder(key: string, under: OptimiseUnder): string {
    const at = key.indexOf("\u0000");
    if (at < 0) return key;
    const kind = key.slice(0, at);
    return opKey(kind, under(kind, key.slice(at + 1)));
}

/**
 * An entry's key as its session names it: a String key as it is, any other
 * as East prints it — what a Schedule session's ids are.
 *
 * @param keyType - The record's key type
 * @returns The key's text
 */
export function optimiseIdOf<K>(keyType: EastType): (key: K) => string {
    if (keyType.type === "String") return (key) => key as unknown as string;
    const print = printFor(keyType) as (key: K) => string;
    return (key) => print(key);
}

/**
 * An entry's key from its id, as its session names it: a String key is its
 * own id, any other is read from East's text of it — {@link optimiseIdOf}'s
 * inverse, for the rows a request carries by key.
 *
 * @param keyType - The record's key type
 * @returns The key; `undefined` for an id that names no key of the type
 */
export function optimiseKeyOf<K>(keyType: EastType): (id: string) => K | undefined {
    if (keyType.type === "String") return (id) => id as unknown as K;
    const parse = parseFor(keyType) as (text: string) => { success: true; value: K } | { success: false };
    return (id) => {
        const read = parse(id);
        return read.success ? read.value : undefined;
    };
}

/** What lands on one key of a record, as `optimiseChangesFor` reads an answer: East's own operation of a Dict's patch. */
type OptimiseChange<R> =
    | { readonly type: "insert"; readonly value: R }
    | { readonly type: "update"; readonly value: unknown }
    | { readonly type: "delete"; readonly value: R };

/**
 * Why an answer does not land as it stands: rows it touches that the page does not hold, to be read by their keys first
 * (rule 8); or rows whose own edit is still incomplete, which refuse it (rule 11). Each row by its kind and its key's
 * text, as its session names it.
 */
export type OptimiseUnlanded = OptimiseMissing | { readonly incomplete: readonly OptimiseRowRef[] };

/** A row an answer touches: its kind's slot, or its record's key, and its key's text. */
export interface OptimiseRowRef {
    readonly kind: string;
    readonly id: string;
}

/** How a record's patch is read and one of its rows patched, compared and encoded: made once per record type. */
interface RecordLanding {
    readonly changesOf: (patch: unknown) => ReadonlyMap<unknown, OptimiseChange<unknown>>;
    readonly patchRow: (row: unknown, rowPatch: unknown) => unknown;
    readonly same: (a: unknown, b: unknown) => boolean;
    readonly encode: (row: unknown) => Uint8Array;
}

/** Each record type's landing, by the type: a builder holds its records' types while its payload does. */
const landings = new WeakMap<object, RecordLanding>();

/** A record type's landing, compiled once. */
function landingOf(record: DictType<EastType, EastType>): RecordLanding {
    let landing = landings.get(record);
    if (landing === undefined) {
        const rowType = record.value as EastType;
        landing = {
            changesOf: East.compile(optimiseChangesFor(record), []) as unknown as RecordLanding["changesOf"],
            patchRow: East.compile(East.function([rowType, PatchType(rowType)], rowType, (_$, row, rowPatch) => East.applyPatch(row as never, rowPatch as never)), []) as
                unknown as RecordLanding["patchRow"],
            same: equalFor(rowType) as RecordLanding["same"],
            encode: encodeBeast2For(rowType) as RecordLanding["encode"],
        };
        landings.set(record, landing);
    }
    return landing;
}

/**
 * One record's answer landed key by key (rules 7, 8, 11). Each key the patch touches lands on the row the page holds:
 * an insert is an add under the optimiser's key — or, onto a row the page holds, a change of it; an update is a
 * change, the held row patched; a delete a remove, and of a key no row stands under, nothing. A key that lands as the
 * row it was is no edit, and a patch that changes nothing is none.
 *
 * @typeParam K - The record's key
 * @typeParam R - The record's row
 * @param kind - The kind's slot, or the record's key: what the changes name
 * @param record - The record's type, `Dict<K, R>`: how the patch is read, and a row compared, patched and encoded
 * @param idOf - An entry's key as its session names it ({@link optimiseIdOf})
 * @param patch - The answer's patch of the record
 * @param held - The row the page holds under a key's text — its draft where it has one; `none` for a key no row stands
 *   under; `undefined` for one the page does not hold, or is still reading
 * @param incomplete - Whether the page's edit of a key is still incomplete: the function read it as saved
 * @returns The landing; the rows to read first, or those whose edit refuses it ({@link OptimiseUnlanded}); `undefined`
 *   for a patch that does not fit the rows the page holds
 */
export function diffOptimisePatch<K, R>(kind: string, record: DictType<EastType, EastType>, idOf: (key: K) => string, patch: unknown,
    held: (id: string) => option<R> | undefined, incomplete: (id: string) => boolean = () => false): OptimiseDiff<R> | OptimiseUnlanded | undefined {
    const landing = landingOf(record);
    const changes: ScheduleChange[] = [];
    const ops = new Map<string, OptimiseOp<R>>();
    const missing: OptimiseRowRef[] = [];
    const refusing: OptimiseRowRef[] = [];
    let added = 0, changed = 0, removed = 0;
    let touched: ReadonlyMap<K, OptimiseChange<R>>;
    try { touched = landing.changesOf(patch) as ReadonlyMap<K, OptimiseChange<R>>; } catch { return undefined; }
    for (const [key, change] of touched) {
        const id = idOf(key);
        if (incomplete(id)) { refusing.push({ kind, id }); continue; }
        const was = held(id);
        let row: R;
        if (change.type === "delete") {
            if (was === undefined) { missing.push({ kind, id }); continue; }
            // A key no row stands under: gone already, by the page's own edit or another's save.
            if (was.type === "none") continue;
            changes.push({ kind, id, remove: true, was: landing.encode(was.value) });
            ops.set(opKey(kind, id), { kind, id, op: "del", previous: was.value });
            removed++;
            continue;
        }
        if (change.type === "insert") {
            row = change.value;
            // The key is the optimiser's (rule 7): where the page holds no row under it, the row is added — one another
            // save has taken by the time this is saved is a conflict to choose, as for any key an app's function makes.
            if (was === undefined || was.type === "none") {
                changes.push({ kind, id, row: landing.encode(row), created: true });
                ops.set(opKey(kind, id), { kind, id, op: "add", row });
                added++;
                continue;
            }
        } else {
            if (was === undefined) { missing.push({ kind, id }); continue; }
            // An update of a key no row stands under, or a patch made against another row than the page holds, does not
            // fit: the answer is of another state.
            if (was.type === "none") return undefined;
            try { row = landing.patchRow(was.value, change.value) as R; } catch { return undefined; }
        }
        if (landing.same(was.value, row)) continue;
        // The row it landed on goes with the change: what the step begins from where the session holds none of it.
        changes.push({ kind, id, row: landing.encode(row), was: landing.encode(was.value) });
        ops.set(opKey(kind, id), { kind, id, op: "chg", row, previous: was.value });
        changed++;
    }
    if (refusing.length > 0) return { incomplete: refusing };
    if (missing.length > 0) return { missing };
    return { changes, ops, counts: { added, changed, removed } };
}

/**
 * Whether a landing was made, or what keeps it from landing.
 *
 * @param landed - What {@link diffOptimisePatch} answered
 * @returns Whether it is the landing
 */
export function isOptimiseDiff<R>(landed: OptimiseDiff<R> | OptimiseUnlanded | undefined): landed is OptimiseDiff<R> {
    return landed !== undefined && "changes" in landed;
}

/** One record's answer: the kind's slot or the record's key its changes name, the record's type, and the answer's patch of it. */
export interface OptimiseRecordPatch {
    readonly kind: string;
    readonly record: DictType<EastType, EastType>;
    readonly patch: unknown;
}

/**
 * Each record's answer landed on the rows the page holds ({@link diffOptimisePatch}), all or none, on a builder none of
 * whose drafts is half made — a schedule builder's, every draft a whole row — so no edit of the page's refuses an answer:
 * a row any record's answer touches that the page does not hold keeps every record's from landing until it is read.
 *
 * @typeParam R - The records' row
 * @param answers - Each record's patch, in the builder's order
 * @param held - The row the page holds under a kind's key ({@link diffOptimisePatch})
 * @returns Each record's landing, in order; the rows to read first; `undefined` for an answer that does not fit the rows
 *   the page holds
 */
export function landOptimisePatches<R>(answers: readonly OptimiseRecordPatch[], held: (kind: string, id: string) => option<R> | undefined,
): readonly OptimiseDiff<R>[] | OptimiseMissing | undefined {
    const diffs: OptimiseDiff<R>[] = [];
    const missing: OptimiseRowRef[] = [];
    for (const { kind, record, patch } of answers) {
        const landed = diffOptimisePatch<unknown, R>(kind, record, optimiseIdOf(record.key as EastType), patch, (id) => held(kind, id));
        if (landed === undefined) return undefined;
        if ("missing" in landed) missing.push(...landed.missing);
        else if (isOptimiseDiff(landed)) diffs.push(landed);
    }
    if (missing.length > 0) return { missing };
    return diffs;
}

/**
 * What a builder's landing of an answer came to (R7, R10): what it counted, and what the runs have left on its rows until
 * Apply — `undefined` from a run that changed nothing, which leaves what earlier runs left as it is.
 *
 * @typeParam O - What the runs leave on the builder's rows
 */
export interface OptimiseLanded<O> {
    readonly counts: OptimiseCounts;
    readonly optimised: O | undefined;
}

/**
 * A builder's landing as its run takes it (`useOptimise`'s `onLanded`; rules 8 and 11, R10): rows to read first and a
 * refusal go as they are, and so does no landing, an answer that does not fit; a landing answers its counts, what it
 * left on the rows kept first where it left anything — a run that changed nothing leaves what earlier runs left.
 *
 * @typeParam O - What the runs leave on the builder's rows
 * @param landed - What the builder's landing answered
 * @param keep - Keeps what the runs have left: the builder's marks of them, and its landing's replay
 * @returns What the run is answered
 */
export function optimiseLandedCounts<O>(landed: OptimiseLanded<O> | OptimiseMissing | OptimiseRefused | undefined,
    keep: (optimised: O) => void): OptimiseCounts | OptimiseMissing | OptimiseRefused | undefined {
    if (landed === undefined || "missing" in landed || "refused" in landed) return landed;
    if (landed.optimised !== undefined) keep(landed.optimised);
    return landed.counts;
}

/**
 * Where a row a run's answer touched stands once its step is recorded (east-workspace#1709, ruling 14), by its key's
 * text as its session names it: another key than the one it had where the step moved it under the key its fields build,
 * as an edit moves a row — a row the answer changed whose key it changed, one it added under a key its fields build
 * another, or one that names such a row by its key and followed it — else the key it had.
 *
 * @param kind - The row's kind's slot, or its record's key
 * @param id - The key's text it had: the one the answer named it by, or what an earlier run left on it is kept under
 * @returns The key's text it stands under now
 */
export type OptimiseUnder = (kind: string, id: string) => string;

/** A step that moved no row: each stands under the key it had. */
const SAME_KEY: OptimiseUnder = (_kind, id) => id;

/**
 * What records a run's changes as one step of a builder's history: its editing's `record`, or its session's.
 *
 * @typeParam C - A change, as the history records it
 */
export interface OptimiseRecorder<C> {
    /**
     * Records the changes as one step.
     *
     * @param changes - The changes
     * @param origin - The step's origin, `optimise`
     * @param label - The step's label — `Elara run #7`
     * @returns Whether the history took the step
     */
    record(changes: readonly C[], origin: "optimise", label: string): boolean;
    /**
     * Why the history took none of the step, where a row's key refused it (east-workspace#1709, ruling 14) — the key a
     * row's fields build is another row's, it failed as it was built, or the rows that name the row cannot follow it —
     * in the words every refused key is said in: asked once a step is refused. `undefined`, as for a recorder that gives
     * none, for a step refused for any other reason.
     */
    readonly refusal?: (() => string | undefined) | undefined;
    /** Where each row stands once the step is recorded ({@link OptimiseUnder}); each under the key it had, unless given. */
    readonly under?: OptimiseUnder | undefined;
}

/**
 * What records a run's step in a builder's shared Schedule editing (east-workspace#1709, ruling 14), as every board
 * records one — the Calendar, the Plan, the Roster and the Allocation: its `record`; why a row's key refused the step,
 * in the words every refused key is said in ({@link keyRefusedText}); and where each row stands once the step is
 * recorded (`ScheduleEditing.under`).
 *
 * @param editing - The builder's shared Schedule editing
 * @returns What records its runs' steps
 */
export function scheduleOptimiseRecorder(editing: Pick<ScheduleEditing, "record" | "keyRefusal" | "under">): OptimiseRecorder<ScheduleChange> {
    return {
        record: editing.record,
        refusal: () => {
            const refused = editing.keyRefusal();
            return refused === undefined ? undefined : keyRefusedText(refused.name, refused.why);
        },
        under: editing.under,
    };
}

/**
 * A run's changes recorded (R10, §12; east-workspace#1622, rule 10): a run that changes nothing records nothing and
 * leaves what earlier runs left as they are; one that changes something is recorded as one step of the builder's
 * history, origin `optimise`, and what the runs leave is made over it, by where each row stands once the step is
 * recorded — an answer is an edit like any other, and a row whose key it changed moves under the key its fields build
 * (east-workspace#1709, ruling 14). A step a row's key refuses lands nothing, and says why.
 *
 * @typeParam C - A change, as the history records it
 * @typeParam O - What the runs leave on the builder's rows
 * @param run - The run's changes, and what it counted
 * @param history - What records the changes as one step
 * @param label - The step's label — `Elara run #7`
 * @param left - What the runs leave, made once the step is recorded, given where each row stands then
 * @returns What the run counted, and what the runs leave — none from a run that changed nothing; the refusal, in the
 *   recorder's words, where a row's key refused the step; `undefined` where the history would not take it for another
 *   reason
 */
export function recordOptimiseRun<C, O>(run: { readonly changes: readonly C[]; readonly counts: OptimiseCounts },
    history: OptimiseRecorder<C>, label: string, left: (under: OptimiseUnder) => O): OptimiseLanded<O> | OptimiseRefused | undefined {
    if (run.changes.length === 0) return { counts: run.counts, optimised: undefined };
    if (!history.record(run.changes, "optimise", label)) {
        const refused = history.refusal?.();
        return refused === undefined ? undefined : { refused };
    }
    return { counts: run.counts, optimised: left(history.under ?? SAME_KEY) };
}

/**
 * A diff's operations told by the entries' places (§9.5): on a builder whose
 * entries have a place against a backlog — the Calendar's and the Plan's
 * canvas — an entry the run gave a place is an add on the canvas, whatever
 * its key did, and one the run took off its place is a remove, its ghost
 * where it stood; an entry moved, or changed in place, stays a change. The
 * session's changes are the diff's own: an entry the request held is
 * rewritten, never created.
 *
 * @typeParam R - The row
 * @param diff - The diff by key
 * @param placed - Whether a row has a place: a scheduled event, a placed job — given the row, its operation's key
 *   ({@link opKey}), and whether it is the row before the run (`was`) or the one it leaves (`now`)
 * @returns The diff, its operations and counts told by place
 */
export function optimisePlacementOps<R>(diff: OptimiseDiff<R>, placed: (row: R, key: string, side: "was" | "now") => boolean): OptimiseDiff<R> {
    const ops = new Map<string, OptimiseOp<R>>();
    let added = 0, changed = 0, removed = 0;
    for (const [key, op] of diff.ops) {
        let told: OptimiseOp<R> = op;
        if (op.op === "chg") {
            const was = placed(op.previous, key, "was"), now = placed(op.row, key, "now");
            if (!was && now) told = { kind: op.kind, id: op.id, op: "add", row: op.row };
            else if (was && !now) told = { kind: op.kind, id: op.id, op: "del", previous: op.previous };
        }
        ops.set(key, told);
        if (told.op === "add") added++; else if (told.op === "chg") changed++; else removed++;
    }
    return { changes: diff.changes, ops, counts: { added, changed, removed } };
}

/**
 * Several kinds' diffs as one: one `record` call across every record the
 * builder writes (R8).
 *
 * @param diffs - Each kind's diff
 * @returns The one diff
 */
export function mergeOptimiseDiffs<R>(diffs: readonly OptimiseDiff<R>[]): OptimiseDiff<R> {
    const changes: ScheduleChange[] = [];
    const ops = new Map<string, OptimiseOp<R>>();
    let added = 0, changed = 0, removed = 0;
    for (const diff of diffs) {
        changes.push(...diff.changes);
        for (const [key, op] of diff.ops) ops.set(key, op);
        added += diff.counts.added; changed += diff.counts.changed; removed += diff.counts.removed;
    }
    return { changes, ops, counts: { added, changed, removed } };
}
