/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The open editor: the sheet recipe's styles, and what the editor over the ring's cell shows — its candidates, its ghost,
 * a combobox's menu, a date's field, a link's halves — and what its keys, its picks and its blur tell the machine.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { useSlotRecipe } from "@chakra-ui/react";
import { StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { candidateAt, candidateList, ghostFor, resolveFor } from "./candidates.js";
import { parseDate } from "./parse/date.js";
import { isComboboxKind, type EditorOption, type LinkEditorView } from "./Editor.js";
import type { StripAction } from "./Strip.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { Styles } from "./parts.js";

const stringEqual = equalFor(StringType);

/**
 * Reads what the open editor shows, and handles what it is told (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @returns The styles, the editor's view and its handlers
 */
export function useSheetOpenEditor(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine) {
    const { registers, size, today, words } = sheetDecode;
    const { ui } = sheetSession;
    const { candidateCtxFor, levelAt, linkCtxFor, linkVocabularies, metaAt, parseCtxFor } = sheetBody;
    const { dispatch, uiRef } = sheetMachine;
    // ── Recipe + layout ───────────────────────────────────────────────────
    const recipe = useSlotRecipe({ key: "sheet" });
    const styles = useMemo(() => recipe({ size } as Record<string, unknown>) as unknown as Styles, [recipe, size]);

    // ── The editor and the strip ──────────────────────────────────────────
    const edit = ui.edit;
    const editMeta = edit !== null ? metaAt(edit.r, edit.c) : undefined;
    const editCand = useMemo(() => {
        if (edit === null || editMeta === undefined || edit.link !== undefined) return undefined;
        return candidateAt(editMeta, edit.val, edit.hi, candidateCtxFor(edit.r));
    }, [edit, editMeta, candidateCtxFor]);
    const editGhost = edit !== null ? ghostFor(edit.val, editCand?.label) : "";
    const editResolve = edit !== null ? resolveFor(edit.val, editCand?.label) : "";
    const editBadge = useMemo(() => {
        if (edit === null || editMeta === undefined || edit.val.trim() === "" || edit.link !== undefined) return "";
        const n = candidateList(editMeta, edit.val, candidateCtxFor(edit.r)).length;
        return n > 1 ? words.m.editorBadge({ index: words.number(Math.min(Math.max(edit.hi, 0), n - 1) + 1), total: words.number(n) }) : "";
    }, [edit, editMeta, candidateCtxFor, words]);
    const onEditorChange = useCallback((val: string) => dispatch({ t: "editor.change", val }), [dispatch]);
    // A combobox column's menu: its register's members, each in the words its
    // cell shows (#1536). Two modes over the machine's buffer: BROWSING — the
    // buffer is empty, or holds a member (the cell's own on open, one chosen)
    // or spells one whole — lists every option the row may take with that one
    // highlighted, and ↑ ↓ step the buffer through them, member by member;
    // TYPING — a partial buffer — lists the machine's candidates with its armed
    // one highlighted, exactly what the strip shows. ⏎ commits the buffer
    // either way; a click writes the option's member and moves on like ⏎.
    const editCombobox = useMemo<{ options: EditorOption[]; highlighted: number; browse: boolean } | undefined>(() => {
        if (edit === null || editMeta === undefined || !isComboboxKind(editMeta.kind)) return undefined;
        const cctx = candidateCtxFor(edit.r);
        const allowed = cctx.allowed?.(editMeta);
        const members = (registers.byName.get(editMeta.register ?? "") ?? []).filter((m) => allowed === undefined || allowed.has(m.key));
        const typed = edit.val.trim().toLowerCase();
        const pick = edit.pick;
        // The member the buffer holds: the one a gesture chose, else one it spells whole — its key, or the words it shows.
        const named = pick !== undefined ? members.findIndex((m) => stringEqual(m.key, pick))
            : typed === "" ? -1 : members.findIndex((m) => stringEqual(m.key.toLowerCase(), typed) || stringEqual(m.label.toLowerCase(), typed));
        const browse = typed === "" || named >= 0;
        const shown = browse ? members.map((m) => ({ key: m.key, label: m.label !== "" ? m.label : m.key })) : candidateList(editMeta, edit.val, cctx);
        const byKey = new Map(members.map((m) => [m.key, m]));
        const options = shown.map((c): EditorOption => {
            const m = byKey.get(c.key);
            return { key: c.key, label: c.label, meta: m !== undefined ? getSomeorUndefined(m.meta) : undefined, tone: m !== undefined ? getSomeorUndefined(m.tone)?.type : undefined };
        });
        return { options, browse, highlighted: browse ? named : edit.hi >= 0 ? Math.min(edit.hi, options.length - 1) : options.length > 0 ? 0 : -1 };
    }, [edit, editMeta, candidateCtxFor, registers]);
    const onEditorPick = useCallback((option: EditorOption) => {
        dispatch({ t: "editor.pick", label: option.label, key: option.key });
        dispatch({ t: "editor.key", key: "Enter", shift: false, meta: false, alt: false, atEnd: true });
    }, [dispatch]);
    const onEditorBrowse = useCallback((option: EditorOption) => dispatch({ t: "editor.pick", label: option.label, key: option.key }), [dispatch]);
    // A date column's buffer is its edit form; the date field shows the date it names.
    const editDate = useMemo(() => {
        if (edit === null || editMeta === undefined || editMeta.kind !== "date") return undefined;
        return parseDate(edit.val, { today, base: parseCtxFor(edit.r, editMeta).baseDate }) ?? undefined;
    }, [edit, editMeta, today, parseCtxFor]);
    const editWhenLevel = edit !== null && editMeta !== undefined ? levelAt(edit.r, editMeta) : undefined;
    const linkEdit = edit?.link;
    const linkEditCtx = useMemo(() => (edit !== null && linkEdit !== undefined ? linkCtxFor(edit.r, edit.c) : undefined), [edit, linkEdit, linkCtxFor]);
    const linkArmed = useMemo(() => (edit !== null && linkEdit !== undefined && linkEditCtx !== undefined ? linkEditCtx.candidateAt(edit.val, edit.hi, linkEdit.groups) : undefined), [edit, linkEdit, linkEditCtx]);
    const linkGhostText = edit !== null && linkArmed !== undefined && linkArmed.label.toLowerCase().startsWith(edit.val.trim().toLowerCase()) && edit.val.trim() !== ""
        ? linkArmed.label.slice(edit.val.trim().length) : "";
    const onEditorKey = useCallback((k: { key: string; shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }): boolean => {
        const current = uiRef.current.edit;
        dispatch({ t: "editor.key", ...k });
        if (["Escape", "Enter", "Tab"].includes(k.key)) return true;
        if (k.alt && (k.key === "]" || k.key === "[")) return true;
        if (current !== null && current.link !== undefined) {
            const link = current.link;
            const chips = link.groups[0].length + link.groups[1].length;
            if (k.shift && (k.key === "ArrowLeft" || k.key === "ArrowRight") && chips > 0 && (link.chipSel !== null || current.val === "")) return true;
            if ((k.key === "Backspace" || k.key === "Delete") && (link.chipSel !== null || current.val === "")) return true;
            if (k.key === "ArrowRight" && k.atEnd && (linkGhostText !== "" || (current.val === "" && link.side === 0))) return true;
            if (k.key === "ArrowLeft" && current.val === "" && link.side === 1) return true;
            return false;
        }
        if (k.key === "ArrowDown" || k.key === "ArrowUp") return true;
        if (k.key === "ArrowRight" && k.atEnd && editGhost !== "") return true;
        return false;
    }, [dispatch, editGhost, linkGhostText, uiRef]);
    const onEditorBlur = useCallback(() => dispatch({ t: "editor.blur" }), [dispatch]);
    const onStripAction = useCallback((a: StripAction) => {
        switch (a.kind) {
            case "candidate": dispatch({ t: "strip.pick", label: a.label, key: a.key, i: a.i }); break;
            case "members": dispatch({ t: "strip.pick", label: a.label, i: -1, members: a.members }); break;
            case "fill": dispatch({ t: "fill.take", key: a.key }); break;
            case "rows": dispatch({ t: "proposal.take", i: (uiRef.current.sugg?.rows.length ?? 1) - 1 }); break;
        }
    }, [dispatch, uiRef]);
    const onHalfDown = useCallback((side: 0 | 1) => dispatch({ t: "half.down", side }), [dispatch]);
    const linkView = useMemo<LinkEditorView | undefined>(() => {
        if (edit === null || linkEdit === undefined || linkEditCtx === undefined || editMeta === undefined) return undefined;
        const lo = linkEdit.chipSel === null ? -1 : Math.min(linkEdit.chipSel.anchor, linkEdit.chipSel.focus);
        const hi = linkEdit.chipSel === null ? -2 : Math.max(linkEdit.chipSel.anchor, linkEdit.chipSel.focus);
        return {
            side: linkEdit.side,
            halves: linkEditCtx.halves,
            groups: linkEdit.groups,
            chipSel: linkEdit.chipSel === null ? null : { lo, hi },
            predicted: [linkEditCtx.predicted(0, linkEdit.groups, linkEdit.side === 0 ? edit.val : ""), linkEditCtx.predicted(1, linkEdit.groups, linkEdit.side === 1 ? edit.val : "")],
            vocab: linkVocabularies.get(editMeta.key),
            hop: linkEdit.hop,
            single: editMeta.kind === "set",
        };
    }, [edit, linkEdit, linkEditCtx, editMeta, linkVocabularies]);
    return {
        edit, editBadge, editCombobox, editDate, editGhost, editMeta, editResolve, editWhenLevel, linkArmed, linkEdit,
        linkEditCtx, linkGhostText, linkView, onEditorBlur, onEditorBrowse, onEditorChange, onEditorKey, onEditorPick,
        onHalfDown, onStripAction, styles,
    };
}

/** What {@link useSheetOpenEditor} gives the parts after it. */
export type SheetOpenEditor = ReturnType<typeof useSheetOpenEditor>;
