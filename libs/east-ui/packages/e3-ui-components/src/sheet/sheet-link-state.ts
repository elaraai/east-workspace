/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The link editor's transitions (B§4.4 — `Sheet Spec.md` §5 row 7): the two
 * halves, the buffer that resolves to chips on `,` / ⏎ / a hop, the chip
 * selection, the ⇥ ladder. A member leaves whole — never back into the buffer
 * to be deleted letter by letter (east-workspace#1741): Backspace with nothing
 * typed picks the half's last chip and a second removes it, as Delete and
 * Backspace remove any chips picked, and a chip's × removes it. No key takes
 * the caret into a half that is not live — a set's editor draws its
 * destination alone, and the caret out of it would leave no input. Pure
 * functions over the machine state; the commit is injected by the core so
 * this module never imports it.
 *
 * @packageDocumentation
 */

import { ghostWord } from "./candidates.js";
import { ARROW } from "./link/grammar.js";
import type { LinkHalves } from "./link/sides.js";
import type {
    CommitDir, EditBuffer, LinkEdit, LinkEditCtx, LinkGroups, SheetEffect, SheetEvent, SheetMachineCtx, SheetNotice, SheetUiState, Transition,
} from "./sheet-types.js";

/** The core's commit, injected. */
export type CommitFn = (s: SheetUiState, dir: CommitDir, ctx: SheetMachineCtx) => Transition;

/** The half the caret opens in: the first live half still empty, else the destination. */
export function linkStartSide(halves: LinkHalves, groups: LinkGroups): 0 | 1 {
    if (halves.from.live && groups[0].length === 0) return 0;
    if (halves.to.live && groups[1].length === 0) return 1;
    return halves.to.live ? 1 : 0;
}

/** The halves with the buffer resolved into the active one. */
export function withBuffer(edit: EditBuffer, linkCtx: LinkEditCtx): LinkGroups {
    const link = edit.link!;
    const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
    if (edit.val.trim() === "") return groups;
    const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
    groups[link.side] = groups[link.side].concat(linkCtx.resolve(edit.val, cand));
    return groups;
}

/** Hop the caret to a half — the buffer resolves into the half it leaves. */
export function switchSide(s: SheetUiState, side: 0 | 1, ctx: SheetMachineCtx): Transition {
    const edit = s.edit;
    if (edit === null || edit.link === undefined || edit.link.side === side) return { state: s, effects: [] };
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return { state: s, effects: [] };
    const groups = withBuffer(edit, linkCtx);
    return {
        state: { ...s, edit: { ...edit, val: "", hi: -1, err: false, link: { ...edit.link, side, groups, chipSel: null, hop: edit.link.hop + 1 } } },
        effects: [{ t: "focus.editor", selectAll: false }, { t: "schedule.suggest", latency: "idle" }],
    };
}

/** The flat chip list's range under the chip selection. */
function chipRange(link: LinkEdit): { lo: number; hi: number } {
    if (link.chipSel === null) return { lo: -1, hi: -2 };
    return { lo: Math.min(link.chipSel.anchor, link.chipSel.focus), hi: Math.max(link.chipSel.anchor, link.chipSel.focus) };
}

/** The halves without the chips from `lo` to `hi` of the flat list, the footer counting them: what a picked chip's Backspace and a chip's × leave. */
function withoutChips(s: SheetUiState, lo: number, hi: number): Transition {
    const edit = s.edit!;
    const link = edit.link!;
    let i = 0;
    const groups = link.groups.map((g) => g.filter(() => { const n = i++; return n < lo || n > hi; })) as LinkGroups;
    return { state: { ...s, msg: { id: "membersRemoved", n: hi - lo + 1 }, edit: { ...edit, link: { ...link, groups, chipSel: null } } }, effects: [] };
}

/**
 * A chip's × (east-workspace#1741): its member out of its half, whole — the caret back in the active half's input.
 *
 * @param s - The machine's state
 * @param i - The chip's place in the flat list, From then To
 * @returns The transition
 */
export function linkRemove(s: SheetUiState, i: number): Transition {
    const link = s.edit?.link;
    if (link === undefined || i < 0 || i >= link.groups[0].length + link.groups[1].length) return { state: s, effects: [] };
    const t = withoutChips(s, i, i);
    return { ...t, effects: [{ t: "focus.editor", selectAll: false }] };
}

/**
 * The link editor's typing: `,` resolves the buffer, an arrow hops From → To (dropped in To). What is typed starts at its
 * first word — the space typed after a `,` is the separator's, never the buffer's, whether it arrives with the comma or
 * after it — so a buffer that shows nothing holds nothing, and Backspace there picks a chip (east-workspace#1741) rather
 * than take a space no one sees.
 */
export function linkChange(s: SheetUiState, val: string, ctx: SheetMachineCtx): Transition {
    const edit = s.edit!;
    const link = edit.link!;
    if (!val.includes(",") && !ARROW.test(val)) {
        const typed = val.replace(/^\s+/, "");
        return { state: { ...s, edit: { ...edit, val: typed, err: false, hi: typed === "" ? -1 : 0, link: { ...link, chipSel: null } } }, effects: [{ t: "schedule.suggest", latency: "idle" }] };
    }
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return { state: s, effects: [] };
    const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
    let side = link.side;
    let buf = "";
    let warn: SheetNotice | undefined;
    const push = (b: string) => {
        const t = b.trim().replace(/-+$/, "").trim();
        if (t === "") return;
        // The armed candidate completes the buffer (the ghost the planner saw); else the grammar.
        groups[side] = groups[side].concat(linkCtx.resolve(t, linkCtx.candidateAt(t, -1, groups)));
    };
    // An arrow typed in the From half hops to the To half; in the To half it is
    // dropped. Hopping into a locked half is allowed but flagged — the text is kept.
    const route = () => {
        push(buf);
        buf = "";
        if (side === 0) {
            side = 1;
            if (!linkCtx.halves.to.live) warn = { id: "lockedHalf", driver: linkCtx.driverName };
        }
    };
    for (let i = 0; i < val.length; i++) {
        const ch = val[i]!;
        if (ch === ",") { push(buf); buf = ""; continue; }
        if (ch === ">" || ch === "→") { route(); continue; }
        if (ch === "-" && val[i + 1] === ">") continue;   // `->`: the hyphen buffered before the arrow
        if ((ch === "-" || ch === "–") && /\s$/.test(buf) && /^\s/.test(val.slice(i + 1))) { route(); i++; continue; }
        buf += ch;
    }
    const hopped = side !== link.side;
    const effects: SheetEffect[] = [{ t: "schedule.suggest", latency: "idle" }];
    if (hopped) effects.push({ t: "focus.editor", selectAll: false });
    const rest = buf.replace(/^\s+/, "");
    return {
        state: {
            ...s,
            msg: warn ?? s.msg,
            edit: { ...edit, val: rest, err: false, hi: rest.trim() === "" ? -1 : 0, link: { ...link, side, groups, chipSel: null, hop: hopped ? link.hop + 1 : link.hop } },
        },
        effects,
    };
}

/** The link editor's keys (B§4.4). */
export function linkKey(s: SheetUiState, e: Extract<SheetEvent, { t: "editor.key" }>, ctx: SheetMachineCtx, commit: CommitFn): Transition {
    const edit = s.edit!;
    const link = edit.link!;
    const linkCtx = ctx.linkAt?.(edit.r, edit.c);
    if (linkCtx === undefined) return commit(s, "cancel", ctx);
    const setLink = (patch: Partial<LinkEdit>, more: Partial<EditBuffer> = {}, effects: SheetEffect[] = []): Transition =>
        ({ state: { ...s, edit: { ...edit, ...more, link: { ...link, ...patch } } }, effects });
    const flat = [...link.groups[0], ...link.groups[1]];
    if (e.key === "Escape") {
        if (link.chipSel !== null) return setLink({ chipSel: null });
        return commit(s, "cancel", ctx);
    }
    if (e.alt && (e.key === "]" || e.key === "[" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const n = linkCtx.candidates(edit.val, link.groups).length;
        if (n === 0) return { state: s, effects: [] };
        const cur = edit.hi < 0 ? (edit.val.trim() === "" ? -1 : 0) : edit.hi;
        const back = e.key === "[" || e.key === "ArrowUp";
        return { state: { ...s, edit: { ...edit, hi: cur < 0 ? 0 : (cur + (back ? -1 : 1) + n) % n } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
    }
    if (e.key === "Enter") {
        if (e.meta) return commit(s, "stay", ctx);
        if (edit.val.trim() !== "") {
            // With text: resolve to chips, stay.
            const groups = withBuffer(edit, linkCtx);
            return setLink({ groups, chipSel: null }, { val: "", hi: -1, err: false }, [{ t: "schedule.suggest", latency: "idle" }]);
        }
        return commit(s, "down", ctx);
    }
    if (e.key === "Tab") {
        if (!e.shift && edit.val.trim() !== "") {
            // 1 · the inline ghost or the armed candidate.
            const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
            if (cand !== undefined && cand.label.toLowerCase() !== edit.val.trim().toLowerCase()) {
                return { state: { ...s, edit: { ...edit, val: cand.label, hi: 0 } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
            }
        }
        if (!e.shift && edit.val.trim() === "") {
            // 2 · one predicted chip.
            const rest = linkCtx.predicted(link.side, link.groups, edit.val);
            if (rest.length > 0) {
                const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
                groups[link.side] = groups[link.side].concat([rest[0]!]);
                return setLink({ groups }, {}, [{ t: "schedule.suggest", latency: "instant" }]);
            }
        }
        // 3 · the divider, before the cell — a locked half is skipped.
        if (!e.shift && link.side === 0 && linkCtx.halves.to.live) return switchSide(s, 1, ctx);
        if (e.shift && link.side === 1 && linkCtx.halves.from.live) return switchSide(s, 0, ctx);
        // 4 · commit.
        return commit(s, e.shift ? "left" : "right", ctx);
    }
    // ⇧← / ⇧→ select whole chips — the unit of a collection cell is the member.
    if (e.shift && (e.key === "ArrowLeft" || e.key === "ArrowRight") && flat.length > 0) {
        const cs = link.chipSel;
        if (e.key === "ArrowLeft" && (cs !== null || edit.val === "")) {
            const next = cs !== null ? { anchor: cs.anchor, focus: Math.max(0, cs.focus - 1) } : { anchor: flat.length - 1, focus: flat.length - 1 };
            return setLink({ chipSel: next });
        }
        if (e.key === "ArrowRight" && cs !== null) {
            const f = cs.focus + 1;
            return setLink({ chipSel: f > flat.length - 1 ? null : { anchor: cs.anchor, focus: f } });
        }
    }
    if (link.chipSel !== null && (e.key === "Backspace" || e.key === "Delete")) {
        const { lo, hi } = chipRange(link);
        return withoutChips(s, lo, hi);
    }
    if (link.chipSel !== null && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return setLink({ chipSel: null });
    if (e.key === "Backspace" && edit.val === "") {
        // The active half's last chip is picked, and the next Backspace takes it whole (east-workspace#1741); an empty To
        // crosses back to From, where From is live.
        if (link.groups[link.side].length > 0) {
            const last = (link.side === 0 ? 0 : link.groups[0].length) + link.groups[link.side].length - 1;
            return setLink({ chipSel: { anchor: last, focus: last } });
        }
        if (link.side === 1 && linkCtx.halves.from.live) return switchSide(s, 0, ctx);
        return { state: s, effects: [] };
    }
    if (e.key === "ArrowRight" && e.atEnd && edit.val.trim() !== "") {
        const cand = linkCtx.candidateAt(edit.val, edit.hi, link.groups);
        const ghost = cand !== undefined && cand.label.toLowerCase().startsWith(edit.val.trim().toLowerCase()) ? cand.label.slice(edit.val.trim().length) : "";
        if (ghost !== "") {
            const take = e.meta ? ghost : ghostWord(ghost);
            return { state: { ...s, edit: { ...edit, val: edit.val + take } }, effects: [] };
        }
    }
    if (e.meta && e.key === "ArrowRight" && edit.val.trim() === "") {
        // The whole predicted remainder of the half in one press.
        const rest = linkCtx.predicted(link.side, link.groups, edit.val);
        if (rest.length > 0) {
            const groups: LinkGroups = [[...link.groups[0]], [...link.groups[1]]];
            groups[link.side] = groups[link.side].concat(rest);
            return { state: { ...s, msg: { id: "predictedTaken", n: rest.length }, edit: { ...edit, link: { ...link, groups } } }, effects: [{ t: "schedule.suggest", latency: "instant" }] };
        }
    }
    // Plain arrows at the edge of an empty buffer cross the divider, into a live half.
    if (e.key === "ArrowRight" && edit.val === "" && !e.meta && link.side === 0 && linkCtx.halves.to.live) return switchSide(s, 1, ctx);
    if (e.key === "ArrowLeft" && edit.val === "" && link.chipSel === null && link.side === 1 && linkCtx.halves.from.live) return switchSide(s, 0, ctx);
    return { state: s, effects: [] };
}
