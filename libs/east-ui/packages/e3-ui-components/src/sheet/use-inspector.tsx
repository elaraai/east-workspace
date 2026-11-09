/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The side panel's reads and gestures: the target the ring or the range selects, its draft against what the record
 * holds, its writes, duplicates and removals, a host's own Add and Delete, the cells drawn as the grid draws them, and the
 * batch's issues, gone to where they are. A write asks each cell the one check the grid's gestures ask (#1560): a cell
 * its mark locks takes none, nor one with no blank a clear (#1561).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { StringType, equalFor, printFor, some, variant, type EastType, type PatchPath, type ValueTypeOf, type option } from "@elaraai/east";
import { SheetDraftFieldType } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, type EditIssue } from "@elaraai/east-ui-components";
import { kindOfIssue } from "@elaraai/east-ui-components/internal";
import { EditingIssueType } from "@elaraai/east-ui/internal";
import {
    NULL_CELL, TITLE_KEY, cellIsBlank, cellText, cellWritable, driverKeyOf, lineAddress, markOf, resolveMember as resolveRegisterMember, takesClear, unitOf, type SheetColumnMeta,
} from "./model.js";
import type { SheetCellRefusalWord } from "./messages.js";
import { clearSearch, narrowingQuery, writeNarrowing } from "./view-state.js";
import { askHiding, hiddenLine } from "../shared/schedule/hidden.js";
import { parseCell } from "./parse/index.js";
import { selectionRect } from "./sheet-state.js";
import type { EntryVersion } from "./transactions.js";
import { normalizeDraft } from "./draft-values.js";
import { namesMember } from "./Rows.js";
import { SheetCellContent } from "./cells/Cell.js";
import type { DraftEdit, LocalLayer } from "./use-editing.js";
import type { SheetCellValue, SheetEditValue, SheetRowValue, SheetRootValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { CellWrite, SheetWrites } from "./use-writes.js";
import type { SheetCopilot } from "./use-copilot.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetGestures } from "./use-gestures.js";
import type { SheetOpenEditor } from "./use-open-editor.js";
import type { SheetJumps } from "./use-jumps.js";
import type { SheetViewTabs } from "./use-view-tabs.js";
import type { SheetActions } from "./use-actions.js";
import type { SheetDuplicateOptions, SheetInspect, SheetInspectPlace, SheetInspectTarget, SheetInspectWrite, SheetRowChanges, SheetSelected } from "./parts.js";
import { mintLineKey, rowNameOf } from "./local-rows.js";

const stringEqual = equalFor(StringType);

const issueEqual = equalFor(EditingIssueType);

const printString = printFor(StringType);

/**
 * A record field's value as a column's cell holds it — the case its East type
 * names, through an option — or `undefined` for none, and for a type no cell
 * holds.
 */
function cellOfValue(value: unknown, type: EastType | undefined): SheetCellValue | undefined {
    if (type?.type === "Variant" && "some" in type.cases && "none" in type.cases) {
        const held = value as option<unknown>;
        return held.type === "some" ? cellOfValue(held.value, type.cases.some) : undefined;
    }
    switch (type?.type) {
        case "Boolean": return variant("Boolean", value as boolean);
        case "Integer": return variant("Integer", value as bigint);
        case "Float": return variant("Float", value as number);
        case "String": return variant("String", value as string);
        case "DateTime": return variant("DateTime", value as Date);
        default: return undefined;
    }
}

/** One field of a draft, decoded: missing, a value, or the text that could not be read. */
type DraftFieldValue = ValueTypeOf<ReturnType<typeof SheetDraftFieldType<EastType>>>;

/** A draft struct's fields as their values: a field's value, `undefined` while it is missing or unreadable. */
export function draftValues(draft: Record<string, unknown>, children: string | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [field, state] of Object.entries(draft)) {
        if (field === children) continue;
        const s = state as DraftFieldValue;
        out[field] = s.type === "value" ? s.value : undefined;
    }
    return out;
}

/** A draft struct with fields set: a value, or missing for `undefined`. */
export function withFields(draft: Record<string, unknown>, fields: ReadonlyMap<string, unknown>): Record<string, unknown> {
    const next = { ...draft };
    for (const [field, value] of fields) next[field] = value === undefined ? variant("missing", null) : variant("value", value);
    return next;
}

/**
 * Builds what the inspector pane reads of the sheet and the gestures it makes (see the module docs).
 *
 * @param value - The Sheet root value
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetWrites - The cell writes, the removal and the proposals' inserts
 * @param sheetCopilot - What asks the copilot to run
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @param sheetOpenEditor - The styles and the open editor
 * @param sheetJumps - The key search, the scroll's anchor and the issue gone to
 * @param sheetViewTabs - The view tabs, the summary and the folds
 * @param sheetActions - The action host, its overlay and the phone's bottom container
 * @returns The inspector's reads and gestures, and a host's Add and Delete
 */
export function useSheetInspector(value: SheetRootValue, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetWrites: SheetWrites, sheetCopilot: SheetCopilot,
    sheetEffects: SheetEffects, sheetGestures: SheetGestures, sheetOpenEditor: SheetOpenEditor, sheetJumps: SheetJumps,
    sheetViewTabs: SheetViewTabs, sheetActions: SheetActions) {
    const {
        allColumns, canInsertGroups, canInsertRows, capabilities, chrome, columns, copilotOn, declaredNoun,
        driverColumn, group, lensWanted, loose, mintAmong, narrowing, registers, triggers, words,
    } = sheetDecode;
    const {
        canEdit, changesOf, childField, dispatchStore, draftOf, draftType, draftVersion, editingState, layerRef, mintLineId,
        readiness, recordGesture, rows, session, setLayer, sourceRows, store, takenKeys, ui,
    } = sheetSession;
    const { allowedFor, body, idAt, levelAt, linkCellCtx, parseCtxFor, rowAt, rowSpace } = sheetBody;
    const { dispatch, expectedNarrowing, keyIsText, uiRef } = sheetMachine;
    const { emitEdit, failed, gestureEvents, writeCells } = sheetWrites;
    const { requestRun } = sheetCopilot;
    const { cardRef, runEffects } = sheetEffects;
    const { insertWhenClosed, pendingInsertFocus } = sheetGestures;
    const { styles } = sheetOpenEditor;
    const { issueSought, onIssue, revealRef, rowsPick, seek } = sheetJumps;
    const { wholeCount } = sheetViewTabs;
    const { drawAction } = sheetActions;
    // ── The inspector's reads and gestures (#1188) ────────────────────────
    // Nothing here reads the source until the inspector pane asks for a
    // target: a sheet with no inspector pane reads nothing for it.
    const originalOf = editingState.original;
    // What the source holds for an entry no gesture has touched, lifted into
    // its draft — read once while the resident rows and the session stand, so a
    // paged source's page is read again only when its windows move, its
    // revision does, or a Save lands what it saved over the rows read before
    // it and lets it go as they read it again (#1583).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the resident rows and the session's version are the cache's key: either moving empties it.
    const lifted = useMemo(() => new Map<string, EntryVersion | undefined>(), [sourceRows, draftVersion]);
    // An entry's version as it stands: the session's, else what a Save left of it or the source's — or none while its page is not in.
    const versionOf = useCallback((id: string): EntryVersion | undefined => {
        const held = session.entries.get(id);
        if (held !== undefined) return held;
        if (lifted.has(id)) return lifted.get(id);
        let read: EntryVersion | undefined;
        try { read = originalOf(id); } catch { read = undefined; }
        lifted.set(id, read);
        return read;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, originalOf, lifted, draftVersion]);
    // The draft struct a target is: a row's (an entry's arm, beside loose rows), a band's group's, a line's child by its key.
    const structOf = useCallback((version: EntryVersion | undefined, child: string | undefined): { draft: Record<string, unknown>; type: EastType } | undefined => {
        if (version?.draft === undefined) return undefined;
        const looseDraft = draftType.type === "Variant";
        const draft = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
        const armType: EastType = looseDraft ? (draftType.cases as Record<string, EastType>)[(version.draft as ValueTypeOf<typeof draftType>).type as string]! : draftType;
        if (child === undefined) return { draft, type: armType };
        if (childField === undefined || armType.type !== "Struct") return undefined;
        const index = version.wire?.lines.findIndex((line) => stringEqual(line.key, child)) ?? -1;
        const children = draft[childField] as unknown[] | undefined;
        const childType = (armType.fields as Record<string, EastType>)[childField];
        if (index < 0 || children === undefined || childType?.type !== "Array") return undefined;
        return { draft: children[index] as Record<string, unknown>, type: childType.value as EastType };
    }, [draftType, childField]);
    // Where a row, a line or a band stands, read off the body: no read of the source.
    const placeAt = useCallback((r: number): SheetInspectPlace | undefined => {
        const it = rowAt(r);
        if (it === undefined || (it.kind !== "real" && it.kind !== "group")) return undefined;
        const lg = it.kind === "real" ? it.group : undefined;
        const groupRow = lg !== undefined ? lg.row : it.kind === "group" ? it.row : undefined;
        const title = groupRow?.cells.get(TITLE_KEY);
        return {
            r,
            kind: it.kind === "group" ? "band" : lg !== undefined ? "line" : "row",
            entry: lg !== undefined ? lg.row.id : it.row.id,
            child: lg?.key,
            index: lg?.index,
            row: it.row,
            number: lg !== undefined ? lg.number : it.position + 1,
            group: groupRow !== undefined ? { title: title !== undefined && title.type === "String" && title.value !== "" ? title.value : undefined, lines: groupRow.lines.length } : undefined,
            owned: (groupRow ?? it.row).owned,
            subRows: lg !== undefined ? lg.row.lines[lg.index]?.subRows ?? [] : it.row.subRows,
        };
    }, [rowAt]);
    const targetAt = useCallback((r: number): SheetInspectTarget | undefined => {
        const place = placeAt(r);
        if (place === undefined) return undefined;
        const { entry, child, kind } = place;
        const current = structOf(versionOf(entry), child);
        // What the record holds: the version the first gesture began from — or, never touched, the draft itself.
        const began = session.originals.get(entry);
        const base = began === undefined ? current : structOf(began, child);
        const children = kind === "line" ? undefined : childField;
        return {
            ...place,
            value: current === undefined ? undefined : draftValues(current.draft, children),
            baseline: base === undefined ? undefined : draftValues(base.draft, children),
            complete: current === undefined || kind === "band" ? undefined : normalizeDraft(current.type, current.draft, entry).domain,
            presentation: draftOf(entry, child),
        };
    }, [placeAt, structOf, versionOf, session, childField, draftOf]);
    // What the ring and the range hold: a hover, a key, an editor elsewhere leave it as it is — and nothing before the
    // ring is placed (#1531).
    const selSel = ui.sel;
    const selEnd = ui.selEnd;
    const ringless = ui.ringless;
    const selected = useMemo((): SheetSelected => {
        if (ringless) return { kind: "none" };
        const rect = selectionRect({ sel: selSel, selEnd });
        if (rect.r0 === rect.r1) {
            const place = placeAt(rect.r0);
            return place === undefined ? { kind: "none" } : { kind: "one", place };
        }
        // Several rows: the rows and lines in the range — a band stands for its lines.
        const rs: number[] = [];
        for (let r = rect.r0; r <= rect.r1; r++) {
            const it = rowAt(r);
            if (it !== undefined && it.kind === "real") rs.push(r);
        }
        if (rs.length === 0) return { kind: "none" };
        if (rs.length === 1) {
            const place = placeAt(rs[0]!);
            return place === undefined ? { kind: "none" } : { kind: "one", place };
        }
        return { kind: "several", rs, r0: rect.r0, r1: rect.r1 };
    }, [ringless, selSel, selEnd, rowAt, placeAt]);
    const inspectWrite = useCallback((writes: readonly SheetInspectWrite[], joins?: string): SheetCellRefusalWord | undefined => {
        if (!canEdit || !editingState.available) return undefined;
        gestureEvents.current = [];
        const cellWrites: CellWrite[] = [];
        const draftEdits = new Map<string, DraftEdit>();
        const touched: { r: number; keys: string[] }[] = [];
        // Why the first cell it leaves as it was is left: the footer says so, and the write answers it.
        let refused: SheetCellRefusalWord | undefined;
        for (const w of writes) {
            const it = rowAt(w.r);
            if (it === undefined || (it.kind !== "real" && it.kind !== "group")) continue;
            const keys: string[] = [];
            // The one check each cell asks, as the grid's gestures do: a cell its mark locks takes nothing, one whose column
            // has no blank — a column from data's value that is no option — no clear, and a column from data no text it
            // can't read, of which it keeps none.
            const metaOf = (key: string) => (it.kind === "group" ? group?.cells.get(key) : allColumns.byKey.get(key));
            const refusal = (meta: SheetColumnMeta | undefined, cell: SheetCellValue): SheetCellRefusalWord | undefined => {
                if (meta === undefined) return undefined;
                if (!cellWritable(meta, it.row.cells)) {
                    const mark = markOf(meta, it.row.cells);
                    return mark?.lock === true ? { why: "locked", words: mark.words } : { why: "readOnly", header: meta.header };
                }
                if (cellIsBlank(cell) && !takesClear(meta)) return { why: "noClear", header: meta.header };
                return cell.type === "Invalid" && getSomeorUndefined(meta.raw.from) !== undefined ? { why: "unread", header: meta.header, text: cell.value } : undefined;
            };
            for (const [key, cell] of w.cells ?? []) {
                const why = refusal(metaOf(key), cell);
                if (why !== undefined) {
                    refused ??= why;
                    continue;
                }
                cellWrites.push({ r: w.r, c: -1, key, cell });
                keys.push(key);
            }
            for (const [key, text] of w.texts ?? []) {
                // As typing in the cell reads it: blank is the blank cell, unreadable text kept as typed.
                const meta = metaOf(key);
                if (meta === undefined) continue;
                const outcome = parseCell(meta, text, parseCtxFor(w.r, meta));
                const cell = outcome.kind === "cell" ? outcome.cell : outcome.kind === "unrecognised" ? variant("Invalid", text) : NULL_CELL;
                const why = refusal(meta, cell);
                if (why !== undefined) {
                    refused ??= why;
                    continue;
                }
                cellWrites.push({ r: w.r, c: -1, key, cell });
                keys.push(key);
            }
            touched.push({ r: w.r, keys });
            const fields = w.fields;
            if (fields === undefined || fields.size === 0) continue;
            const lg = it.kind === "real" ? it.group : undefined;
            const entry = lg !== undefined ? lg.row.id : it.row.id;
            const child = lg?.key;
            const prior = draftEdits.get(entry);
            draftEdits.set(entry, (version) => {
                const before = prior === undefined ? version : prior(version);
                const at = structOf(before, child);
                if (at === undefined) return before;
                const set = withFields(at.draft, fields);
                const looseDraft = draftType.type === "Variant";
                const arm = looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).type as string : undefined;
                if (child === undefined) return { ...before, draft: looseDraft ? variant(arm!, set) : set };
                const outer = (looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).value : before.draft) as Record<string, unknown>;
                const index = before.wire?.lines.findIndex((line) => stringEqual(line.key, child)) ?? -1;
                const kids = [...(outer[childField!] as unknown[])];
                kids[index] = set;
                const next = { ...outer, [childField!]: kids };
                return { ...before, draft: looseDraft ? variant(arm!, next) : next };
            });
        }
        const said = refused === undefined ? undefined : { id: "editRefused" as const, word: refused };
        // A write every cell of which was refused is no gesture.
        if (cellWrites.length === 0 && draftEdits.size === 0) {
            if (said !== undefined) dispatchStore({ t: "patch", patch: { msg: said } });
            return refused;
        }
        if (cellWrites.length > 0) writeCells(cellWrites, "typed");
        try { recordGesture(gestureEvents.current, undefined, "typed", draftEdits, undefined, undefined, joins); }
        catch (error) { failed(error); }
        finally { gestureEvents.current = []; }
        if (said !== undefined) dispatchStore({ t: "patch", patch: { msg: said } });
        // The copilot asks again for a row whose trigger column changed, as typing in it does.
        if (copilotOn) {
            for (const { r, keys } of touched) {
                if (!keys.some((key) => triggers.size === 0 || triggers.has(key))) continue;
                const id = idAt(r);
                if (id !== undefined) requestRun(id, 0);
            }
        }
        return refused;
    }, [canEdit, editingState.available, rowAt, group, allColumns, parseCtxFor, structOf, draftType, childField, writeCells, recordGesture, failed, copilotOn, triggers, idAt, requestRun, gestureEvents, dispatchStore]);
    const editInSheet = useCallback((r: number, key: string): boolean => {
        const c = columns.list.findIndex((col) => stringEqual(col.key, key));
        if (c < 0 || rowAt(r) === undefined) return false;
        dispatch({ t: "select.set", r, c });
        cardRef.current?.focus({ preventScroll: true });
        return true;
    }, [columns, rowAt, dispatch, cardRef]);
    const removeRows = useCallback((r0: number, r1: number) => { runEffects([{ t: "delete.rows", r0, r1 }]); }, [runEffects]);
    const duplicate = useCallback((rs: readonly number[], options?: SheetDuplicateOptions): boolean => {
        if (!canEdit || !editingState.available) return false;
        const idField = getSomeorUndefined(value.editing.idField);
        const events: SheetEditValue[] = [];
        const draftEdits = new Map<string, DraftEdit>();
        const typed = variant("typed", null);
        // A copy's draft: the source's, with its own identity where the struct carries one.
        const withIdentity = (draft: Record<string, unknown>, id: string): Record<string, unknown> =>
            (idField !== undefined && idField in draft ? { ...draft, [idField]: variant("value", id) } : draft);
        // The field a host's copy leaves empty (#1534) — a Record's title: missing on its draft, and blank under the column
        // over it, which its key names.
        const empty = options?.empty;
        const emptied = (draft: Record<string, unknown>): Record<string, unknown> =>
            (empty !== undefined && empty in draft ? withFields(draft, new Map([[empty, undefined]])) : draft);
        const blanked = (cells: SheetRowValue["cells"]): SheetRowValue["cells"] =>
            (empty === undefined || !cells.has(empty) ? cells : new Map([...cells, [empty, NULL_CELL]]));
        // The first copy: where a host's ring lands once the body holds it.
        let first: { id: string; child?: string } | undefined;
        // A group as the layer has it now: lines inserted earlier in this gesture included.
        const groupsNow = new Map<string, SheetRowValue>();
        const groupOf = (g: SheetRowValue) => groupsNow.get(g.id) ?? layerRef.current.edits.get(g.id) ?? layerRef.current.appended.find((x) => x.id === g.id) ?? g;
        // A copy whose key is refused, or a gesture the session cannot take, duplicates nothing: the footer says why (#1536).
        try {
            for (const r of rs) {
                const it = rowAt(r);
                if (it === undefined || (it.kind !== "real" && it.kind !== "group")) continue;
                const lg = it.kind === "real" ? it.group : undefined;
                if (lg !== undefined) {
                    // A line: its copy just after it in its group.
                    if (!canInsertRows) continue;
                    const g0 = groupOf(lg.row);
                    const index = g0.lines.findIndex((line) => stringEqual(line.key, lg.key));
                    const source = structOf(versionOf(lg.row.id), lg.key);
                    if (index < 0 || source === undefined) continue;
                    const key = mintLineKey(g0);
                    const line = g0.lines[index]!;
                    const g: SheetRowValue = { ...g0, lines: [...g0.lines.slice(0, index + 1), { ...line, key, cells: blanked(line.cells) }, ...g0.lines.slice(index + 1)] };
                    groupsNow.set(g.id, g);
                    events.push(variant("lineInsert", { rowId: g.id, offset: BigInt(it.position), after: some(lineAddress(index)), line: lineAddress(index + 1), row: g, source: typed }));
                    first ??= { id: g.id, child: key };
                    const prior = draftEdits.get(g.id);
                    const copy = emptied(loose ? withIdentity(source.draft, mintLineId()) : source.draft);
                    draftEdits.set(g.id, (version) => {
                        const before = prior === undefined ? version : prior(version);
                        const looseDraft = draftType.type === "Variant";
                        const outer = (looseDraft ? (before.draft as ValueTypeOf<typeof draftType>).value : before.draft) as Record<string, unknown>;
                        const at = before.wire?.lines.findIndex((l) => stringEqual(l.key, key)) ?? -1;
                        if (at < 0) return before;
                        const kids = [...(outer[childField!] as unknown[])];
                        kids[at] = copy;
                        const next = { ...outer, [childField!]: kids };
                        return { ...before, draft: looseDraft ? variant("group", next) : next };
                    });
                    continue;
                }
                // A row, or a band's group with its lines: a new entry just after it, its draft the source's.
                if (it.kind === "group" ? !canInsertGroups : !canInsertRows) continue;
                const version = versionOf(it.row.id);
                if (version?.draft === undefined) continue;
                const id = mintAmong(takenKeys());
                let copy: SheetRowValue = { ...it.row, id, owned: false, lines: [], cells: blanked(it.row.cells) };
                for (const line of it.row.lines) copy = { ...copy, lines: [...copy.lines, { ...line, key: mintLineKey(copy) }] };
                events.push(variant("insert", { afterRowId: some(it.row.id), row: copy, source: typed }));
                first ??= { id };
                const looseDraft = draftType.type === "Variant";
                const arm = looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).type as string : undefined;
                const inner = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
                let draft = emptied(withIdentity(inner, id));
                if (childField !== undefined && it.kind === "group" && loose) {
                    draft = { ...draft, [childField]: (draft[childField] as Record<string, unknown>[]).map((c) => withIdentity(c, mintLineId())) };
                }
                const final = looseDraft ? variant(arm!, draft) : draft;
                draftEdits.set(id, (v) => ({ ...v, draft: final, wire: copy }));
            }
            if (events.length === 0) return false;
            const recorded = recordGesture(events, undefined, "insert", draftEdits);
            // A host's ring lands on its column in the first copy, once the body holds it — opening where the host edits
            // it, as a host's Add's does (#1534).
            if (recorded && options?.ring !== undefined && first !== undefined) pendingInsertFocus.current = { ...first, edit: true, key: options.ring };
            return recorded;
        } catch (error) {
            failed(error);
            return false;
        }
    }, [canEdit, editingState.available, value.editing.idField, takenKeys, mintAmong, failed, rowAt, canInsertRows, canInsertGroups, structOf, versionOf, loose, mintLineId, draftType, childField, recordGesture, layerRef, pendingInsertFocus]);
    const addLine = useCallback((bandR: number) => {
        const it = rowAt(bandR);
        if (it === undefined || it.kind !== "group") return;
        insertWhenClosed({ kind: "row", anchor: { entry: it.row.id, tail: true, side: "before" } });
    }, [rowAt, insertWhenClosed]);
    const removeGroup = useCallback((bandR: number) => {
        const it = rowAt(bandR);
        if (it === undefined || it.kind !== "group" || !canEdit || !editingState.available || !capabilities.removeGroups) return;
        gestureEvents.current = [];
        const base = layerRef.current;
        const next: LocalLayer = { ...base, removed: new Set([...base.removed, it.row.id]) };
        layerRef.current = next;
        setLayer(() => next);
        emitEdit(variant("remove", { rowIds: [it.row.id] }));
        try { recordGesture(gestureEvents.current); }
        catch (error) { failed(error); }
        finally { gestureEvents.current = []; }
        dispatchStore({ t: "patch", patch: { selEnd: null, msg: { id: "deleted", n: 1, what: "groups", noun: declaredNoun?.singular, nouns: declaredNoun?.plural, again: false } } });
    }, [rowAt, canEdit, editingState.available, capabilities, setLayer, emitEdit, recordGesture, failed, declaredNoun, dispatchStore, gestureEvents, layerRef]);
    // ── A host's own Add and Delete (#1533) ───────────────────────────────
    // Read through refs, so what a host's chrome holds of them never changes: each acts on the sheet as it stands.
    /** Adds a row first in the rows — its key's place, where the rows are keyed — the rail's search cleared first, so it is never hidden. */
    const addEntry = (column?: string) => {
        if (chrome !== undefined && narrowing !== undefined && narrowingQuery(narrowing).trim() !== "") {
            // The sheet's own write: the ring goes to the new row, never back to the top.
            const cleared = clearSearch(narrowing);
            expectedNarrowing.current = cleared;
            writeNarrowing(chrome, cleared);
        }
        insertWhenClosed({ kind: "row", anchor: { entry: rows[0]?.id, side: "before" } }, undefined, column);
    };
    const addRef = useRef(addEntry);
    addRef.current = addEntry;
    const addRow = useCallback((column?: string) => addRef.current(column), []);
    /**
     * Removes the rows of these ids the sheet draws — and those it no longer draws that a host held while it did (#1579)
     * — as one transaction: a new row is simply dropped, and the ring goes with its row.
     */
    const executeRemoval = (ids: readonly string[], held?: ReadonlyMap<string, EntryVersion>) => {
        if (!canEdit || !editingState.available || !capabilities.removeRows) return;
        const drawn = new Set(rows.map((row) => row.id));
        const gone = ids.filter((id) => drawn.has(id) || held?.has(id) === true);
        if (gone.length === 0) return;
        gestureEvents.current = [];
        const base = layerRef.current;
        const next: LocalLayer = { ...base, removed: new Set([...base.removed, ...gone]) };
        layerRef.current = next;
        setLayer(() => next);
        emitEdit(variant("remove", { rowIds: gone }));
        let recorded = false;
        try { recorded = recordGesture(gestureEvents.current, undefined, undefined, undefined, undefined, undefined, undefined, held); }
        catch (error) { failed(error); }
        finally { gestureEvents.current = []; }
        if (!recorded) return;
        const now = uiRef.current;
        const ring = now.ringless ? undefined : idAt(now.sel.r);
        dispatchStore({ t: "patch", patch: {
            selEnd: null, ...(ring !== undefined && gone.includes(ring) ? { ringless: true } : {}),
            msg: { id: "deleted", n: gone.length, what: "rows", noun: declaredNoun?.singular, nouns: declaredNoun?.plural, again: false },
        } });
    };
    const removalRef = useRef(executeRemoval);
    removalRef.current = executeRemoval;
    // A removal waits for an open editor to commit, as an insertion does.
    const pendingRemoval = useRef<{ ids: readonly string[]; held: ReadonlyMap<string, EntryVersion> | undefined } | undefined>(undefined);
    const removeRowsById = useCallback((ids: readonly string[], held?: ReadonlyMap<string, EntryVersion>) => {
        if (uiRef.current.edit === null) { removalRef.current(ids, held); return; }
        pendingRemoval.current = { ids, held };
        dispatch({ t: "editor.blur" });
    }, [dispatch, uiRef]);
    useLayoutEffect(() => {
        const pending = pendingRemoval.current;
        if (ui.edit !== null || pending === undefined) return;
        pendingRemoval.current = undefined;
        removalRef.current(pending.ids, pending.held);
    }, [ui.edit, store.fxSeq]);
    // What a host holds of a row it may remove once the sheet no longer draws it (#1579): its version as it stands now —
    // the session's, else what the record holds — or none for a row not read.
    const holdNow = (id: string): EntryVersion | undefined => {
        const version = versionOf(id);
        return version === undefined || (version.draft === undefined && version.wire === undefined) ? undefined : version;
    };
    const holdRef = useRef(holdNow);
    holdRef.current = holdNow;
    const holdRow = useCallback((id: string) => holdRef.current(id), []);
    // A column, or a band's cell, by its key at a row.
    const columnAt = useCallback((r: number, key: string): SheetColumnMeta | undefined => {
        const it = rowAt(r);
        return it?.kind === "group" ? group?.cells.get(key) : allColumns.byKey.get(key);
    }, [rowAt, group, allColumns]);
    const inspectCellAt = useCallback((r: number, key: string): SheetCellValue | undefined => {
        const it = rowAt(r);
        return it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row.cells.get(key) : undefined;
    }, [rowAt]);
    const inspectWritableAt = useCallback((r: number, key: string): boolean => {
        const it = rowAt(r);
        const meta = columnAt(r, key);
        return meta !== undefined && it !== undefined && (it.kind === "real" || it.kind === "group") && cellWritable(meta, it.row.cells);
    }, [rowAt, columnAt]);
    // What a row's drafts changed, as the grid tints its cells by it: a line's and a band's are their group's.
    const changesAt = useCallback((r: number): SheetRowChanges | undefined => {
        const it = rowAt(r);
        return it?.kind === "real" && it.group === undefined ? changesOf(it.row.id, it.row) : undefined;
    }, [rowAt, changesOf]);
    const unitAt = useCallback((r: number, key: string): string | undefined => {
        const meta = columnAt(r, key);
        const it = rowAt(r);
        const driverKey = driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn);
        return meta === undefined ? undefined : unitOf(meta, driverKey);
    }, [columnAt, rowAt, driverColumn]);
    const inspectLevelAt = useCallback((r: number, key: string) => {
        const meta = columnAt(r, key);
        return meta === undefined ? undefined : levelAt(r, meta);
    }, [columnAt, levelAt]);
    const allowedAt = useCallback((r: number, key: string): ReadonlySet<string> | undefined => {
        const meta = columnAt(r, key);
        return meta === undefined ? undefined : allowedFor(r, meta);
    }, [columnAt, allowedFor]);
    const drawCell = useCallback((r: number, key: string): ReactNode => {
        const it = rowAt(r);
        const meta = columnAt(r, key);
        if (it === undefined || meta === undefined || (it.kind !== "real" && it.kind !== "group")) return null;
        const cell = it.row.cells.get(meta.key);
        const member = namesMember(meta) && cell !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
        return (
            <SheetCellContent styles={styles} meta={meta} cell={cell} rowBlank={false} unit={unitAt(r, key)} member={member} ghost={undefined}
                link={meta.kind === "link" && it.kind === "real" ? linkCellCtx(it.row, meta) : undefined} />
        );
    }, [rowAt, columnAt, registers, styles, unitAt, linkCellCtx]);
    const seekSearch = seek.search;
    const goToIssue = useCallback((issue: EditIssue) => {
        onIssue(issue);
        // On a paged sheet the issue's row may not be in yet: its key is sought, and the row lands where the key
        // search's would — under the lens, where the narrowing keeps it (#1349).
        const resident = body.some((it) => (it.kind === "group" ? stringEqual(it.row.id, issue.entry)
            : it.kind === "real" ? stringEqual(it.group?.row.id ?? it.row.id, issue.entry) : false));
        if (resident || seekSearch === undefined) return;
        // A seek takes the key's `.east` text: a String key's is quoted, any other key's is its id.
        const literal = keyIsText ? printString(issue.entry) : issue.entry;
        void seekSearch.find({ key: literal }).then((range) => {
            if (!range.found) return;
            // A row the narrowing hides, known so (the hidden pick): the filters hiding it cleared — those e3 named, else
            // every one — and the issue's cell gone to once the narrowing they leave draws its row. Else the row is sought
            // where it is, and a jump that finds it hidden reveals it so.
            const state = rowsPick.rows.stateOf(issue.entry);
            if (state !== undefined && state.hidden) { revealRef.current(range.row, issue.entry, true); return; }
            issueSought.current = { entry: issue.entry, row: range.row };
            seekSearch.jump(range.row);
        }).catch(() => { /* superseded or cleared */ });
    }, [onIssue, body, seekSearch, keyIsText, rowsPick, issueSought, revealRef]);
    // A conflict's row as the sheet shows it, in the cards of the history's popover: its first text column's text —
    // `Panel cutting` — where it holds one, else its key. Read as the popover draws, so the history item is the same
    // while the rows move.
    const namingNow = useRef({ rows, columns });
    namingNow.current = { rows, columns };
    const rowWhere = useCallback((issue: EditIssue) => {
        const { rows: shown, columns: drawn } = namingNow.current;
        return rowNameOf(shown.find((r) => stringEqual(r.id, issue.entry)), drawn) ?? issue.entry;
    }, []);
    // A conflict's value as its column writes it — a date in the column's format — where the field it is in is a
    // column's own; else as the card reads it.
    const conflictValue = useCallback((_issue: EditIssue, path: PatchPath, value: unknown, type: EastType | undefined) => {
        let field: string | undefined;
        for (const step of path) {
            if (step.kind !== "field") continue;
            if (field !== undefined) return undefined;
            field = step.name;
        }
        const meta = field === undefined ? undefined : namingNow.current.columns.byKey.get(field);
        const cell = meta === undefined ? undefined : cellOfValue(value, type);
        return meta === undefined || cell === undefined ? undefined : cellText(cell, meta, words);
    }, [words]);
    // The issues' rows the narrowing may hide — those the body does not draw — asked of e3 as the Issues tab lists them,
    // and what an issue's line says of one it hides, in the sheet's words for an issue (the hidden pick).
    const drawnEntries = useMemo(() => {
        const ids = new Set<string>();
        for (const it of body) {
            if (it.kind === "group") ids.add(it.row.id);
            else if (it.kind === "real") ids.add(it.group?.row.id ?? it.row.id);
        }
        return ids;
    }, [body]);
    const askHidden = useCallback((issues: readonly EditIssue[]) => {
        if (!lensWanted) return;
        askHiding(issues.flatMap((issue) => (drawnEntries.has(issue.entry) ? [] : [{ pick: rowsPick, id: issue.entry }])), false);
    }, [lensWanted, drawnEntries, rowsPick]);
    const hiddenNote = useCallback((issue: EditIssue): string | undefined => {
        if (!lensWanted || drawnEntries.has(issue.entry)) return undefined;
        const state = rowsPick.rows.stateOf(issue.entry);
        if (state === undefined || !state.hidden) return undefined;
        return hiddenLine([{ pick: rowsPick, answer: state.answer }], words, { hiddenByFilters: words.m.inspectorIssueHidden, hiddenBy: words.m.inspectorIssueHiddenBy });
    }, [lensWanted, drawnEntries, rowsPick, words]);
    const issueList = useMemo((): readonly EditIssue[] => {
        const ready = session.readiness;
        return [...(ready.type === "ready" ? [] : ready.value), ...session.issues];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, readiness, draftVersion]);
    // The footer's note of an issue gone to goes once the session no longer holds the issue: a conflict chosen, a
    // check met, a refusal answered. The session is mutable: draftVersion moves with its conflicts.
    const noted = ui.msg?.id === "issue" ? ui.msg.issue : undefined;
    useEffect(() => {
        if (noted === undefined || issueList.some((issue) => issueEqual(issue, noted))) return;
        for (const entry of session.conflicts.values()) {
            if (stringEqual(entry.id, noted.entry) && entry.points.some((point) => issueEqual(session.conflictIssue(entry.id, point), noted))) return;
        }
        dispatchStore({ t: "patch", patch: { msg: null } });
    }, [noted, issueList, session, draftVersion, dispatchStore]);
    const kindOf = useCallback((issue: EditIssue): "incomplete" | "invalid" => {
        const ready = session.readiness;
        // The very issue the readiness raised (identity, not equality): an Apply's look alike and are not its.
        return ready.type !== "ready" && ready.value.some((raised) => Object.is(raised, issue)) ? kindOfIssue(issue, ready) : "invalid";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks changes within the stable transaction session.
    }, [session, readiness, draftVersion]);
    // Where an issue's row stands among the rows drawn (#1534), as Go to issue finds it: a row or a band by its entry, a
    // line by its place in its group — none where the body does not draw it.
    const placeOfIssue = useCallback((issue: EditIssue): SheetInspectPlace | undefined => {
        const line = getSomeorUndefined(issue.row);
        const index = line === undefined
            ? body.findIndex((item) => (item.kind === "real" || item.kind === "group") && stringEqual(item.row.id, issue.entry))
            : body.findIndex((item) => item.kind === "real" && item.group !== undefined && stringEqual(item.group.row.id, issue.entry) && item.group.index === Number(line));
        const r = index < 0 ? undefined : rowSpace.rowOf[index];
        return r === undefined || r < 0 ? undefined : placeAt(r);
    }, [body, rowSpace, placeAt]);
    const inspect = useMemo((): SheetInspect => ({
        selected, targetAt,
        writable: canEdit && editingState.available,
        can: {
            insertRows: canEdit && canInsertRows && editingState.available,
            insertGroups: canEdit && canInsertGroups && editingState.available,
            removeRows: canEdit && capabilities.removeRows && editingState.available,
            removeGroups: canEdit && capabilities.removeGroups && editingState.available,
        },
        counts: { rows: wholeCount, pending: session.pending, issues: issueList.length },
        issues: issueList,
        kindOf,
        write: inspectWrite, editInSheet, remove: removeRows, duplicate, addLine, removeGroup, goToIssue, hiddenNote, askHidden, placeOf: placeOfIssue,
        columnAt, cellAt: inspectCellAt, writableAt: inspectWritableAt, changesAt, unitAt, levelAt: inspectLevelAt, allowedAt, drawCell, drawAction,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftVersion tracks the session's pending count.
    }), [selected, targetAt, canEdit, editingState.available, canInsertRows, canInsertGroups, capabilities, wholeCount, session, issueList, kindOf, inspectWrite, editInSheet, removeRows, duplicate, addLine, removeGroup, goToIssue, hiddenNote, askHidden, placeOfIssue, columnAt, inspectCellAt, inspectWritableAt, changesAt, unitAt, inspectLevelAt, allowedAt, drawCell, drawAction, draftVersion]);
    return { addRow, conflictValue, goToIssue, holdRow, inspect, removeRowsById, rowWhere, versionOf };
}

/** What {@link useSheetInspector} gives the parts after it. */
export type SheetInspector = ReturnType<typeof useSheetInspector>;
