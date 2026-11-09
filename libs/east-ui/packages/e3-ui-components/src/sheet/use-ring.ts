/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What is said of the ring's cell: the copilot's fills and proposals for it, its detail, the strip's model, what the grid
 * tells assistive tech of its rows and its active cell, and the footer's key hint.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import { variant } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { cellText, driverKeyOf, resolveMember as resolveRegisterMember, unitOf } from "./model.js";
import { cellDetail } from "./detail.js";
import { parseCell } from "./parse/index.js";
import { usedKeys, narrowVocabulary, resolveMember as resolveVocabMember } from "./link/grammar.js";
import { linkEntryCandidates, grammarLine, membersUnder, type LinkCandidate } from "./link/predict.js";
import { namedCount, arityMeta, type Counted } from "./link/arity.js";
import { wholeRows, nextTargetOf, fillOrder } from "./sheet-state.js";
import { buildStrip, type StripLinkInput, type StripSuggestInput } from "./Strip.js";
import type { SheetCellValue, SheetMemberValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetOpenEditor } from "./use-open-editor.js";

/**
 * Reads what the strip, assistive tech and the footer's hint say of the ring (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetOpenEditor - The styles and the open editor
 * @returns The strip, the grid's counts and active cell, and the hint
 */
export function useSheetRing(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetOpenEditor: SheetOpenEditor) {
    const { columns, driverColumn, gridId, group, hostGrid, noun, pagedSource, registers, today, words } = sheetDecode;
    const { total, ui } = sheetSession;
    const {
        allowedFor, body, colCount, endPosition, idAt, linkColumns, metaAt, parseCtxFor, rowAt, rowOf, wireContextFor,
    } = sheetBody;
    const { ctx } = sheetMachine;
    const { edit, editMeta, editWhenLevel, linkArmed, linkEdit, linkEditCtx } = sheetOpenEditor;
    // ── The copilot's surfaces: the anchor's fills, the next target, the proposal rows ──
    const anchorR = useMemo(() => (ui.sugg !== null ? rowOf(ui.sugg.anchorId) : undefined), [ui.sugg, rowOf]);
    const nextTarget = useMemo(() => nextTargetOf(ui, ctx), [ui, ctx]);
    const suggested = useMemo<StripSuggestInput | undefined>(() => {
        if (edit !== null || ui.sugg === null) return undefined;
        const sugg = ui.sugg;
        const fills = fillOrder(sugg, ctx).map(({ key }) => {
            const f = sugg.fill.get(key)!;
            const meta = columns.byKey.get(key);
            return { key, header: meta?.header ?? key, text: meta !== undefined ? cellText(f.cell, meta, words) : "", meta: f.meta, armed: nextTarget?.key === key };
        });
        const pending = sugg.pending.map((key) => ({ key, header: key === "rows" ? words.m.stripRowsHeader() : columns.byKey.get(key)?.header ?? key }));
        return { fills, rows: sugg.rows.length, rowsMeta: sugg.rows[0]?.meta ?? "", pending };
    }, [edit, ui.sugg, ctx, columns, nextTarget, words]);

    // The resting ring's cell detail (#844): the wanted date behind one that has happened, a column's detail text (with an enum member's own meta beside it).
    // On a host's grid, the cell under the pointer's, else the ring's once it is placed (#1531).
    const previewed = hostGrid !== undefined && ui.hover !== null ? ui.hover : ui.ringless ? undefined : ui.sel;
    const detail = useMemo(() => {
        if (edit !== null || ui.selEnd !== null || previewed === undefined) return undefined;
        const meta = metaAt(previewed.r, previewed.c);
        const it = rowAt(previewed.r);
        if (meta === undefined || it === undefined || it.kind !== "real") return undefined;
        const d = cellDetail(meta, it.row.cells, words);
        if (d === undefined) return undefined;
        const cell = it.row.cells.get(meta.key);
        const member = meta.kind === "enum" && cell !== undefined && cell.type === "String" ? resolveRegisterMember(registers, meta.register, cell.value) : undefined;
        const memberMeta = member !== undefined ? getSomeorUndefined(member.meta) ?? "" : "";
        return { label: meta.header.toUpperCase(), chips: d.chips, meta: d.meta !== "" ? d.meta : memberMeta, keys: words.m.stripKeysDetail({ date: meta.kind === "date" }) };
    }, [edit, ui.selEnd, previewed, metaAt, rowAt, registers, words]);
    const strip = useMemo(() => {
        if (edit === null || editMeta === undefined) return buildStrip({ edit: null, meta: undefined, candidates: undefined, words, today, baseDate: undefined, unit: undefined, customPreview: undefined, suggested, detail });
        const pctx = parseCtxFor(edit.r, editMeta);
        const it = rowAt(edit.r);
        const driverKey = driverKeyOf(it !== undefined && it.kind === "real" ? it.row : undefined, driverColumn);
        let customPreview: SheetCellValue | null | undefined;
        if (editMeta.kind === "custom" && edit.val.trim() !== "") {
            const out = parseCell(editMeta, edit.val, pctx);
            customPreview = out.kind === "cell" ? out.cell : null;
        }
        let link: StripLinkInput | undefined;
        if (linkEdit !== undefined && linkEditCtx !== undefined) {
            const lc = linkColumns.get(editMeta.key);
            const vocab = lc?.vocab;
            // The entry menu and the grammar line offer what the row may take (its options rule).
            const allowedKeys = allowedFor(edit.r, editMeta);
            const offer = vocab !== undefined && allowedKeys !== undefined ? narrowVocabulary(vocab, allowedKeys) : vocab;
            const used = vocab !== undefined ? usedKeys([...linkEdit.groups[0], ...linkEdit.groups[1]], vocab) : new Set<string>();
            let arity = "";
            if (lc?.arity !== undefined && vocab !== undefined && (lc.arity.half.type === "from" ? 0 : 1) === linkEdit.side) {
                let implied: Counted | undefined;
                try {
                    const out = lc.arity.implied(wireContextFor(edit.r));
                    if (out.type === "some") implied = { n: Number(out.value.n), key: out.value.key };
                } catch (err) {
                    console.error(`[Sheet] arity rule failed on column "${editMeta.key}":`, err);
                }
                arity = arityMeta(implied, namedCount(linkEdit.groups[linkEdit.side], vocab), words);
            }
            const predicted = linkEditCtx.predicted(linkEdit.side, linkEdit.groups, edit.val);
            // A counted member is the plan-level answer; naming the members is the
            // schedule-level one — offered as the alternative, never assumed (B§4.5).
            let enumerate: LinkCandidate | undefined;
            const counted = predicted.find((m): m is Extract<SheetMemberValue, { type: "counted" }> => m.type === "counted");
            if (counted !== undefined && vocab !== undefined) {
                const n = Number(counted.value.n);
                const parent = resolveVocabMember(counted.value.key, vocab);
                const free = parent !== undefined ? membersUnder(parent, vocab, used).slice(0, n) : [];
                if (free.length === n && free.length > 0) {
                    enumerate = {
                        label: free.map((m) => m.key).join(", "),
                        meta: words.m.enumerateInstead(),
                        members: free.map((m) => variant("identified", { key: m.key })),
                    };
                }
            }
            const fill = ui.sugg !== null && ui.sugg.anchorId === idAt(edit.r) ? ui.sugg.fill.get(editMeta.key) : undefined;
            link = {
                side: linkEdit.side,
                candidates: linkEditCtx.candidates(edit.val, linkEdit.groups),
                armed: linkArmed,
                entry: offer !== undefined ? linkEntryCandidates(offer, used, words) : [],
                predicted,
                enumerate,
                predictedMeta: fill?.meta ?? "",
                arity,
                grammar: offer !== undefined ? grammarLine(offer, words) : "",
            };
        }
        return buildStrip({
            edit, meta: editMeta, candidates: pctx, words, today,
            baseDate: pctx.baseDate,
            unit: unitOf(editMeta, driverKey),
            customPreview,
            link,
            whenLevel: editWhenLevel,
        });
    }, [edit, editMeta, words, today, parseCtxFor, rowAt, driverColumn, linkEdit, linkEditCtx, linkArmed, linkColumns, wireContextFor, suggested, ui.sugg, idAt, editWhenLevel, allowedFor, detail]);

    const wr = wholeRows(ui, colCount);
    // What the grid tells assistive tech (#860): its rows, counted the way
    // their indices run — on a flat sheet by source position, so the whole
    // source's (-1 until a paged source has counted itself) and the blank
    // padding; on a grouped sheet in body order — the header first — once
    // no run of it is unread, and -1 until then: groups not read yet draw
    // lines no count knows (#1398, CL12); and the ring's cell, which a band's
    // title stands for across its span and under the columns it has no cell
    // in.
    const blankRows = useMemo(() => body.reduce((n, it) => (it.kind === "blank" && it.group === undefined ? n + 1 : n), 0), [body]);
    const unreadRuns = useMemo(() => body.some((it) => it.kind === "band" || it.kind === "failed"), [body]);
    const ariaRowCount = group !== undefined ? (unreadRuns ? -1 : body.length + 1)
        : pagedSource !== undefined && total === undefined ? -1
            : Math.max(total ?? 0, endPosition) + blankRows + 1;
    // No row is the ring's before it is placed (#1531): no phone's column head is marked for it, no hint speaks of it.
    const ringItem = ui.ringless ? undefined : rowAt(ui.sel.r);
    const ringCol = ringItem?.kind === "group" && group !== undefined && (ui.sel.c < group.titleSpan || !group.cells.has(columns.list[ui.sel.c]?.key ?? "")) ? 0 : ui.sel.c;
    const activeCell = !ui.ringless && ringItem !== undefined && colCount > 0 ? `${gridId}-${ui.sel.r}-${ringCol}` : undefined;
    // What a keyboard move's reveal reads (`use-scroll.tsx`): the ring's cell, and the column it sits under.
    const ringCellRef = useRef<{ id: string | undefined; col: number }>({ id: undefined, col: 0 });
    ringCellRef.current = { id: activeCell, col: ringCol };
    const hasFills = ui.sugg !== null && ui.sugg.fill.size > 0;
    const hasRows = ui.sugg !== null && ui.sugg.rows.length > 0;
    const ringKind = ui.ringless ? undefined : ctx.rowKindAt?.(ui.sel.r);
    const ringSubRows = ringKind === "row" ? ctx.lineSubRowsAt?.(ui.sel.r) : undefined;
    const picked = wr !== null ? wr.r1 - wr.r0 + 1 : 0;
    const hint = ui.gsel !== null
        ? words.m.hintProposal()
        : ringKind === "group" && wr === null
            ? words.m.hintBand({ noun: noun.singular })
        // A line with sub rows under it.
        : ringSubRows !== undefined && wr === null && ui.sugg === null
            ? words.m.hintSubRows({ open: ringSubRows.open, n: ringSubRows.count, count: words.number(ringSubRows.count), noun: noun.singular })
        : wr !== null
            ? words.m.hintRows({ n: picked, count: words.number(picked) })
            : hasFills
                ? words.m.hintFills()
                : hasRows
                    ? words.m.hintSuggestedRows()
                    : words.m.hintDefault();
    return {
        activeCell, anchorR, ariaRowCount, hint, nextTarget, previewed, ringCellRef, ringCol, ringItem, strip,
        suggested, unreadRuns, wr,
    };
}

/** What {@link useSheetRing} gives the parts after it. */
export type SheetRing = ReturnType<typeof useSheetRing>;
