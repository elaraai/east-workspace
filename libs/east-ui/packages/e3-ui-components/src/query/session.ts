/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A query's editing session (#935) — the open query as the shared editing
 * session (#879) holds it, one session per open query, as Studio's is one per
 * open page.
 *
 * - **Entries.** A query is its header — its name, its description, the data
 *   source it starts from, and its jq when it is not steps — and its steps, in
 *   order, each drafted whole (`DraftField(QueryEntry)`), as Studio drafts a
 *   placement. The header's id is `$query`; a step's is its own.
 * - **The snapshot** is the saved query's header and its steps, or a new
 *   query's header alone. A saved query's steps are parsed once per saved
 *   entry and kept, because a parse gives fresh ids: the same entry must give
 *   the same snapshot, render after render.
 * - **Apply** applies the batch to the snapshot, prints the steps as canonical
 *   jq, checks and prepares the program over the root, and commits the query
 *   as one patch through the record's patch write. The entries it applied
 *   become the snapshot of the query it saved, so the session acknowledges its
 *   own request when the record reads back as it wrote it.
 * - **Readiness** is the check's: a problem is an `invalid` issue, an
 *   unfinished slot an `incomplete` one, so Apply waits for both.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, OptionType, SortedMap, StringType, StructType, VariantType, checkJq, compareFor, decodeBeast2For, encodeBeast2For,
    equalFor, none, printJq, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf, type option,
} from "@elaraai/east";
import { Editing, EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { QueryStepType, SavedQueriesType, SavedQueryType, type QueriesHandleType } from "@elaraai/e3-ui/internal";
import type { BatchReadiness, EditIssue, EditSession, EntryVersion, Origin, Placement } from "@elaraai/east-ui-components";
import type { UIStoreInterface } from "@elaraai/east-ui-components";
import { checkSteps, type CheckedSteps } from "./steps/check.js";
import { parseSteps } from "./steps/parse.js";
import { printSteps } from "./steps/print.js";
import type { Step, StepQuery } from "./steps/values.js";
import type { SavedOffer } from "./model/slots.js";
import { problemWords, type QueryWords } from "./model/words.js";
import { prepareQuery, type QueryRoot } from "./one-shot.js";
import type { QueryOpen } from "./open-query.js";
import { queryEast } from "./query-east.js";

// ============================================================================
// Entries
// ============================================================================

/** The header entry's id. */
export const QUERY_HEADER_ID = "$query";

/**
 * A query's header, as its editing session drafts it.
 *
 * @property id - Always {@link QUERY_HEADER_ID}
 * @property name - Its name: its key in the saved queries, once saved
 * @property description - Its description; `none` shows the generated sentence
 * @property source - The data source its steps start from
 * @property jq - The program as jq, when it is not steps — a program that
 *   does not start from a data source; its steps are then empty
 */
export const QueryHeaderType = StructType({
    id: StringType,
    name: StringType,
    description: OptionType(StringType),
    source: StringType,
    jq: OptionType(StringType),
});

/** A query's header. */
export type QueryHeader = ValueTypeOf<typeof QueryHeaderType>;

/**
 * One entry of a query's editing session.
 *
 * @property header - Its header
 * @property step - One of its steps
 */
export const QueryEntryType = VariantType({
    header: QueryHeaderType,
    step: QueryStepType,
});

/** One entry of a query's editing session. */
export type QueryEntry = ValueTypeOf<typeof QueryEntryType>;

/** A query's entries: its header, then its steps. */
const QueryEntriesType = ArrayType(QueryEntryType);

/** The session's entry schema, as its wire names it. */
export const QUERY_ENTRY_TYPE = toEastTypeValue(QueryEntryType);
/** The session's draft schema: each entry drafted whole. */
export const QUERY_DRAFT_TYPE = toEastTypeValue(EditingDraftFieldType(QueryEntryType));

const encodeEntries = encodeBeast2For(QueryEntriesType);
const encodeEntry = encodeBeast2For(QueryEntryType);
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(QueryEntryType));
const savedEqual = equalFor(SavedQueryType);
const headerEqual = equalFor(QueryHeaderType);
const stepEqual = equalFor(QueryStepType);
const stringCompare = compareFor(StringType);

/** The batch Apply hands the session's `onApply`. */
type Batch = ValueTypeOf<ReturnType<typeof Editing.Types.ChangeSet<typeof QueryEntryType>>>;
/** The session's answer to a batch. */
type ApplyResult = ValueTypeOf<typeof Editing.Types.ApplyResult>;
/** A saved query. */
export type SavedQuery = ValueTypeOf<typeof SavedQueryType>;
/** The saved queries record. */
export type SavedQueries = ValueTypeOf<typeof SavedQueriesType>;
/** The bound saved queries record. */
export type QueriesHandle = ValueTypeOf<typeof QueriesHandleType>;

/**
 * The id an entry has in the session.
 *
 * @param entry - The entry
 * @returns Its id: `$query` for the header, a step's own
 */
export function entryId(entry: QueryEntry): string {
    return entry.type === "header" ? entry.value.id : entry.value.value.id;
}

/**
 * A query as entries: its header, then its steps.
 *
 * @param header - Its header
 * @param steps - Its steps, in order
 * @returns The entries
 */
export function queryEntries(header: QueryHeader, steps: readonly Step[]): QueryEntry[] {
    return [variant("header", header), ...steps.map((step): QueryEntry => variant("step", step))];
}

/**
 * The query a session's entries make.
 *
 * @param entries - The entries
 * @returns The header, and the steps as a query on its data source
 * @throws {Error} When the entries hold no header
 */
export function entriesQuery(entries: readonly QueryEntry[]): { header: QueryHeader; query: StepQuery } {
    let header: QueryHeader | undefined;
    const steps: Step[] = [];
    for (const entry of entries) {
        if (entry.type === "header") header = entry.value;
        else steps.push(entry.value);
    }
    if (header === undefined) throw new Error("A query's entries hold its header");
    return { header, query: { source: header.source, steps } };
}

/**
 * The program a query's entries make: its jq when it is not steps, else its
 * steps printed as canonical jq.
 *
 * @param header - Its header
 * @param query - Its steps
 * @param root - The root's type
 * @returns The program's text
 */
export function queryProgram(header: QueryHeader, query: StepQuery, root: EastType): string {
    return header.jq.type === "some" ? header.jq.value : printSteps(query, root).text;
}

// ============================================================================
// The snapshot a session begins from
// ============================================================================

/**
 * What a query's session begins from: the saved entry, and its entries.
 *
 * @property saved - The saved query the entries are of; `undefined` for a query never saved
 * @property entries - The header and the steps
 */
export interface QueryBase {
    readonly saved: SavedQuery | undefined;
    readonly entries: readonly QueryEntry[];
}

/** Each session's base, by its source id, per UI store: the snapshot it was given last. */
const bases = new WeakMap<UIStoreInterface, Map<string, QueryBase>>();

/** Each session's committed save, by its source id, per UI store, until the record reads it back. */
const saves = new WeakMap<UIStoreInterface, Map<string, QueryBase>>();

/** One UI store's map of the two. */
function mapOf(maps: WeakMap<UIStoreInterface, Map<string, QueryBase>>, store: UIStoreInterface): Map<string, QueryBase> {
    let map = maps.get(store);
    if (map === undefined) {
        map = new Map();
        maps.set(store, map);
    }
    return map;
}

/**
 * A saved query's entries: its header, and its steps parsed from its
 * program — or, for a program that is not steps, its jq.
 *
 * @param saved - The saved query
 * @param root - The root's type
 * @returns The entries; the steps' ids are fresh
 */
export function savedEntries(saved: SavedQuery, root: EastType): QueryEntry[] {
    const text = printJq(saved.query.value.program, { layout: "pipeline" }).text;
    const parsed = parseSteps(text, root);
    if ("error" in parsed) {
        return queryEntries({ id: QUERY_HEADER_ID, name: saved.name, description: saved.description, source: "", jq: some(text) }, []);
    }
    return queryEntries({ id: QUERY_HEADER_ID, name: saved.name, description: saved.description, source: parsed.query.source, jq: none }, parsed.query.steps);
}

/**
 * The base the open query's session begins from: a save it committed; else
 * the base it was given last, while the record still holds the entry it is
 * of; else the saved query's entries, parsed once; else a new query's header
 * alone.
 *
 * @remarks
 * A save the session committed is its base from the moment it commits, while
 * the record has not read it back yet — the session acknowledges its own
 * request by it, whichever comes first, its answer or the record's re-read —
 * and its base for good once the record holds it. A record that holds another
 * entry under its name has moved on since: the record's entry is the base
 * again.
 *
 * @param store - The UI store the sessions live in
 * @param sourceId - The open query's session's source id
 * @param open - The open query
 * @param record - The saved queries
 * @param root - The root's type
 * @param untitled - A new query's name on a data source
 * @returns The base, or `undefined` when the open saved query is not in the record
 */
export function queryBase(
    store: UIStoreInterface, sourceId: string, open: QueryOpen, record: SavedQueries, root: EastType, untitled: (source: string) => string,
): QueryBase | undefined {
    const known = mapOf(bases, store);
    const saving = mapOf(saves, store);
    const save = saving.get(sourceId);
    if (save?.saved !== undefined) {
        const now = record.get(save.saved.name);
        if (now !== undefined && savedEqual(now, save.saved)) {
            known.set(sourceId, save);
            saving.delete(sourceId);
            return save;
        }
        // Not read back yet: the record holds nothing under its name, or the entry the edit began from.
        const began = known.get(sourceId)?.saved;
        if (now === undefined || (began !== undefined && savedEqual(now, began))) return save;
        saving.delete(sourceId);
    }
    const last = known.get(sourceId);
    // The base it was given last, while the record holds its entry as it was —
    // after a save, under the name it saved, which a rename moves.
    if (last?.saved !== undefined) {
        const now = record.get(last.saved.name);
        if (now !== undefined && savedEqual(now, last.saved)) return last;
    }
    if (open.type === "new") {
        if (last !== undefined && last.saved === undefined) return last;
        const base: QueryBase = {
            saved: undefined,
            entries: queryEntries({ id: QUERY_HEADER_ID, name: untitled(open.value.source), description: none, source: open.value.source, jq: none }, []),
        };
        known.set(sourceId, base);
        return base;
    }
    const saved = record.get(open.value);
    if (saved === undefined) return undefined;
    const base: QueryBase = { saved, entries: savedEntries(saved, root) };
    known.set(sourceId, base);
    return base;
}

/**
 * Remembers a save a session's Apply committed, as the base it continues
 * from: the saved entry it wrote, and the entries it applied — for the session
 * that applied them, and for the saved query's own, which a new query and a
 * rename open next ({@link queryBase}).
 *
 * @param store - The UI store the sessions live in
 * @param sourceIds - The source ids to remember it under
 * @param base - The saved entry and the entries
 */
export function rememberSave(store: UIStoreInterface, sourceIds: readonly string[], base: QueryBase): void {
    const saving = mapOf(saves, store);
    for (const id of sourceIds) saving.set(id, base);
}

/**
 * The snapshot a base is, as the session's wire carries it.
 *
 * @param base - The base
 * @returns Its entries, encoded
 */
export function encodeBase(base: QueryBase): Uint8Array {
    return encodeEntries([...base.entries]);
}

/**
 * One entry of a base, by id, as the session's wire carries it.
 *
 * @param base - The base
 * @param id - The entry's id
 * @returns The entry, encoded, or `none` when the base has no entry of that id
 */
export function readBaseEntry(base: QueryBase, id: string): option<Uint8Array> {
    const entry = base.entries.find(e => stringCompare(entryId(e), id) === 0);
    return entry === undefined ? none : some(encodeEntry(entry));
}

/**
 * The saved queries a builder offers to start from, as the add-step list of a
 * query with no steps offers them (#934): each whose data sources are all
 * bound here, by the same name and at the same path (`QueryInternal.rootBound`),
 * with the data source its steps start from.
 *
 * @param record - The saved queries
 * @param root - The root the builder's data sources make
 * @returns The offers, in name order
 */
export function savedOffers(record: SavedQueries, root: QueryRoot): SavedOffer[] {
    const east = queryEast();
    const bound = root.entries.map(e => ({ name: e.name, path: e.path }));
    const offers: SavedOffer[] = [];
    for (const saved of record.values()) {
        if (east.rootBound(saved, bound).type !== "bound") continue;
        const { header } = entriesQuery(savedEntries(saved, root.type));
        if (header.jq.type === "some") continue;
        offers.push({ name: saved.name, source: header.source });
    }
    return offers;
}

// ============================================================================
// Readiness: the check's problems as the session's issues
// ============================================================================

/**
 * The query's problems as the session's readiness: each error an `invalid`
 * issue, each unfinished slot an `incomplete` one, in plain words, on the step
 * and the slot they are about.
 *
 * @param header - The query's header
 * @param query - Its steps
 * @param root - The root, or a reason it cannot be queried
 * @param words - The words
 * @returns The readiness, and the check it was made from
 */
export function queryReadiness(
    header: QueryHeader, query: StepQuery, root: QueryRoot | string, words: QueryWords,
): { readiness: BatchReadiness; checked: CheckedSteps | undefined } {
    const issue = (entry: string, message: string, slot?: string): EditIssue =>
        ({ entry, row: none, field: slot === undefined ? none : some(slot), message });
    if (typeof root === "string") return { readiness: variant("invalid", [issue(QUERY_HEADER_ID, root)]), checked: undefined };
    if (header.jq.type === "some") {
        const errors = checkJq(header.jq.value, root.type, { root: true }).diagnostics.filter(d => d.severity.type === "error");
        return {
            readiness: errors.length === 0 ? variant("ready", null) : variant("invalid", errors.map(d => issue(QUERY_HEADER_ID, d.message))),
            checked: undefined,
        };
    }
    const checked = checkSteps(query, root.type);
    const issues: EditIssue[] = [];
    let invalid = false;
    for (const d of checked.diagnostics) {
        const unfinished = d.code === "incomplete";
        if (!unfinished && d.severity !== "error") continue;
        invalid ||= !unfinished;
        issues.push(issue(d.stepId === "" ? QUERY_HEADER_ID : d.stepId, problemWords(d, query, root.type, checked, words).text, d.slot));
    }
    return { readiness: issues.length === 0 ? variant("ready", null) : variant(invalid ? "invalid" : "incomplete", issues), checked };
}

// ============================================================================
// Apply: the batch as one patch commit
// ============================================================================

/** What a query's Apply needs. */
export interface QueryApplyContext {
    /** The saved queries record, bound with its patch. */
    readonly handle: QueriesHandle;
    /** The open query. */
    readonly open: QueryOpen;
    /** The base its session began from. */
    readonly base: QueryBase;
    /** The root. */
    readonly root: QueryRoot;
    /** The UI store the sessions live in. */
    readonly store: UIStoreInterface;
    /** The session's own source id. */
    readonly sourceId: string;
    /** The source id a query of a name has. */
    readonly sourceIdOf: (name: string) => string;
    /** What a refused write says, in the builder's words. */
    readonly refused: (outcome: "changed" | "renamed", name: string, by: string | undefined) => string;
    /** Told the name a commit saved the query under, once its save is remembered: the base is the save's from then on. */
    readonly onSaved: (name: string) => void;
    /** The clock a save is stamped with. */
    readonly now?: () => Date;
}

const applyEntries = Editing.apply(QueryEntryType, "id");

/**
 * A query's `onApply`: the batch applied to the base, the program printed,
 * checked and prepared over the root, and the query committed as one patch.
 *
 * @param ctx - The record, the open query, its base and root, and the words
 * @returns The session's async apply, over the batch's bytes
 */
export function queryApply(ctx: QueryApplyContext): (bytes: Uint8Array) => Promise<ApplyResult> {
    const apply = compiledApply();
    const east = queryEast();
    return async (bytes) => {
        const batch: Batch = decodeBatch(bytes);
        const base = batch.base.type === "snapshot" ? batch.base.value : [...ctx.base.entries];
        const applied = apply(base, batch, none);
        if (applied.type === "conflict") return variant("conflict", applied.value);
        const { header, query } = entriesQuery(applied.value);
        const program = queryProgram(header, query, ctx.root.type);
        const prepared = prepareQuery(program, ctx.root);
        if ("result" in prepared) {
            const outcome = prepared.result.outcome;
            const messages = outcome.type === "error" ? outcome.value.map(e => e.message) : [outcome.type];
            return variant("rejected", messages.map(message => ({ entry: QUERY_HEADER_ID, row: none, field: none, message })));
        }
        const reads = new Set(prepared.prepared.checked.reads);
        const next: SavedQuery = {
            name: header.name,
            description: header.description,
            query: prepared.prepared.query,
            root: ctx.root.entries.filter(e => reads.has(e.name)).map(e => ({ name: e.name, path: e.path })),
            saved_at: (ctx.now ?? (() => new Date()))(),
        };
        // The record as the edit began: the open query's entry as its session's base holds it.
        const began: SavedQueries = new SortedMap(ctx.base.saved === undefined ? [] : [[ctx.base.saved.name, ctx.base.saved]], stringCompare);
        const open = ctx.base.saved === undefined ? none : some(ctx.base.saved.name);
        const patch = east.save(began, open, next);
        const outcome = await ctx.handle.commit.patch(batch.requestId, patch);
        switch (outcome.type) {
            case "committed": {
                rememberSave(ctx.store, [ctx.sourceId, ctx.sourceIdOf(next.name)], { saved: next, entries: applied.value });
                ctx.onSaved(next.name);
                return variant("applied", { revision: some(outcome.value.stateHash) });
            }
            case "conflict": {
                const renamed = open.type === "none" || stringCompare(open.value, next.name) !== 0;
                const by = latestActor(ctx.handle);
                return variant("conflict", [{ entry: QUERY_HEADER_ID, row: none, field: none, message: ctx.refused(renamed ? "renamed" : "changed", next.name, by) }]);
            }
            case "transport":
                // It may have committed: the session keeps the request, and its
                // retry sends the same id, which resolves to that commit.
                throw new Error(outcome.value.message);
            default: {
                const refusal = east.nameWriteRefusal(outcome, next.name);
                return variant("rejected", [{ entry: QUERY_HEADER_ID, row: none, field: none, message: refusal.type === "some" ? refusal.value : outcome.type }]);
            }
        }
    };
}

/** `Editing.apply` over a query's entries, as it compiles. */
type ApplyEntries = (base: QueryEntry[], batch: Batch, revision: option<string>) => ValueTypeOf<ReturnType<typeof Editing.Types.Applied<typeof QueryEntryType>>>;

let compiledEntries: ApplyEntries | undefined;

/** `Editing.apply` over a query's entries, compiled on first use. */
function compiledApply(): ApplyEntries {
    compiledEntries ??= East.compile(applyEntries, []) as unknown as ApplyEntries;
    return compiledEntries;
}

/** The actor who changed the record last, when its history is in. */
function latestActor(handle: QueriesHandle): string | undefined {
    const history = handle.history();
    if (history.type !== "some") return undefined;
    const head = history.value[0];
    return head === undefined ? undefined : head.actor;
}

// ============================================================================
// Gestures: one transaction per gesture
// ============================================================================

/** An entry's placement among the drafted entries: before its next, else after its previous. */
function placementIn(entries: readonly QueryEntry[], index: number): Placement {
    const next = entries[index + 1];
    const previous = entries[index - 1];
    if (next !== undefined) return some(variant("ordered", variant("before", entryId(next))));
    if (previous !== undefined) return some(variant("ordered", variant("after", entryId(previous))));
    return some(variant("ordered", variant("start", null)));
}

/**
 * The entries a gesture moved: those outside the longest run of entries that
 * kept their order, so a move places the entry moved, not its neighbours.
 */
function movedIn(before: readonly string[], after: readonly string[]): Set<string> {
    const common = after.filter(id => before.includes(id));
    const at = common.map(id => before.indexOf(id));
    const length = at.map(() => 1);
    const previous = at.map(() => -1);
    for (let i = 0; i < at.length; i++) {
        for (let j = 0; j < i; j++) {
            if (at[j]! < at[i]! && length[j]! + 1 > length[i]!) {
                length[i] = length[j]! + 1;
                previous[i] = j;
            }
        }
    }
    let best = -1;
    for (let i = 0; i < at.length; i++) if (best < 0 || length[i]! > length[best]!) best = i;
    const kept = new Set<string>();
    for (let i = best; i >= 0; i = previous[i]!) kept.add(common[i]!);
    return new Set(common.filter(id => !kept.has(id)));
}

/**
 * Records one gesture: the query as it was and as the gesture leaves it, as
 * one undoable transaction of every entry it changed, added, removed or moved.
 *
 * @param session - The open query's session
 * @param original - An entry's version before any draft of it
 * @param current - The entries as the drafts stand
 * @param next - The entries after the gesture
 * @param origin - The gesture
 * @param label - Its label in the history
 * @returns Whether anything changed
 */
export function recordGesture(
    session: EditSession<QueryEntry>,
    original: (id: string) => EntryVersion<QueryEntry>,
    current: readonly QueryEntry[],
    next: readonly QueryEntry[],
    origin: Origin,
    label: string,
): boolean {
    const was = new Map(current.map((e, i) => [entryId(e), { entry: e, index: i }]));
    const now = new Map(next.map((e, i) => [entryId(e), { entry: e, index: i }]));
    const moved = movedIn(current.map(entryId), next.map(entryId));
    const versionOf = (id: string): EntryVersion<QueryEntry> => session.entries.get(id) ?? original(id);
    const updates: { id: string; before: EntryVersion<QueryEntry>; after: EntryVersion<QueryEntry> }[] = [];
    for (const [id, { entry, index }] of now) {
        const old = was.get(id);
        const before = old === undefined ? { draft: undefined, wire: undefined, place: none } : versionOf(id);
        const placed = old === undefined || moved.has(id);
        const changed = old === undefined || !sameEntry(old.entry, entry);
        if (!changed && !placed) continue;
        updates.push({ id, before, after: { draft: variant("value", entry), wire: entry, place: placed ? placementIn(next, index) : before.place } });
    }
    for (const [id] of was) {
        if (now.has(id)) continue;
        updates.push({ id, before: versionOf(id), after: { draft: undefined, wire: undefined, place: none } });
    }
    return updates.length > 0 && session.record(updates, origin, label);
}

/** Whether two entries are the same value. */
function sameEntry(a: QueryEntry, b: QueryEntry): boolean {
    if (a.type === "header" && b.type === "header") return headerEqual(a.value, b.value);
    if (a.type === "step" && b.type === "step") return stepEqual(a.value, b.value);
    return false;
}
