/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React integration for a sheet's editing — the shared editing session's hook
 * (`useEditSession`, #879) with the sheet's own gestures (its wire edits,
 * composed into one transaction) and its local layer over the resident rows.
 *
 * @packageDocumentation
 */
import { useCallback, useMemo } from "react";
import { OptionType, StringType, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType } from "@elaraai/east-ui/internal";
import { useEditSession } from "../../editing/use-edit-session.js";
import { authorReadiness } from "./readiness.js";
import { prepareCreation } from "./creation.js";
import type { EntryVersion, EntryUpdate, Origin, Placement, SheetTransactions } from "./transactions.js";
import type { SheetEditValue, SheetPagedSourceValue, SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;
const stringEqual = equalFor(StringType);
const encodeWire = encodeBeast2For(Sheet.Types.Row);
const absent: EntryVersion = { draft: undefined, wire: undefined, place: none };
/** A wire row's id — the entry it projects. */
const sheetRowId = (row: SheetRowValue): string => row.id;

/** A projection of the transaction session over currently resident source rows. */
export interface LocalLayer {
    edits: ReadonlyMap<string, SheetRowValue>;
    appended: readonly SheetRowValue[];
    removed: ReadonlySet<string>;
    placements: ReadonlyMap<string, Placement>;
}
export const EMPTY_LAYER: LocalLayer = { edits: new Map(), appended: [], removed: new Set(), placements: new Map() };

/** What {@link useSheetEditing} hands a sheet: its session, the layer over its rows, and its gesture recorder. */
export interface SheetEditingResult {
    /** The session. */
    session: SheetTransactions;
    /** The session's edits over the resident rows. */
    layer: LocalLayer;
    /** Aggregate a gesture's wire edits into one transaction. */
    record: (events: readonly SheetEditValue[], placements?: ReadonlyMap<string, Placement>, originOverride?: Origin) => void;
    /** Each drafted entry's draft, encoded. */
    drafts: Map<string, Uint8Array>;
    /** Editing is available now. */
    available: boolean;
    /** The session's version. */
    version: number;
}

/**
 * Bind decoded callbacks and retain unresolved requests through remounts.
 *
 * @param editing - The decoded editing declaration
 * @param source - The paged source, on the paged arm
 * @param rows - The source's resident rows
 * @param positions - Each resident row's source position — a failed window before it does not move it (#853)
 * @param storageKey - The view's key
 * @param mint - On a sheet with loose rows between its groups (#846), mints a new line's id field — the field a loose row is identified by
 * @returns The session, its layer and gesture recorder, the drafts, and whether editing is available
 */
export function useSheetEditing(editing: Editing, source: SheetPagedSourceValue | undefined, rows: readonly SheetRowValue[], positions: readonly number[], storageKey: string, mint?: () => string): SheetEditingResult {
    const ready = useMemo(() => authorReadiness(editing, rows, positions, source !== undefined), [editing, rows, positions, source]);
    const { session, observed, draftType, codecs, rowIndex, original, drafts, available, version } =
        useEditSession<SheetRowValue>(editing, source, rows, positions, storageKey, { idOf: sheetRowId, ready });

    /** Aggregate the renderer's writes into one transaction at the effect boundary. */
    const record = useCallback((events: readonly SheetEditValue[], placements?: ReadonlyMap<string, Placement>, originOverride?: Origin) => {
        if (!events.length || !observed || !session.writable) return;
        session.observeBase(observed.base);
        const updates = new Map<string, EntryUpdate>();
        const inputs = new Map<string, SheetRowValue>();
        let origin: Origin = "typed";
        const update = (id: string, row: SheetRowValue | undefined, placement?: Placement) => {
            const before = updates.get(id)?.before ?? original(id);
            const current = updates.get(id)?.after ?? before;
            const prepared = row === undefined ? undefined : prepareCreation(row, current, inputs.get(id), placement ?? current.place, editing, draftType, mint);
            if (row !== undefined) inputs.set(id, row);
            const after: EntryVersion = prepared === undefined ? absent : {
                draft: codecs.decodeDraft(editing.decode(encodeWire(prepared.row), prepared.draft === undefined ? none : some(codecs.encodeDraft(prepared.draft)), prepared.previous === undefined ? none : some(encodeWire(prepared.previous)))),
                wire: prepared.row, place: placement ?? current.place,
            };
            updates.set(id, { id, before, after });
        };
        for (const event of events) {
            switch (event.type) {
                case "remove": origin = "remove"; for (const id of event.value.rowIds) update(id, undefined); break;
                case "insert": {
                    origin = event.value.source.type;
                    const place: Placement = placements?.get(event.value.row.id) ?? (editing.keyed ? some(variant("keyOrder", null)) : some(variant("ordered", event.value.afterRowId.type === "some" ? variant("after", event.value.afterRowId.value) : variant("end", null))));
                    update(event.value.row.id, event.value.row, place); break;
                }
                case "lineRemove": origin = "remove"; update(event.value.rowId, event.value.row); break;
                default: origin = event.value.source.type; update(event.value.rowId, event.value.row);
            }
        }
        const gestureOrigin = originOverride ?? origin;
        session.record([...updates.values()], gestureOrigin, gestureOrigin === "insert" ? "Insert row" : origin === "pasted" ? "Paste cells" : origin === "remove" ? "Remove rows" : origin === "pattern" ? "Accept proposed rows" : "Edit cells");
    }, [session, observed, original, codecs, editing, draftType, mint]);
    const layer = useMemo<LocalLayer>(() => {
        const edits = new Map<string, SheetRowValue>();
        const appended: SheetRowValue[] = [];
        const removed = new Set<string>();
        const placements = new Map<string, Placement>();
        const samePlace = equalFor(OptionType(Sheet.Types.EntryPlacement));
        for (const [id, entry] of session.entries) {
            const before = session.originals.get(id) ?? absent;
            const same = codecs.draftEqual(before.draft === undefined ? none : some(before.draft), entry.draft === undefined ? none : some(entry.draft));
            if (same && samePlace(before.place, entry.place)) {
                // The acknowledged source uses fresh positional child keys.
                // Preserve the session's internal keys by position at this
                // checked base, so the next edit still finds its hidden fields.
                const at = rowIndex.get(id);
                const authoritative = at !== undefined ? rows[at] : undefined;
                if (authoritative && entry.wire && authoritative.lines.some((line, i) => !stringEqual(line.key, entry.wire!.lines[i]?.key ?? line.key))) {
                    edits.set(id, { ...authoritative, lines: authoritative.lines.map((line, i) => ({ ...line, key: entry.wire!.lines[i]?.key ?? line.key })) });
                }
                continue;
            }
            if (entry.wire === undefined) { removed.add(id); continue; }
            if (before.draft === undefined) appended.push(entry.wire); else edits.set(id, entry.wire);
            if (!samePlace(before.place, entry.place)) placements.set(id, entry.place);
        }
        return { edits, appended, removed, placements };
        // The version tracks mutations to the session's maps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, codecs, version, rows, rowIndex]);
    return { session, layer, record, drafts, available, version };
}
