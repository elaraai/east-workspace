/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's editing session (#880) — the session every editable collection
 * shares (`useEditSession`, #879), over the canvas's top-level ENTRIES.
 *
 * A gesture on a row — a verdict, a card dropped on it — drafts the entry the
 * row came from, whole: the canvas hands the entry and the gesture to the
 * series that made the row (`editing.write`), which writes the field it
 * declares, and the session records the entry before and after as one
 * undoable transaction. Approve all / Reject all is one gesture over every row
 * the canvas holds that takes a verdict — on a paged canvas, the loaded rows.
 *
 * The canvas draws the drafted entries by deriving their rows again, so a
 * draft looks exactly as the applied batch will: inline, the whole canvas with
 * the drafts in their entries' place (`editing.derive`); paged, a source whose
 * windows are derived with the drafts in them — ONE wrapper per source (a host
 * function is equivalent only to itself, so a new wrapper would drop the
 * driver's windows) that reads the latest drafts through a ref and names a new
 * revision per drafts version, which the paging driver reads as its snapshot
 * moving: it keeps the rows it has as stand-ins until the drafted windows land
 * (#821). A drafted row that differs from its entry's rows as the source holds
 * them carries the Sheet's marks — pending, and incomplete or invalid while a
 * check refuses its entry.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import {
    NullType, decodeBeast2For, encodeBeast2For, equalFor, equivalentFor, none, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { EditingReadinessType, Plan } from "@elaraai/east-ui/internal";
import { useEditSession, type EditSource, type EditingValue } from "../../editing/use-edit-session.js";
import type { EditIssue, EditSession, EditSessionBinding, EntryUpdate, EntryVersion, Origin } from "../../editing/session.js";
import { kindOfIssue, raiseIssue, type BatchReadiness } from "../../editing/draft.js";
import type { HistoryAction } from "../../editing/HistoryBar.js";
import type { DragEventValue } from "../../dnd/drag-layer";
import { fromPlanSlot } from "./slot.js";
import { PLAN_PAGE_SIZE, type PlanPagedSourceValue } from "./use-plan-paging.js";
import { rowIdOfKey, rowKeyOf, type PlanRootValue, type PlanRowId, type PlanRowValue, type PlanWireBlock } from "./model.js";
import type { RowKey } from "./plan-state.js";

/** The decoded Plan editing declaration (the root's `editing` some-value). */
export type PlanEditingValue = ValueTypeOf<typeof Plan.Types.Editing>;
/** A gesture — what a draft is made by. */
type PlanGesture = ValueTypeOf<typeof Plan.Types.Gesture>;
/** One entry's readiness, as the author's check answers it. */
type Readiness = ValueTypeOf<typeof EditingReadinessType>;

/** One entry as the session holds it — its id. What it draws is derived when a mark needs it. */
export interface PlanEntryRef {
    /** The entry's id — its key's text, the first segment of its rows' paths. */
    readonly id: string;
}

/** A drafted row's mark — the Sheet's (#879). */
export type PlanDraftMark = "pending" | "incomplete" | "invalid";

/** A verdict a gesture drafts. */
export type PlanDraftVerdict = "approved" | "rejected";

/** What {@link usePlanEditing} hands the canvas. */
export interface PlanEditing {
    /** Whether the root declares editing at all. */
    enabled: boolean;
    /** The session — the history bar reads it. */
    session: EditSession<PlanEntryRef>;
    /** Whether a gesture can be drafted now: a base observed, the session writable. */
    available: boolean;
    /** The session's version — moves with every change to it. */
    version: number;
    /** The root with the drafted entries in place — what the canvas draws. */
    value: PlanRootValue;
    /** Its data-stable twin: a new identity only when the data or the drafts moved. */
    data: PlanRootValue;
    /** Moves when the drafted entries do — a paged canvas reads its windows again then. */
    draftsVersion: number;
    /** Each drafted row's mark, by row key. */
    marks: ReadonlyMap<RowKey, PlanDraftMark>;
    /** Draft a verdict on one row, by key. Stable. */
    verdict(key: RowKey, verdict: PlanDraftVerdict): void;
    /** Draft a verdict on every one of `rows` that takes one — one gesture. Stable. */
    verdictAll(verdict: PlanDraftVerdict, rows: readonly PlanRowValue[]): void;
    /** A card dropped on a row — drafted into its entry. Stable. */
    drop(event: DragEventValue): void;
    /** A history bar action. Stable. */
    action(action: HistoryAction): void;
}

/** What {@link usePlanEditing} reads. */
export interface PlanEditingArgs {
    /** The latest root, as the host gave it. */
    value: PlanRootValue;
    /** Its data-stable twin. */
    data: PlanRootValue;
    /** The canvas rows the source holds — inline, every row; paged, the resident windows'. */
    rows: readonly PlanRowValue[];
    /** Which window each paged row came from. */
    origin: ReadonlyMap<RowKey, { w: number }>;
    /** The view's key. */
    storageKey: string;
    /** A row's name, for a transaction's label — its gutter label. */
    labelOf: (key: RowKey) => string;
}

/** A canvas without editing still runs the hook — against a session nothing ever reaches. */
const INERT: EditingValue = {
    sourceId: "plan:no-editing", entryType: toEastTypeValue(NullType), idField: none,
    draftType: toEastTypeValue(NullType), children: none, keyType: none, snapshot: none,
    readEntry: () => none, onPatch: none, onApply: none, mode: variant("batch", null),
};

/** Whether two paged sources derive the same rows — the paging driver's test (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);
const rowEqual = equalFor(Plan.Types.Row);
const NO_MARKS: ReadonlyMap<RowKey, PlanDraftMark> = new Map();
const NO_DRAFTS: ReadonlyMap<string, Uint8Array> = new Map();
const READY: BatchReadiness = variant("ready", null);

/** What an author's check that refused without a word says — canonical English, carried to the host. */
const AUTHOR_TEXT = {
    incomplete: "This entry is not ready yet",
    invalid: "This entry is invalid",
    failed: (message: string) => `Readiness check failed: ${message}`,
} as const;

/** The entry a row came from — the first segment of its id's path; none for a top-level section's header. */
export function entryOf(id: PlanRowId): string | undefined {
    return id.value.path[0];
}

const idOfRef = (ref: PlanEntryRef): string => ref.id;

/** Two drafted-entry maps hold the same bytes. */
function sameDrafts(a: ReadonlyMap<string, Uint8Array>, b: ReadonlyMap<string, Uint8Array>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, bytes] of b) {
        const held = a.get(id);
        if (held === undefined || held.length !== bytes.length) return false;
        for (let i = 0; i < bytes.length; i++) if (held[i] !== bytes[i]) return false;
    }
    return true;
}

/** An entry version's value — a Plan draft is always a whole entry. */
function entryValueOf(version: EntryVersion<PlanEntryRef> | undefined): { value: unknown } | undefined {
    const draft = version?.draft as { type: string; value: unknown } | undefined;
    return draft?.type === "value" ? { value: draft.value } : undefined;
}

/**
 * The Plan's editing session and gestures, and the canvas with its drafts.
 *
 * @param args - The root, its rows as the source holds them, and the view
 * @returns The session, the drafted canvas, its marks and the gestures
 */
export function usePlanEditing(args: PlanEditingArgs): PlanEditing {
    const { value, data, rows, origin, storageKey } = args;
    const editing = value.editing.type === "some" ? value.editing.value : undefined;
    const paged = value.rows.type === "paged" ? value.rows.value : undefined;
    const entryTypeValue = editing?.entryType;
    const codec = useMemo(() => (entryTypeValue === undefined ? undefined : {
        encode: encodeBeast2For(entryTypeValue),
        decode: decodeBeast2For(entryTypeValue),
        equal: equalFor(entryTypeValue),
    }), [entryTypeValue]);

    // ── The resident entries ─────────────────────────────────────────────
    // Every entry a canvas row came from, in order. A paged entry's position
    // is its element index — its window's start and its place among the
    // window's ids — which is where a reconcile reads it after an Apply; the
    // entry itself is read back from the very window the canvas paged it in.
    const resident = useMemo(() => {
        const ids: string[] = [];
        const windowOf = new Map<string, number>();
        for (const row of rows) {
            const id = entryOf(row.id);
            if (id === undefined || windowOf.has(id)) continue;
            windowOf.set(id, origin.get(row.key)?.w ?? 0);
            ids.push(id);
        }
        if (editing === undefined || paged === undefined) {
            return { refs: ids.map((id): PlanEntryRef => ({ id })), positions: ids.map(() => 0) };
        }
        const placeIn = new Map<number, ReadonlyMap<string, number>>();
        const positionOf = (id: string): number => {
            const w = windowOf.get(id) ?? 0;
            let at = placeIn.get(w);
            if (at === undefined) {
                let read: ReturnType<PlanEditingValue["entryIds"]> = none;
                try { read = editing.entryIds(BigInt(w * PLAN_PAGE_SIZE), BigInt(PLAN_PAGE_SIZE)); }
                catch (err) { console.error("[Plan] a window's entries could not be read:", err); }
                at = new Map(read.type === "some" ? read.value.map((x, i) => [x, i] as const) : []);
                placeIn.set(w, at);
            }
            return w * PLAN_PAGE_SIZE + (at.get(id) ?? 0);
        };
        return { refs: ids.map((id): PlanEntryRef => ({ id })), positions: ids.map(positionOf) };
    }, [rows, origin, editing, paged]);

    // ── The author's check, over the entries a draft changed ─────────────
    const sessionRef = useRef<EditSession<PlanEntryRef> | undefined>(undefined);
    const ready = useMemo<EditSessionBinding<PlanEntryRef>["ready"]>(() => {
        const check = editing?.ready.type === "some" ? editing.ready.value : undefined;
        if (check === undefined || codec === undefined) return undefined;
        return (entries) => {
            const originals = sessionRef.current?.originals;
            const batch: { id: string; entry: Uint8Array }[] = [];
            for (const [id, entry] of entries) {
                const now = entryValueOf(entry);
                if (now === undefined) continue;
                // An entry a draft left as the source holds it is the source's to check.
                const was = entryValueOf(originals?.get(id));
                if (was !== undefined && codec.equal(was.value, now.value)) continue;
                batch.push({ id, entry: codec.encode(now.value) });
            }
            if (batch.length === 0) return READY;
            let results: readonly Readiness[];
            try { results = check(batch); }
            catch (err) {
                const failed: Readiness = variant("invalid", [{ field: "", message: AUTHOR_TEXT.failed(err instanceof Error ? err.message : String(err)) }]);
                results = batch.map(() => failed);
            }
            const issues: EditIssue[] = [];
            let invalid = false;
            // Each issue raised with its entry's own kind: the batch holds them
            // all under one, and an entry is marked for its own.
            results.forEach((result, i) => {
                if (result.type === "ready") return;
                invalid ||= result.type === "invalid";
                const entry = batch[i]!.id;
                if (result.value.length === 0) issues.push(raiseIssue(result.type, { entry, row: none, field: none, message: AUTHOR_TEXT[result.type] }));
                for (const issue of result.value) {
                    issues.push(raiseIssue(result.type, { entry, row: none, field: issue.field === "" ? none : some(issue.field), message: issue.message }));
                }
            });
            return issues.length > 0 ? variant(invalid ? "invalid" : "incomplete", issues) : READY;
        };
    }, [editing, codec]);

    // ── The paged source a reconcile reads ───────────────────────────────
    const source = useMemo<EditSource<PlanEntryRef> | undefined>(() => {
        if (editing === undefined || paged === undefined) return undefined;
        return {
            page: (offset, count) => {
                const ids = editing.entryIds(offset, count);
                return ids.type === "some" ? some(ids.value.map((id): PlanEntryRef => ({ id }))) : none;
            },
            revision: () => paged.revision(),
            refresh: (revision) => paged.refresh(revision),
            seek: paged.seek,
        };
    }, [editing, paged]);

    const { session, observed, original, available, version } = useEditSession<PlanEntryRef>(
        editing ?? INERT, source, resident.refs, resident.positions, storageKey, { idOf: idOfRef, ready });
    sessionRef.current = session;

    // ── The drafted entries ──────────────────────────────────────────────
    // Only the entries a draft changed: an entry undone to the source's own
    // is the source's again, and draws from it.
    const fresh = useMemo(() => {
        if (editing === undefined || codec === undefined) return NO_DRAFTS;
        const out = new Map<string, Uint8Array>();
        for (const [id, entry] of session.entries) {
            const now = entryValueOf(entry);
            if (now === undefined) continue;
            const was = entryValueOf(session.originals.get(id));
            if (was !== undefined && codec.equal(was.value, now.value)) continue;
            out.set(id, codec.encode(now.value));
        }
        return out;
        // The session's maps are mutable; its version records each change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, codec, session, version]);
    // Held while the bytes hold: a status change moves the version, not the drafts.
    const held = useRef<{ drafts: ReadonlyMap<string, Uint8Array>; version: number }>({ drafts: NO_DRAFTS, version: 0 });
    const drafts = useMemo(() => {
        const previous = held.current;
        if (sameDrafts(previous.drafts, fresh)) return previous;
        const next = { drafts: fresh, version: previous.version + 1 };
        held.current = next;
        return next;
    }, [fresh]);

    // ── The canvas with the drafts in place ──────────────────────────────
    // Inline: the whole canvas derived with the drafts in their entries' place.
    const inlineBlocks = useMemo((): readonly PlanWireBlock[] | undefined => {
        if (editing === undefined || data.rows.type !== "inline" || drafts.drafts.size === 0) return undefined;
        try {
            const out = editing.derive(0n, 0n, new Map(drafts.drafts));
            return out.type === "some" ? out.value : undefined;
        } catch (err) {
            console.error("[Plan] the drafted canvas could not be derived:", err);
            return undefined;
        }
    }, [editing, data.rows, drafts]);
    // Paged: one wrapper per source, reading the latest source and drafts.
    const latest = useRef({ src: paged, editing, drafts });
    latest.current = { src: paged, editing, drafts };
    const wrapperOf = useRef<{ src: PlanPagedSourceValue; wrapped: PlanPagedSourceValue } | undefined>(undefined);
    const wrapped = useMemo((): PlanPagedSourceValue | undefined => {
        if (paged === undefined || editing === undefined) return undefined;
        const prior = wrapperOf.current;
        if (prior !== undefined && pagedSourceEquivalent(prior.src, paged)) return prior.wrapped;
        const next: PlanPagedSourceValue = {
            id: paged.id,
            page: (offset, limit) => {
                const l = latest.current;
                if (l.src === undefined) return none;
                return l.editing === undefined || l.drafts.drafts.size === 0
                    ? l.src.page(offset, limit)
                    : l.editing.derive(offset, limit, new Map(l.drafts.drafts));
            },
            total: () => latest.current.src?.total() ?? none,
            // A new drafts version is a new revision: the driver reads its
            // windows again, the rows it has standing in until they land.
            revision: () => {
                const l = latest.current;
                const r = l.src?.revision() ?? none;
                if (l.drafts.drafts.size === 0) return r;
                return some(`${r.type === "some" ? r.value : ""}#drafts-${l.drafts.version}`);
            },
            refresh: (revision) => latest.current.src?.refresh(revision) ?? null,
            seek: paged.seek.type === "some"
                ? some((query) => {
                    const s = latest.current.src?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged, editing]);
    const shownData = useMemo((): PlanRootValue => {
        if (inlineBlocks !== undefined) return { ...data, rows: variant("inline", inlineBlocks) as PlanRootValue["rows"] };
        if (wrapped !== undefined) return { ...data, rows: variant("paged", wrapped) as PlanRootValue["rows"] };
        return data;
    }, [data, inlineBlocks, wrapped]);
    const shownValue = useMemo((): PlanRootValue => {
        if (inlineBlocks !== undefined) return { ...value, rows: variant("inline", inlineBlocks) as PlanRootValue["rows"] };
        if (wrapped !== undefined) return { ...value, rows: variant("paged", wrapped) as PlanRootValue["rows"] };
        return value;
    }, [value, inlineBlocks, wrapped]);

    // ── The marks ────────────────────────────────────────────────────────
    // A row of a drafted entry that the draft added or changed: its entry's
    // rows derived from the draft, against the same from the source's entry.
    const marks = useMemo((): ReadonlyMap<RowKey, PlanDraftMark> => {
        if (editing === undefined || codec === undefined || drafts.drafts.size === 0) return NO_MARKS;
        const readiness = session.readiness;
        const out = new Map<RowKey, PlanDraftMark>();
        const rowsOf = (id: string, bytes: Uint8Array): Map<RowKey, ValueTypeOf<typeof Plan.Types.Row>> => {
            const by = new Map<RowKey, ValueTypeOf<typeof Plan.Types.Row>>();
            try {
                for (const block of editing.deriveEntry(id, bytes)) for (const row of block.rows) by.set(rowKeyOf(row.id), row);
            } catch (err) {
                console.error("[Plan] a drafted entry's rows could not be derived:", err);
            }
            return by;
        };
        for (const [id, bytes] of drafts.drafts) {
            const was = entryValueOf(session.originals.get(id));
            const before = was !== undefined ? rowsOf(id, codec.encode(was.value)) : new Map<RowKey, ValueTypeOf<typeof Plan.Types.Row>>();
            // The entry's OWN issues decide its mark — never another entry's.
            const own = readiness.type !== "ready" ? readiness.value.filter((issue) => issue.entry === id) : [];
            const mark: PlanDraftMark = readiness.type === "ready" || own.length === 0 ? "pending"
                : own.some((issue) => kindOfIssue(issue, readiness) === "invalid") ? "invalid" : "incomplete";
            for (const [key, row] of rowsOf(id, bytes)) {
                const prior = before.get(key);
                if (prior !== undefined && rowEqual(prior, row)) continue;
                out.set(key, mark);
            }
        }
        return out;
        // The session's readiness moves under its version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, codec, drafts, session, version]);

    // ── The gestures ─────────────────────────────────────────────────────
    /** Write one gesture into the entries it touches, and record it as one transaction. */
    const record = (requests: readonly { id: string; rows: PlanRowId[] }[], gesture: PlanGesture, origin: Origin, label: string): boolean => {
        if (editing === undefined || codec === undefined || observed === undefined || !session.writable) return false;
        session.observeBase(observed.base);
        const befores: EntryVersion<PlanEntryRef>[] = [];
        const wire: { id: string; entry: Uint8Array; rows: PlanRowId[]; gesture: PlanGesture }[] = [];
        for (const request of requests) {
            let before: EntryVersion<PlanEntryRef>;
            try { before = original(request.id); }
            catch (err) {
                console.error("[Plan] a gesture's entry could not be read:", err);
                continue;
            }
            const now = entryValueOf(before);
            if (now === undefined) continue;
            befores.push(before);
            wire.push({ id: request.id, entry: codec.encode(now.value), rows: request.rows, gesture });
        }
        if (wire.length === 0) return false;
        let written: ReturnType<PlanEditingValue["write"]>;
        try { written = editing.write(wire); }
        catch (err) {
            console.error("[Plan] a gesture could not be written:", err);
            return false;
        }
        const updates: EntryUpdate<PlanEntryRef>[] = [];
        written.forEach((out, i) => {
            if (out.type !== "some") return;
            const before = befores[i]!;
            updates.push({
                id: wire[i]!.id, before,
                after: { draft: variant("value", codec.decode(out.value)), wire: before.wire, place: before.place },
            });
        });
        return updates.length > 0 && session.record(updates, origin, label);
    };
    const gestures = {
        verdict(key: RowKey, verdict: PlanDraftVerdict): void {
            const id = rowIdOfKey(key);
            const entry = id !== undefined ? entryOf(id) : undefined;
            if (id === undefined || entry === undefined) return;
            record([{ id: entry, rows: [id] }], variant("verdict", variant(verdict, null)), "verdict",
                `${verdict === "approved" ? "Approve" : "Reject"} ${args.labelOf(key)}`);
        },
        verdictAll(verdict: PlanDraftVerdict, all: readonly PlanRowValue[]): void {
            // One request per entry, over each of its rows that takes a verdict.
            const byEntry = new Map<string, PlanRowId[]>();
            for (const row of all) {
                if (!row.edits.verdict) continue;
                const entry = entryOf(row.id);
                if (entry === undefined) continue;
                const list = byEntry.get(entry);
                if (list !== undefined) list.push(row.id);
                else byEntry.set(entry, [row.id]);
            }
            record([...byEntry].map(([id, ids]) => ({ id, rows: ids })), variant("verdict", variant(verdict, null)), "verdict",
                verdict === "approved" ? "Approve all" : "Reject all");
        },
        drop(event: DragEventValue): void {
            if (event.type !== "add") return;
            const { from, into, duplicate } = event.value;
            const id = rowIdOfKey(into.row);
            const entry = id !== undefined ? entryOf(id) : undefined;
            const at = fromPlanSlot(value.axis.type, into.slot);
            if (id === undefined || entry === undefined || at === undefined) return;
            record([{ id: entry, rows: [id] }], variant("drop", { from, row: id, at, duplicate }), "drop",
                `Drop ${from.key} on ${args.labelOf(into.row)}`);
        },
        action(action: HistoryAction): void {
            if (action === "apply") void session.apply();
            else if (action === "refresh") session.refresh();
            else session[action]();
        },
    };
    // Stable to the rows and the drag layer: each runs the latest render's.
    const current = useRef(gestures);
    current.current = gestures;
    const verdict = useCallback((key: RowKey, v: PlanDraftVerdict) => current.current.verdict(key, v), []);
    const verdictAll = useCallback((v: PlanDraftVerdict, all: readonly PlanRowValue[]) => current.current.verdictAll(v, all), []);
    const drop = useCallback((event: DragEventValue) => current.current.drop(event), []);
    const action = useCallback((a: HistoryAction) => current.current.action(a), []);

    return {
        enabled: editing !== undefined,
        session,
        available: editing !== undefined && available,
        version,
        value: shownValue,
        data: shownData,
        draftsVersion: drafts.version,
        marks,
        verdict,
        verdictAll,
        drop,
        action,
    };
}
