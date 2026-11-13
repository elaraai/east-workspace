/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drag and drop: each drop planned from the rows as they stand and run as one transaction — a template inserted, a card's
 * cells set, a row, a line or a group moved — a library card's ⏎, and a phone's Library.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { StringType, equalFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { useDragTarget, type DragEventValue, type DragTargetConfig } from "@elaraai/east-ui-components";
import { NULL_CELL, TITLE_KEY, cellWritable } from "./model.js";
import type { EntryVersion, Origin, Placement } from "./transactions.js";
import { cardSource, dropCaption, dropName, dropRefusal, dropRowOf, locateDrop, payloadSource, planBelow, planDrop, readDropRow, type SheetDropContext, type SheetDropMark, type SheetDropPlan, type SheetDropRow, type SheetDropSource } from "./drop.js";
import { pageWindow } from "./Pager.js";
import type { DraftEdit } from "./use-editing.js";
import type { SheetLineValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetWrites } from "./use-writes.js";
import type { SheetCopilot } from "./use-copilot.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetGestures } from "./use-gestures.js";
import type { SheetRowParts } from "./use-row-parts.js";
import type { SheetInspector } from "./use-inspector.js";
import type { SheetPhoneLibrary } from "./parts.js";
import { mintLineKey } from "./local-rows.js";

const stringEqual = equalFor(StringType);

const cellEqual = equalFor(Sheet.Types.Cell);

/**
 * Plans and runs the sheet's drops (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetWrites - The cell writes, the removal and the proposals' inserts
 * @param sheetCopilot - What asks the copilot to run
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @param sheetRowParts - The rows' drop, seams, inserts and runs
 * @param sheetInspector - The inspector's reads and gestures, and a host's Add and Delete
 * @returns The library's ⏎ and the phone's Library
 */
export function useSheetDrops(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetWrites: SheetWrites, sheetCopilot: SheetCopilot, sheetEffects: SheetEffects,
    sheetGestures: SheetGestures, sheetRowParts: SheetRowParts, sheetInspector: SheetInspector) {
    const {
        allColumns, canInsertGroups, canInsertRows, capabilities, copilotOn, group, keyed, loose, noun, pagerRef,
        triggers, words,
    } = sheetDecode;
    const { canEdit, childField, dispatchStore, draftType, editingState, recordGesture, rows, ui } = sheetSession;
    const { blankLineRowOf, body, idAt, rowAt, rowCount, rowOf, rowSpace } = sheetBody;
    const { uiRef, viewportRef } = sheetMachine;
    const { failed, gestureEvents, writeCells } = sheetWrites;
    const { requestRun } = sheetCopilot;
    const { cardRef } = sheetEffects;
    const { anchorFor, insertWhenClosed, pendingInsertFocus } = sheetGestures;
    const { dragActive, dropApi, dropHost, dropOn } = sheetRowParts;
    const { versionOf } = sheetInspector;
    // ── Drag and drop: the plans (#1187) ──────────────────────────────────
    // Every drop is planned (`drop.ts`) from the rows as they stand — the
    // veto, the ghost's caption, its name and the drop itself read the same
    // plan — and runs as one transaction: a template's insertion, a card's
    // cells, a move. A move is the entry's placement, or its groups' lines
    // rewritten, the wire and the draft side by side.
    const tailRow = useMemo(() => {
        const r = rowSpace.bodyIndexOf.findIndex((bi) => { const it = body[bi]; return it !== undefined && it.kind === "blank" && it.group === undefined; });
        return r < 0 ? undefined : r;
    }, [rowSpace, body]);
    const dropCtx = useMemo((): SheetDropContext => ({
        rows, rowAt, rowOf, blankLineRowOf, tailRow, rowCount,
        grouped: group !== undefined, loose, keyed,
        writable: canEdit && editingState.available,
        can: { insertRows: canInsertRows, insertGroups: canInsertGroups, moveRows: capabilities.moveRows.type, moveGroups: capabilities.moveGroups },
        columnAt: (band, key) => (band ? group?.cells.get(key) : allColumns.byKey.get(key)),
        // A card's cell on the row it lands on: its column writes, and no mark there locks it (#1560).
        writableAt: (r, band, key) => {
            const meta = band ? group?.cells.get(key) : allColumns.byKey.get(key);
            const it = rowAt(r);
            return meta !== undefined && cellWritable(meta, it !== undefined && (it.kind === "real" || it.kind === "group") ? it.row.cells : undefined);
        },
        anchorFor,
    }), [rows, rowAt, rowOf, blankLineRowOf, tailRow, rowCount, group, loose, keyed, canEdit, editingState.available, canInsertRows, canInsertGroups, capabilities, allColumns, anchorFor]);
    // A drop row's text, read once: the rows print their own, so the same few come back.
    const dropRows = useRef(new Map<string, SheetDropRow | undefined>()).current;
    const readRow = useCallback((text: string): SheetDropRow | undefined => {
        if (!dropRows.has(text)) {
            if (dropRows.size > 4096) dropRows.clear();
            dropRows.set(text, readDropRow(text));
        }
        return dropRows.get(text);
    }, [dropRows]);
    /** A drop's plan, at a coordinate the rows made. */
    const planAt = (source: SheetDropSource, at: { row: string; slot: string }): SheetDropPlan => {
        const row = readRow(at.row);
        return row === undefined ? { kind: "refused", why: { why: "gone" } } : planDrop(source, row, at.slot, dropCtx);
    };
    /** What a completed drag, or a candidate, carries, and where it lands — `undefined` for one the sheet did not make. */
    const readEvent = (event: DragEventValue): { source: SheetDropSource; at: { row: string; slot: string } } | undefined => {
        if (dropHost === undefined) return undefined;
        if (event.type === "add") {
            const source = cardSource(dropHost, event.value.from.library, event.value.from.key);
            return source === undefined ? undefined : { source, at: event.value.into };
        }
        if (event.type === "move") {
            const row = readRow(event.value.from.row);
            return row === undefined ? undefined : { source: { kind: "move", row }, at: event.value.to };
        }
        return undefined;
    };
    // The row the seam line runs along, and its edge: written, never rendered, as a drag rests (the Plan's landing band's way).
    const markedSeam = useRef<HTMLElement | null>(null);
    const markSeam = (mark: SheetDropMark | undefined) => {
        const el = mark === undefined ? null
            : cardRef.current?.querySelector<HTMLElement>(`[data-row="${mark.r}"]:not([data-slot=stickyBand]):not([data-slot=stickyLine])`) ?? null;
        if (markedSeam.current !== null && markedSeam.current !== el) markedSeam.current.removeAttribute("data-drop-seam");
        markedSeam.current = el;
        if (el !== null && mark !== undefined) el.setAttribute("data-drop-seam", mark.edge);
    };
    // A drag over: no row keeps a mark.
    useEffect(() => {
        if (dragActive) return;
        markedSeam.current?.removeAttribute("data-drop-seam");
        markedSeam.current = null;
        for (const el of cardRef.current?.querySelectorAll("[data-drop-at]") ?? []) el.removeAttribute("data-drop-at");
    }, [dragActive, cardRef]);
    /** A group entry's version with its lines rewritten: the wire lines and the draft's children, side by side. */
    const withLines = useCallback((version: EntryVersion, edit: (lines: SheetLineValue[], kids: unknown[]) => void): EntryVersion => {
        const wire = version.wire;
        if (wire === undefined || version.draft === undefined || childField === undefined) return version;
        const looseDraft = draftType.type === "Variant";
        const outer = (looseDraft ? (version.draft as ValueTypeOf<typeof draftType>).value : version.draft) as Record<string, unknown>;
        const lines = [...wire.lines];
        const kids = [...(outer[childField] as unknown[])];
        edit(lines, kids);
        const next = { ...outer, [childField]: kids };
        return { ...version, wire: { ...wire, lines }, draft: looseDraft ? variant("group", next) : next };
    }, [childField, draftType]);
    /** A gesture of draft edits alone — a move — recorded as one transaction. */
    const recordEdits = useCallback((origin: Origin, edits: ReadonlyMap<string, DraftEdit>): boolean => {
        try { return recordGesture([], undefined, origin, edits); }
        catch (error) {
            failed(error);
            return false;
        }
    }, [recordGesture, failed]);
    /**
     * Runs a drop's plan as one transaction (SB39, SB40, SB44, SB61), the row
     * it made, set or moved selected once the body holds it.
     *
     * @returns Whether it changed anything
     */
    const runDrop = useCallback((plan: SheetDropPlan): boolean => {
        switch (plan.kind) {
            case "refused":
            case "stay":
                return false;
            case "insert":
                return insertWhenClosed(plan.request, { seeds: plan.template.seeds, origin: "drop" });
            case "set": {
                const item = rowAt(plan.r);
                if (item === undefined || (item.kind !== "real" && item.kind !== "group") || plan.card.sets.size === 0) return false;
                gestureEvents.current = [];
                let recorded = false;
                try {
                    writeCells([...plan.card.sets].map(([key, cell]) => ({ r: plan.r, c: -1, key, cell })), "typed");
                    recorded = recordGesture(gestureEvents.current, undefined, "drop");
                } catch (error) {
                    failed(error);
                } finally {
                    gestureEvents.current = [];
                }
                if (!recorded) return false;
                const keys = [...plan.card.sets.keys()];
                // The copilot asks again for a row whose trigger column the card set, as typing in it does.
                if (copilotOn && keys.some((key) => triggers.size === 0 || triggers.has(key))) {
                    const id = idAt(plan.r);
                    if (id !== undefined) requestRun(id, 0);
                }
                const lg = item.kind === "real" ? item.group : undefined;
                pendingInsertFocus.current = { id: lg !== undefined ? lg.row.id : item.row.id, ...(lg !== undefined ? { child: lg.key } : {}), edit: false, key: keys[0] };
                return true;
            }
            case "moveEntry": {
                const placement: Placement = some(variant("ordered", plan.to === "end" ? variant("end", null) : variant(plan.to.side, plan.to.anchor)));
                const recorded = recordEdits("move", new Map([[plan.id, (version: EntryVersion): EntryVersion => ({ ...version, place: placement })]]));
                if (recorded) pendingInsertFocus.current = { id: plan.id, edit: false };
                return recorded;
            }
            case "moveLine": {
                const { from, to } = plan;
                const source = versionOf(from.group);
                const at = source?.wire?.lines.findIndex((line) => line.key === from.key) ?? -1;
                if (source === undefined || source.wire === undefined || at < 0) return false;
                const edits = new Map<string, DraftEdit>();
                let key = from.key;
                if (to.group === from.group) {
                    // Within its group: out of its slot, into the one it was dropped at.
                    edits.set(from.group, (version) => withLines(version, (lines, kids) => {
                        const i = lines.findIndex((line) => line.key === from.key);
                        if (i < 0) return;
                        const [line] = lines.splice(i, 1);
                        const [kid] = kids.splice(i, 1);
                        const slot = to.index > i ? to.index - 1 : to.index;
                        lines.splice(slot, 0, line!);
                        kids.splice(slot, 0, kid);
                    }));
                } else {
                    // Into another group: out of its own, into the other under a key of the other's — its draft with it.
                    const target = versionOf(to.group)?.wire;
                    const outer = (draftType.type === "Variant" ? (source.draft as ValueTypeOf<typeof draftType> | undefined)?.value : source.draft) as Record<string, unknown> | undefined;
                    const kid = childField === undefined ? undefined : (outer?.[childField] as unknown[] | undefined)?.[at];
                    if (target === undefined || kid === undefined) return false;
                    key = mintLineKey(target);
                    const moved: SheetLineValue = { ...source.wire.lines[at]!, key };
                    edits.set(from.group, (version) => withLines(version, (lines, kids) => {
                        const i = lines.findIndex((line) => line.key === from.key);
                        if (i < 0) return;
                        lines.splice(i, 1);
                        kids.splice(i, 1);
                    }));
                    edits.set(to.group, (version) => withLines(version, (lines, kids) => {
                        lines.splice(Math.min(to.index, lines.length), 0, moved);
                        kids.splice(Math.min(to.index, kids.length), 0, kid);
                    }));
                }
                const recorded = recordEdits("move", edits);
                if (recorded) pendingInsertFocus.current = { id: to.group, child: key, edit: false };
                return recorded;
            }
        }
    }, [insertWhenClosed, rowAt, writeCells, recordGesture, failed, copilotOn, triggers, idAt, requestRun, recordEdits, versionOf, withLines, draftType, childField, gestureEvents, pendingInsertFocus]);
    dropApi.current = dropHost === undefined ? undefined : {
        canDrop: (event) => {
            const read = readEvent(event);
            return read !== undefined && planAt(read.source, read.at).kind !== "refused";
        },
        caption: (coord, payload) => {
            const source = payloadSource(dropHost, payload);
            return source === undefined ? undefined : dropCaption(planAt(source, coord), dropCtx, words, noun);
        },
        name: (coord, payload) => {
            const source = payloadSource(dropHost, payload);
            const row = readRow(coord.row);
            if (source === undefined || row === undefined) return "";
            return dropName(planAt(source, coord), locateDrop(row, dropCtx)?.r, dropCtx, words, noun);
        },
        hover: (el, coord, payload) => {
            const source = payloadSource(dropHost, payload);
            if (source === undefined) return;
            const plan = planAt(source, coord);
            el.setAttribute("data-drop-at", plan.kind === "set" ? "row" : "seam");
            markSeam(plan.kind === "set" || plan.kind === "refused" ? undefined : plan.mark);
        },
        drop: (event) => {
            const read = readEvent(event);
            return read !== undefined && runDrop(planAt(read.source, read.at));
        },
    };
    // The surface the rows register on, taking the library's templates and every author's tab that drops.
    const dropTarget = useMemo((): DragTargetConfig | null => (dropHost === undefined || !dropOn ? null : {
        id: dropHost.surface,
        sources: [...(dropHost.templates !== undefined ? [dropHost.templates.library] : []), ...dropHost.tabs.keys()],
        kinds: { add: true, move: true },
        onDrag: (event) => dropApi.current?.drop(event) ?? false,
    }), [dropHost, dropOn, dropApi]);
    useDragTarget(dropTarget);
    // A library card's ⏎ (SB45): the drop below the ring's row — or, where it is refused, why, in the footer. Before the
    // ring is placed there is no row to drop below (#1531).
    const enterCard = (library: string, key: string) => {
        if (dropHost === undefined) return;
        const source = cardSource(dropHost, library, key);
        const item = uiRef.current.ringless ? undefined : rowAt(uiRef.current.sel.r);
        const row = item === undefined ? undefined : dropRowOf(item);
        if (source === undefined || row === undefined) return;
        const plan = planBelow(source, row, dropCtx);
        if (plan.kind !== "refused") {
            runDrop(plan);
            return;
        }
        const word = dropRefusal(plan, dropCtx, words, noun);
        if (word !== undefined) dispatchStore({ t: "patch", patch: { msg: { id: "dropRefused", word } } });
    };
    const enterRef = useRef(enterCard);
    enterRef.current = enterCard;
    const enter = useCallback((library: string, key: string) => enterRef.current(library, key), []);
    // A phone's Library (SH11): a tap on an author's card is its drop on the row it lands on — a group's card on the ring's
    // band, or the band of the line the ring is on; a tap on a template its ⏎. Before the ring is placed no card has a
    // row to land on, and the view asks for one (#1531).
    const cardRing = ui.ringless ? undefined : ui.sel.r;
    const cardTargetR = (lands: "row" | "group"): number | undefined => {
        if (cardRing === undefined) return undefined;
        const item = rowAt(cardRing);
        if (lands === "row") return item?.kind === "real" ? cardRing : undefined;
        if (item?.kind === "group") return cardRing;
        return item?.kind === "real" && item.group !== undefined ? rowOf(item.group.row.id) : undefined;
    };
    const phoneLibrary: SheetPhoneLibrary = {
        targetOf: (library) => {
            const tab = dropHost?.tabs.get(library);
            const r = tab === undefined ? cardRing : cardTargetR(tab.lands);
            const item = r === undefined ? undefined : rowAt(r);
            if (item === undefined || (item.kind !== "real" && item.kind !== "group")) return undefined;
            if (item.kind === "group") {
                const title = item.row.cells.get(TITLE_KEY);
                return title?.type === "String" && title.value !== "" ? `${item.row.id} · ${title.value}` : item.row.id;
            }
            const lg = item.group;
            return words.m.inspectorWhat({ what: lg !== undefined ? "line" : "row", number: String(lg !== undefined ? lg.number : item.position + 1), title: lg?.row.id, noun: noun.singular });
        },
        holds: (library, key) => {
            const tab = dropHost?.tabs.get(library);
            const card = tab?.cards.get(key);
            const r = tab === undefined ? undefined : cardTargetR(tab.lands);
            const item = r === undefined ? undefined : rowAt(r);
            if (card === undefined || card.sets.size === 0 || item === undefined || (item.kind !== "real" && item.kind !== "group")) return false;
            for (const [k, cell] of card.sets) if (!cellEqual(item.row.cells.get(k) ?? NULL_CELL, cell)) return false;
            return true;
        },
        tap: (library, key) => {
            const tab = dropHost?.tabs.get(library);
            if (dropHost === undefined || tab === undefined) { enterCard(library, key); return; }
            const source = cardSource(dropHost, library, key);
            const r = cardTargetR(tab.lands);
            const item = r === undefined ? undefined : rowAt(r);
            const row = item === undefined ? undefined : dropRowOf(item);
            if (source === undefined || row === undefined) return;
            const plan = planBelow(source, row, dropCtx);
            if (plan.kind !== "refused") {
                runDrop(plan);
                return;
            }
            const word = dropRefusal(plan, dropCtx, words, noun);
            if (word !== undefined) dispatchStore({ t: "patch", patch: { msg: { id: "dropRefused", word } } });
        },
        goToColumn: useCallback((key: string) => {
            const { list, slot, inView } = pagerRef.current;
            const frame = viewportRef.current?.frame;
            const at = list.findIndex((col) => stringEqual(col.key, key));
            if (frame === undefined || at < 0 || slot <= 0) return;
            const first = Math.round(frame.scrollLeft / slot);
            pageWindow(frame, slot, Math.max(0, list.length - inView), at < first ? at : at >= first + inView ? at - inView + 1 : first);
        }, [pagerRef, viewportRef]),
    };
    return { enter, phoneLibrary };
}

/** What {@link useSheetDrops} gives the parts after it. */
export type SheetDrops = ReturnType<typeof useSheetDrops>;
