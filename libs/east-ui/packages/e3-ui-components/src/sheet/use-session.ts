/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows and their editing session: what survives a remount, the state machine's store and its folds, the lens and the
 * pages that draw the rows, each row's cells from data at the day, the session and the optimiser's run over it, the drafts,
 * what a row's drafts changed, and the rows with the local layer applied.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { IntegerType, OptionType, StringType, StructType, equalFor, fromEastTypeValue, isVariant, none, printFor, some } from "@elaraai/east";
import { Sheet, SheetBatchReadinessType } from "@elaraai/e3-ui/internal";
import {
    fieldBreachIssue, fieldBreachText, fieldFormMessages, getSomeorUndefined, useLanding, useLandingStyles, useDataStable, usePersistedState, type BatchReadiness,
    type EditIssue, type EntryKeys,
} from "@elaraai/east-ui-components";
import { kindOfIssue, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { NULL_CELL, drawnPx, isLooseRow, layoutLensRun, layoutRun, type SheetGeometry } from "./model.js";
import { SHEET_PAGE_SIZE, useSheetPaging } from "./paging.js";
import { NOT_PERSISTED, persistedOf, type SheetPersisted } from "./persisted.js";
import { useOptimise, type OptimiseCounts } from "../shared/func/use-optimise.js";
import { sheetOptimiseTypes, type SheetOptimiseRequest, type SheetOptimiseResult, type SheetOptimised } from "./optimise.js";
import type { LensGeometry, LensWords } from "./lens-layout.js";
import { useRecordLens } from "./use-lens.js";
import { initialSheetStore, sheetStoreReducer } from "./sheet-state.js";
import { useSheetEditing, type LocalLayer, type SheetRowsRead } from "./use-editing.js";
import { useCellsFromData } from "./cells-from-data.js";
import { useSheetDay } from "./day.js";
import { draftChanges, draftPresentation, type DraftPresentation } from "./draft-state.js";
import { normalizeDraft } from "./draft-values.js";
import { entryBreaches, sheetBoundsOf, type SheetBreach } from "./bounds.js";
import type { EntryVersion } from "./transactions.js";
import type { SheetRowValue, SheetRootValue } from "./values.js";
import type { SheetHost, SheetRowChanges } from "./parts.js";
import type { SheetDecode } from "./use-decode.js";
import { applyLayer } from "./local-rows.js";

/** The `rows` source's narrowing, as East prints it: what names a narrowing of the rows apart from another (#1349). */
const printRowsWhere = printFor(RecordSliceWhereType);

const cellEqual = equalFor(Sheet.Types.Cell);
const stringEqual = equalFor(StringType);
const lineEqual = equalFor(OptionType(IntegerType));

const readinessEqual = equalFor(SheetBatchReadinessType);

/** A live source's rows under one narrowing, named apart (#1354): the source and its narrowing, as East prints them. */
const printNarrowedSource = printFor(StructType({ source: StringType, narrowing: StringType }));

const NOTHING: ReadonlySet<string> = new Set();
const NO_BREACHES: readonly SheetBreach[] = [];
const NO_ISSUES: readonly EditIssue[] = [];

/** An entry's numbers outside their bounds, and its lines' keys. */
interface EntryBreaches {
    readonly breaches: readonly SheetBreach[];
    readonly lines: readonly string[];
}

/**
 * The session's East values, by their types' names: a value's inferred type carries East's variant brand, which the
 * declaration build cannot name (TS4058).
 */
interface SheetSessionValues {
    readonly readiness: BatchReadiness;
    readonly rows: SheetRowValue[];
    readonly sourceRows: readonly SheetRowValue[];
    readonly storedBreaches: readonly EditIssue[];
}

/**
 * Holds the rows the sheet draws and the session that edits them (see the module docs).
 *
 * @param value - The Sheet root value
 * @param storageKey - Storage key prefix for persisting component state
 * @param host - What the frame hands the parts
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @returns The store, the lens, the paging, the session, the drafts and the rows
 */
export function useSheetSession(value: SheetRootValue, storageKey: string, host: SheetHost, sheetDecode: SheetDecode) {
    const {
        activeView, bandPx, blanks, canInsertRows, columns, declaredNoun, decodedRows, driverColumn, group, hostGrid, keyOrder,
        lensWanted, loose, makeKey, pagedSource, readOnly, rowPx, rowsPart, rowsWhere, subRowPx, words,
    } = sheetDecode;
    // ── What survives a remount (#857) ────────────────────────────────────
    // Under the sheet's `storageKey`: the folds the viewer left, with the tab
    // they left them on, and where the frame's scroll rests — the Plan's
    // rule (#813). Read once, at mount; written when either changes, and only
    // when it differs from what storage holds.
    const { state: stored, setState: setStored } = usePersistedState<SheetPersisted>(storageKey, NOT_PERSISTED, persistedOf);
    const [restored] = useState(() => persistedOf(stored));
    const persistedRef = useRef(restored);
    const persist = useCallback((next: SheetPersisted) => {
        persistedRef.current = next;
        setStored(next);
    }, [setStored]);

    // ── The state machine ─────────────────────────────────────────────────
    const [store, dispatchStore] = useReducer(sheetStoreReducer, undefined, () => {
        // The folds the last session left, when the sheet opens on the tab
        // they were left on (#857).
        const opening = activeView ?? null;
        const restoredFolds = restored.view === opening && restored.folds.length > 0 ? new Map(restored.folds) : undefined;
        // The ring opens on the first blank row's driver column (else its first
        // column) — the prototype's "type an activity on the empty row"; a
        // grouped sheet: the first group's blank line.
        const c = Math.max(0, driverColumn !== undefined ? columns.list.findIndex((col) => col.key === driverColumn) : 0);
        const first = decodedRows?.[0];
        const firstFolded = first !== undefined && (restoredFolds?.get(first.id) ?? getSomeorUndefined(first.band)?.folded === true);
        const blankLine = first !== undefined && !isLooseRow(first) && !firstFolded;
        const r = group !== undefined ? (blankLine ? 1 + first.lines.length : 0) : decodedRows?.length ?? 0;
        // Anywhere else the sheet opens with no ring placed (#1531) — a press places it, or the first move key: a ring
        // nobody placed would sit on an entry, or a band, as if someone had chosen it (#1585). A host's grid draws no
        // blank row; a sheet that adds no rows, or is read only, types none; a paged sheet's lie past rows not read yet;
        // a grouped sheet whose first group is folded, or that opens on a loose row (#846), has no blank line to open on.
        const onBlank = hostGrid === undefined && canInsertRows && blanks > 0 && decodedRows !== undefined && (group === undefined || blankLine);
        return initialSheetStore({ r, c }, opening, restoredFolds, !onBlank);
    });
    const ui = store.ui;
    const folds = ui.folds;
    // A phone's bottom container — its action bar or its cell editor — ⌄ closed at a cell (SH9, SH10): it stays closed
    // there until a press on a cell, that one or another. The cell is held by its row's id and its column's key, so the
    // rows moving under it never reopens it.
    const [barClosedAt, setBarClosedAt] = useState<{ id: string; key: string } | undefined>(undefined);
    const foldedOf = useCallback((row: SheetRowValue): boolean => folds.get(row.id) ?? getSomeorUndefined(row.band)?.folded ?? false, [folds]);
    // A line's sub rows fold under its id like a group under its own: `false` open, `true` closed, absent untouched.
    const subRowsOpenOf = useCallback((lineKey: string): boolean | undefined => { const f = folds.get(lineKey); return f === undefined ? undefined : !f; }, [folds]);
    // What the body draws of one source row (#855): the paged driver measures a
    // window by it, so an unloaded band is as tall as its rows will be.
    const geometry = useMemo<SheetGeometry>(() => ({ rowPx, bandPx, subRowPx }), [rowPx, bandPx, subRowPx]);
    const heightOf = useCallback(
        (row: SheetRowValue) => drawnPx(row, geometry, group !== undefined ? { foldedOf, subRowsOpen: subRowsOpenOf } : undefined, blanks),
        [geometry, group, foldedOf, subRowsOpenOf, blanks],
    );
    // ── The lens (B§8, #1349) — the `rows` source's narrowing over the record ──
    // e3 places the narrowing's rows; the lens reads the segments that hold
    // them near the view, and lays out only the rows the narrowing keeps, each
    // at its row number, a band at their pitch for those not read yet. A
    // grouped sheet's rows are its groups: the records the narrowing holds.
    const lensGeometry = useMemo<LensGeometry>(() => ({ entryPx: group !== undefined ? bandPx + rowPx : rowPx }), [rowPx, bandPx, group]);
    const lensChangedWord = words.m.lensChanged();
    const lensWords = useMemo<LensWords>(() => ({ changed: lensChangedWord }), [lensChangedWord]);
    const lens = useRecordLens({
        source: lensWanted ? pagedSource : undefined, part: rowsPart, where: rowsWhere,
        geometry: lensGeometry, words: lensWords,
    });
    // What was drawn last — the lens's rows or the pages' — stands in while the other reads its first: a
    // narrowing chosen or cleared never empties the sheet, the pages swapping for the lens once it has read the
    // rows near the view (#1354). A sheet that opens on a narrowing reads no pages: the lens draws as it reads.
    const drawnLast = useRef<"lens" | "pages" | undefined>(undefined);
    const lensReady = lensWanted && lens.layout !== undefined && (lens.ready || drawnLast.current !== "pages");
    const pagesStandIn = lensWanted && !lensReady && drawnLast.current === "pages";
    const paging = useSheetPaging(lensReady || (lensWanted && !pagesStandIn) ? undefined : pagedSource, heightOf, undefined, rowsPart?.sourceId);
    const pagesReady = paging.rows.length > 0 || paging.failures.length > 0 || paging.error !== undefined || (paging.exhausted && paging.total !== undefined);
    const lensStandsIn = !lensWanted && lens.layout !== undefined && !pagesReady && drawnLast.current === "lens";
    // The rows drawn are the lens's: what it laid out over the record.
    const lensDrawn = lensReady || lensStandsIn;
    useLayoutEffect(() => {
        if (lensDrawn) drawnLast.current = "lens";
        else if (pagedSource !== undefined && pagesReady) drawnLast.current = "pages";
    });
    const drawnRows: readonly SheetRowValue[] = decodedRows ?? (lensDrawn ? lens.rows : paging.rows);
    const rowsOffset = decodedRows !== undefined || lensDrawn ? 0 : paging.rowsOffset;
    // Each source row's position — its index inline; paged, its place in the
    // source, which a failed window before it does not move (#853); under the
    // lens, its place in the record.
    const inlinePositions = useMemo(() => decodedRows?.map((_r, i) => i), [decodedRows]);
    const sourcePositions: readonly number[] = inlinePositions ?? (lensDrawn ? lens.positions : paging.positions);
    // Each row's cells from data and every column's marks, read at the day (#1559): over its entry here, over its draft
    // once it has one (the layer, below) — the source's rows carry none of them.
    const day = useSheetDay(value.cellsAt.type === "some");
    const fromData = useCellsFromData(value, day, words.m.marksUnread());
    // The entry each row drawn was read with (#1599): its own window's — the pages', or the lens's — whatever revision
    // the source has moved to since. Rows held whole are read from as they are.
    const entryOf = decodedRows !== undefined ? undefined : lensDrawn ? lens.entryOf : paging.entryOf;
    const sourceRows = useMemo(() => fromData.rows(drawnRows, sourcePositions, entryOf), [fromData, drawnRows, sourcePositions, entryOf]);
    // Every row resident: inline, or a paged source read to its end — never under the lens, which draws a part of the record.
    const exhausted = decodedRows !== undefined || (!lensDrawn && paging.exhausted);
    // The source's element count, once known, and the revision it was read at: a Save's rows are counted over a count
    // read before it, never one read since, which holds them (#1536).
    const total = lensDrawn ? lens.total : paging.total;
    const totalRevision = lensDrawn ? lens.revision : paging.totalRevision;
    // The rows shown are not the narrowing's yet — another narrowing's stand in, or nothing is read: they take no
    // gesture (#1345). A new revision's rows reading under the last ones still do.
    const standingIn = lensDrawn ? lens.replacing || lensStandsIn : paging.replacing || pagesStandIn || (lensWanted && !lensReady);
    // Every key a new one's must not be (#1536), read as one is made: so it reaches the session made below.
    const takenRef = useRef<() => Set<string>>(() => new Set());
    // A new line beside loose rows (#846) takes an id made by the sheet's rule: the field a loose row is identified by, a
    // key of the same rows. A line is no entry of the session's, so its id is none of the session's own.
    const mintLineId = useCallback(() => {
        const taken = takenRef.current();
        return makeKey({ has: (id) => taken.has(id), ids: () => taken });
    }, [makeKey]);
    // How a new row is keyed (#1536, #1583): its key is the session's to make, by the sheet's rule, and the session's own
    // until its row is saved — made another, by the same rule, where another Save takes it. A gesture says what it knows
    // taken as it asks (`mintAmong`, below); a carry-over, which no gesture speaks for, reads what the sheet has read. A
    // rule that can make no other key — the app's `newKey` refusing — leaves the two rows to choose between.
    const keys = useMemo((): EntryKeys => ({
        make: (known, _from, taken) => {
            if (taken === undefined) return makeKey(known);
            const read = takenRef.current();
            return makeKey({ has: (id) => read.has(id) || known.has(id), ids: function* () { yield* read; yield* known.ids(); } });
        },
    }), [makeKey]);
    // The rows a key's far jump holds stand in, retained, until its rows replace them (#1398, CL10): the source's own
    // rows still, which the session holds, but they take no gesture. So do rows read another way than their source
    // reads them now, while its windows are read again (#1599).
    const keyHeld = lensDrawn ? lens.reread : paging.held || paging.reread;
    // How the rows drawn were read: a Save's rows are drawn as it left them over those read before it — the pages a window
    // at a time while a new revision's are read (#851), the lens a layout at a time — until their source reads them again.
    const pagesStanding = paging.standing;
    const rowsRead = useMemo((): SheetRowsRead | undefined => {
        if (decodedRows !== undefined) return undefined;
        if (lensDrawn) return { revision: lens.revision, before: () => lens.readBefore };
        return {
            revision: paging.revision,
            before: (position) => position === undefined ? pagesStanding.length > 0 : pagesStanding.includes(Math.floor(position / SHEET_PAGE_SIZE)),
        };
    }, [decodedRows, lensDrawn, lens.revision, lens.readBefore, paging.revision, pagesStanding]);
    // The inspector's numbers held to bounds (#1585): a changed row's Save waits while one is outside them.
    const bounds = useMemo(() => sheetBoundsOf(host.forms), [host.forms]);
    const editingState = useSheetEditing(value.editing, pagedSource, sourceRows, sourcePositions, storageKey, loose ? mintLineId : undefined, rowsPart, standingIn, keyHeld, declaredNoun?.singular, day, rowsRead, keys, bounds, windowedSourceOf(value.rows)?.id, host.autosave, entryOf);
    const session = editingState.session;
    // A new row given a new key as the drafts carried over, another write having added its own (#1583): the footer says
    // so, once — never again as the sheet mounts over a session that did so before.
    const renumbered = session.renumbered;
    const renumberedSaid = useRef(renumbered);
    useLayoutEffect(() => {
        if (renumberedSaid.current === renumbered) return;
        renumberedSaid.current = renumbered;
        const first = [...renumbered][0];
        if (first === undefined) return;
        dispatchStore({ t: "patch", patch: { msg: { id: "renumbered", from: first[0], to: first[1], n: renumbered.size } } });
    }, [renumbered, dispatchStore]);
    // ── The app's optimiser (#1409, #1418) ────────────────────────────────
    // One run over the current tab's rows, its result landed on them as one edit (`use-assembled.tsx`, once the rows and their
    // versions are read); while the call is out the sheet holds its lock: no cell, row or field edit, no drop, no
    // history action. The landing and the highlight are measured over the frame the sheet is laid in.
    const landingRoot = useRef<HTMLDivElement | null>(null);
    const landing = useLanding(landingRoot);
    const landingStyles = useLandingStyles();
    const optimiseTypes = useMemo(() => sheetOptimiseTypes(value.editing), [value.editing]);
    // The rows as a narrowing of them names them (#1345, #1349): the source and the narrowing of its rows, together —
    // the key search's scope, and the run's: a change of tab or narrowing stops a run out (O4).
    const rowsQuery = printNarrowedSource({ source: pagedSource?.id ?? "", narrowing: rowsWhere === undefined ? "" : printRowsWhere(rowsWhere) });
    const [optimised, setOptimised] = useState<SheetOptimised | undefined>(undefined);
    const landRef = useRef<(result: SheetOptimiseResult, request: SheetOptimiseRequest, run: number) => OptimiseCounts | undefined>(() => undefined);
    const run = useOptimise<SheetOptimiseRequest, SheetOptimiseResult>({
        name: host.optimise?.name ?? null, requestType: optimiseTypes.request, resultType: optimiseTypes.result,
        scope: `${rowsQuery}|${ui.tabs.active ?? ""}`, storageKey,
        onLanded: (result, request, n) => landRef.current(result, request, n),
    });
    // The lock (R2): while a call is out, nothing is edited — what every write checks beside `readOnly`.
    const locked = run.running;
    const canEdit = !readOnly && !locked;
    // The session's readiness, held by value: what keys on it — the rows'
    // draft presentations — moves only when it does (#858).
    const readiness = useDataStable(session.readiness, readinessEqual);
    const draftType = useMemo(() => fromEastTypeValue(value.editing.draftType), [value.editing.draftType]);
    const childField = getSomeorUndefined(value.editing.children);
    // Every key a new one's must not be (#1536): each the sheet has read, and each its batch has drafted, a removed
    // entry's among them, which the record holds until Apply. Beside loose rows, each drafted line's id too, a key of the
    // same rows.
    const lineIdField = loose ? getSomeorUndefined(value.editing.idField) : undefined;
    const takenKeys = useCallback((): Set<string> => {
        const taken = new Set<string>();
        for (const row of sourceRows) taken.add(row.id);
        for (const [id, entry] of session.entries) {
            taken.add(id);
            const draft = entry.draft;
            if (lineIdField === undefined || childField === undefined || !isVariant(draft) || draft.type !== "group") continue;
            for (const line of (draft.value as Record<string, unknown>)[childField] as readonly Record<string, unknown>[]) {
                const held = line[lineIdField];
                if (isVariant(held) && held.type === "value") taken.add(held.value as string);
            }
        }
        return taken;
    }, [sourceRows, session, lineIdField, childField]);
    takenRef.current = takenKeys;
    // A new row's key, as a gesture asks for one: the session's to make (#1583), past every key the gesture says is taken
    // — the sheet's rows, and those it has made already, which the key then joins.
    const mintAmong = useCallback((taken: Set<string>): string => {
        const id = session.mint(undefined, taken);
        if (id === undefined) throw new Error("The sheet's session is bound to no rule for a new row's key");
        taken.add(id);
        return id;
    }, [session]);
    const draftVersion = editingState.version;
    // Every gesture the session records, counted (#1533): what a host's status line lets the last gesture's words go by
    // when the next has none of its own. A ref, read as the sheet draws: a recorded gesture moves the session, which
    // draws the sheet again.
    const gestureCount = useRef(0);
    const recordSession = editingState.record;
    const recordGesture = useCallback<typeof recordSession>((events, placements, originOverride, draftEdits, seeds, label, joins, held) => {
        const recorded = recordSession(events, placements, originOverride, draftEdits, seeds, label, joins, held);
        if (recorded) gestureCount.current += 1;
        return recorded;
    }, [recordSession]);
    const drafts = editingState.drafts;
    // The session's rows, each with its cells from data read over its draft (#1559) — a Save's landed rows over theirs.
    const layerDrafts = editingState.layerDrafts;
    const layer = useMemo(() => fromData.layer(editingState.layer, layerDrafts.entries, layerDrafts.drafts), [fromData, editingState.layer, layerDrafts]);
    // Each entry's numbers outside their bounds (#1585), read once per session change — from its draft, else from the
    // source's version of it — and its lines' keys: what its cells' wash and the Issues tab read.
    const originalOf = editingState.original;
    const breachesOf = useMemo(() => {
        const byId = new Map<string, EntryBreaches>();
        return (id: string): EntryBreaches | undefined => {
            let found = byId.get(id);
            if (found !== undefined || bounds === undefined) return found;
            let version: EntryVersion | undefined = session.entries.get(id);
            if (version === undefined) { try { version = originalOf(id); } catch { version = undefined; } }
            found = {
                breaches: version?.draft === undefined ? NO_BREACHES : entryBreaches(bounds, normalizeDraft(draftType, version.draft, id).held, childField),
                lines: version?.wire?.lines.map((line) => line.key) ?? [],
            };
            byId.set(id, found);
            return found;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, draftType, childField, draftVersion, bounds, originalOf]);
    // A row's draft presentation, derived once per session change (#858): the
    // gutter's decisions and the row read the same one, and between changes a
    // row keeps it by identity, so its memo holds. Any row's numbers outside
    // their bounds join it (#1585) — a stored row's nobody changed among them —
    // so its cells wear the warn wash.
    const draftOf = useMemo(() => {
        const byEntry = new Map<string, Map<string | undefined, DraftPresentation>>();
        const formWords = { ...words, m: fieldFormMessages };
        return (id: string, child?: string): DraftPresentation => {
            let byChild = byEntry.get(id);
            if (byChild === undefined) { byChild = new Map(); byEntry.set(id, byChild); }
            let found = byChild.get(child);
            if (found === undefined) {
                found = draftPresentation(session, draftType, childField, id, child, readiness, words);
                const held = breachesOf(id);
                const line = child === undefined ? undefined : held?.lines.findIndex((key) => stringEqual(key, child));
                const own = held?.breaches.filter((b) => b.line === line) ?? NO_BREACHES;
                if (own.length > 0) {
                    const said = new Map(own.map((b) => [b.at, fieldBreachText(b.breach, formWords)] as const));
                    found = { ...found, bounds: said, issues: new Map([...said, ...found.issues]) };
                }
                byChild.set(child, found);
            }
            return found;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, draftType, childField, readiness, draftVersion, words, breachesOf]);
    // What a row's drafts changed against what the record holds (#1531), for a host's rows: derived once per session
    // change and per rows, so between changes a row keeps it by identity and its memo holds.
    const fieldChanges = useMemo(() => draftChanges(draftType), [draftType]);
    const changesOf = useMemo(() => {
        const byId = new Map<string, SheetRowChanges | null>();
        return (id: string, row: SheetRowValue): SheetRowChanges | undefined => {
            const known = byId.get(id);
            if (known !== undefined) return known ?? undefined;
            const began = session.originals.get(id);
            const draft = session.entries.get(id)?.draft;
            let found: SheetRowChanges | null = null;
            if (began !== undefined && draft !== undefined) {
                if (began.draft === undefined) {
                    // Its fields still missing, as its readiness finds them: what a person must fill before Save.
                    const checked = normalizeDraft(draftType, draft, id).readiness;
                    const missing = new Set<string>();
                    if (checked.type !== "ready") {
                        for (const issue of checked.value) {
                            if (issue.field.type === "some" && issue.row.type === "none" && kindOfIssue(issue, checked) === "incomplete") missing.add(issue.field.value);
                        }
                    }
                    found = { added: true, dirty: NOTHING, held: undefined, fields: 0, missing };
                } else {
                    const dirty = new Set<string>();
                    const held = fromData.held(began);
                    for (const [key, cell] of row.cells) if (!cellEqual(held?.get(key) ?? NULL_CELL, cell)) dirty.add(key);
                    found = { added: false, dirty, held, fields: fieldChanges(began.draft, draft), missing: NOTHING };
                }
            }
            byId.set(id, found);
            return found ?? undefined;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session; the rows, what a change is read against.
    }, [session, draftVersion, sourceRows, layer, draftType, fieldChanges, fromData]);
    // Temporary writes within one reducer effect batch; the transaction session
    // publishes the completed gesture and owns the rendered layer thereafter.
    const layerRef = useRef(layer);
    layerRef.current = layer;
    const setLayer = useCallback((fn: (prev: LocalLayer) => LocalLayer) => { layerRef.current = fn(layerRef.current); }, []);
    const rows = useMemo(() => applyLayer(sourceRows, layer, keyOrder), [sourceRows, layer, keyOrder]);
    // The rows' numbers outside their bounds that hold no Save (#1585): each of a row nobody changed — whose readiness
    // raises none — an issue the Issues tab lists amber beside its cell's wash, naming the row and the field in the
    // hint's own words. A changed row's are its readiness's, which hold Save.
    const storedBreaches = useMemo((): readonly EditIssue[] => {
        if (bounds === undefined) return NO_ISSUES;
        const raised = readiness.type === "ready" ? [] : readiness.value;
        const out: EditIssue[] = [];
        for (const row of rows) {
            for (const { line, at, breach } of breachesOf(row.id)?.breaches ?? NO_BREACHES) {
                const own = raised.some((issue) => stringEqual(issue.entry, row.id) && issue.field.type === "some" && stringEqual(issue.field.value, at)
                    && lineEqual(issue.row, line === undefined ? none : some(BigInt(line))));
                if (!own) out.push(fieldBreachIssue(breach, { entry: row.id, row: line === undefined ? undefined : BigInt(line), field: at }));
            }
        }
        return out;
    }, [bounds, readiness, rows, breachesOf]);
    // Each row's position on screen, where each failed window sits among the
    // rows, and the contiguous runs between them (#853) — under the lens, each
    // row's place in the record, and the runs of rows it draws together.
    const runLayout = useMemo(() => {
        const at = new Map(sourceRows.map((row, i) => [row.id, sourcePositions[i]!] as const));
        if (lensDrawn) return layoutLensRun(rows, (id) => at.get(id));
        return layoutRun(rows, rowsOffset, decodedRows !== undefined ? [] : paging.failures, (id) => at.get(id));
    }, [rows, rowsOffset, sourceRows, sourcePositions, decodedRows, paging.failures, lensDrawn]);
    const named: SheetSessionValues = { readiness, rows, sourceRows, storedBreaches };
    return {
        barClosedAt, canEdit, changesOf, childField, dispatchStore, draftOf, draftType, draftVersion, drafts,
        editingState, exhausted, foldedOf, folds, geometry, gestureCount, keyHeld, landRef, landing, landingRoot,
        landingStyles, layer, layerRef, lens, lensDrawn, locked, mintAmong, mintLineId, optimiseTypes, optimised, pagesReady,
        pagesStandIn, paging, persist, persistedRef, recordGesture, restored, rowsOffset, rowsQuery, run, runLayout,
        session, setBarClosedAt, setLayer, setOptimised, standingIn, store, subRowsOpenOf, takenKeys, total, totalRevision, ui,
        ...named,
    };
}

/** What {@link useSheetSession} gives the parts after it. */
export type SheetSession = ReturnType<typeof useSheetSession>;
