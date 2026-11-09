/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where the view goes: the key search and its jumps, a row the narrowing hides named and gone to, a key's move past the
 * rows read landing once they are, the scroll restored after a remount, a row kept in view through a new narrowing, and an
 * issue's cell gone to.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, StructType, equalFor, fromEastTypeValue, none, parseFor, printFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { recordSliceWithinAt } from "@elaraai/east-ui-components/internal";
import type { SeekQueryType } from "@elaraai/east-ui";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { isRowSpace, type SheetBodyItem } from "./model.js";
import { narrowingOf } from "./view-state.js";
import { sameAnchor, type SheetAnchor } from "./persisted.js";
import { useSheetSeek, type SheetSeekNarrowing } from "./use-seek.js";
import { hiddenLine, hiddenOf, useHidden, useRelist } from "../shared/schedule/hidden.js";
import { useHiddenPick } from "../shared/schedule/hidden-pick.js";
import { seekRecord } from "./use-lens.js";
import type { SheetTransactions } from "./transactions.js";
import type { SheetRootValue } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetEffects } from "./use-effects.js";
import { rowNameOf } from "./local-rows.js";
import { elementOf, elementUnder, keyOfItem, placeOf, rowPositionOf, spanOf } from "./items.js";

export type SheetTransactionsIssue = SheetTransactions["issues"][number];

export type SeekQuery = ValueTypeOf<typeof SeekQueryType>;

/**
 * A row the `rows` source's narrowing hid, being gone to (the hidden pick):
 * its place in the record, the rows as the narrowing it came from and the one
 * the pick left them under name them (`rowsQuery`), whether the pick was an
 * issue's — its cell then takes the ring — and whether its jump is made.
 */
export interface SheetReveal {
    element: number;
    from: string;
    to: string;
    issue: boolean;
    jumped: boolean;
}

/** The `rows` source's narrowing, as East prints it: what names a narrowing of the rows apart from another (#1349). */
const printRowsWhere = printFor(RecordSliceWhereType);

const stringEqual = equalFor(StringType);

/** A live source's rows under one narrowing, named apart (#1354): the source and its narrowing, as East prints them. */
const printNarrowedSource = printFor(StructType({ source: StringType, narrowing: StringType }));

/**
 * Takes the view where the key search, a key, a remount or an issue sends it (see the module docs).
 *
 * @param value - The Sheet root value
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetEffects - The effect runner and what its effects reach
 * @returns The key search, the hidden pick, the scroll's anchor and the issue gone to
 */
export function useSheetJumps(value: SheetRootValue, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetEffects: SheetEffects) {
    const { chrome, columns, group, lensWanted, pagedSource, recordRows, rowsPart, rowsWhere, words } = sheetDecode;
    const {
        dispatchStore, lens, lensDrawn, paging, persist, persistedRef, restored, rows, rowsQuery, sourceRows,
        standingIn,
    } = sheetSession;
    const { body, rowSpace } = sheetBody;
    const {
        clearJump, dispatch, expectedNarrowing, jumpTo, jumpToElement, lensJumpTo, rowSpaceSlots, seenRows, uiRef,
    } = sheetMachine;
    const { cardRef, jumpBy, ringMoves, scrollTarget, seekIntent, setScrollTarget } = sheetEffects;
    // ── The key search over a keyed paged source (§3.13) ──────────────────
    // Its jumps are its own (#860): cleared — by the viewer, or by a new
    // snapshot — it drops only a jump it asked for, never a key's move. Over a
    // `rows` source it seeks the record's own order (#1349); under the lens its
    // jump reads where its row lands and goes there where the narrowing keeps
    // it. A row the narrowing hides is marked so in the box, by the filters that
    // hide it once e3 has said, and a pick of it clears them and goes to it (the
    // hidden pick, below).
    const searchJump = useCallback((element: number) => { jumpBy.current = "search"; jumpTo(element); }, [jumpTo, jumpBy]);
    const searchClearJump = useCallback(() => { if (jumpBy.current === "search") clearJump(); }, [clearJump, jumpBy]);
    const recordSeek = useMemo(() => (rowsPart === undefined ? undefined : (query: SeekQuery) => seekRecord(rowsPart, query)), [rowsPart]);
    // Over a `rows` source the key search seeks the record's own order, and starts afresh with each narrowing of the
    // rows, as it did while they were the narrowing's alone (#1345): its source's id names the narrowing too.
    const seekSource = useMemo(() => (recordRows && recordSeek !== undefined && pagedSource !== undefined && pagedSource.seek.type === "none"
        ? { ...pagedSource, id: rowsQuery, seek: some(recordSeek) } : pagedSource), [recordRows, recordSeek, pagedSource, rowsQuery]);
    // ── The hidden pick (`shared/schedule/hidden.ts`, `hidden-pick.tsx`): a row the narrowing hides, named and gone to ──
    // Which of the `rows` source's choices hide a row its narrowing hides, asked of e3 through the record's indexes for
    // the rows the box lists and for the issues' rows — never worked out here — and kept by the lens's revision and the
    // narrowing. A row's record key by its id, and its id by its key: a String key's id is the String itself, any other
    // key's its `.east` text.
    const recordKeys = useMemo(() => {
        const keyType = value.editing.keyType.type === "some" ? fromEastTypeValue(value.editing.keyType.value) : StringType;
        const text = keyType.type === "String";
        const parseKey = parseFor(keyType);
        const printKey = printFor(keyType);
        return {
            keyOf: (id: string): option<unknown> => {
                if (text) return some(id);
                const read = parseKey(id);
                return read.success ? some(read.value) : none;
            },
            idOf: (key: unknown): string => (text ? key as string : printKey(key as never)),
        };
    }, [value.editing.keyType]);
    const rowsPick = useHidden({
        name: "Sheet", part: lensWanted ? rowsPart : undefined, where: lensWanted ? rowsWhere : undefined, revision: lens.revision,
        keyOf: recordKeys.keyOf, idOf: recordKeys.idOf,
    });
    // A pick of a row the narrowing hides — the box's, or Go to issue's — clears the filters hiding it and goes to it: the
    // lens's jump lands it (below), so the shared pick clears, and hands the keyboard on.
    const pick = useHiddenPick({
        onError: (said, reason) => {
            console.error("[Sheet] the filters hiding a row could not be cleared:", reason);
            dispatchStore({ t: "patch", patch: { msg: { id: "text", text: said } } });
        },
        uncleared: "The filters hiding the row could not be cleared",
    });
    const [reveal, setReveal] = useState<SheetReveal | undefined>(undefined);
    // The rows' narrowing a reveal wrote: it places the view itself, so a narrowing keeping the row at the view's top
    // leaves it be (below).
    const revealedQuery = useRef<string | undefined>(undefined);
    /** The row an issue sent the key search to, by its entry and its place: a jump that finds it hidden reveals it for the issue. */
    const issueSought = useRef<{ entry: string; row: number } | undefined>(undefined);
    const revealHidden = useCallback((element: number, key: string | undefined, issue: boolean) => {
        if (chrome === undefined || rowsPart === undefined || pagedSource === undefined) return;
        // A row the lens finds hidden: the filters hiding it, as e3 named them — every choice of the `rows` source, until it
        // has — cleared as the rail clears them: a rail change like any other, which a saved view's tab marks dirty and Esc
        // there reverts.
        const state = key === undefined ? undefined : rowsPick.rows.stateOf(key);
        if (!pick.clear([{ pick: rowsPick, answer: state !== undefined && state.hidden ? state.answer : undefined }])) return;
        // The sheet's own write: the ring goes to the row, never back to the top, and the view with it.
        expectedNarrowing.current = narrowingOf(chrome);
        const to = printNarrowedSource({ source: pagedSource.id, narrowing: printRowsWhere(rowsPart.read().where) });
        revealedQuery.current = to;
        setReveal({ element, from: rowsQuery, to, issue, jumped: false });
    }, [chrome, rowsPart, pagedSource, rowsPick, pick, rowsQuery, expectedNarrowing]);
    const revealRef = useRef(revealHidden);
    revealRef.current = revealHidden;
    // The box lists the rows its key finds wherever they are, each read by its place in the record, and says which the
    // `rows` source's narrowing hides (#1398, CL10): under the lens, which of them the narrowing holds — and, once e3 has
    // said, the filters that hide each, in the sheet's words for the line — listing them again as the answers land.
    const hiddenRelist = useRelist([rowsPick]);
    const seekNarrowing = useMemo<SheetSeekNarrowing | undefined>(() => (lensWanted && rowsPart !== undefined && rowsWhere !== undefined ? {
        held: (from: number, count: number) => recordSliceWithinAt(rowsPart, rowsWhere, BigInt(from), BigInt(count)),
        hiddenLine: (key: string) => {
            const hidden = hiddenOf([{ pick: rowsPick, id: key }]);
            return hidden === undefined ? key
                : hiddenLine(hidden, words, { hiddenByFilters: () => words.m.keySearchHidden({ key }), hiddenBy: (p) => words.m.keySearchHiddenBy({ key, ...p }) });
        },
        askHidden: rowsPick.rows.askListed,
        reveal: (row: number, key: string) => revealRef.current(row, key, false),
        version: hiddenRelist,
    } : undefined), [lensWanted, rowsPart, rowsWhere, rowsPick, words, hiddenRelist]);
    const seek = useSheetSeek(seekSource, searchJump, searchClearJump, seekNarrowing);
    // A pick in the key search hands the keyboard to the grid (#1398): the grid's focus lands with the ring, on the picked
    // row's cell, once the row is drawn and the box has let the keyboard go — a hidden pick's once the narrowing it
    // leaves draws the row; a step leaves it in the box.
    const handOff = pick.handOff;
    const pickSearch = useMemo(() => (seek.search === undefined ? undefined : pick.search(seek.search)), [seek.search, pick]);
    const focusGrid = useCallback(() => { cardRef.current?.focus({ preventScroll: true }); }, [cardRef]);
    // A jump's target is shown once its window settles (#854): the ring goes
    // to the sought row (no echo — the host hears the move through onSelect),
    // or the view to the band of the window that could not be read (#853).
    // The jump hands the viewport back only after the scroll to it is asked
    // for — the reports taken before, from the old place, would undo it.
    const handBack = useRef(false);
    const activeJump = lensDrawn ? lens.jump : paging.jump;
    const jumpInFlight = activeJump !== undefined && !activeJump.settled;
    /**
     * Shows a settled jump's element: the ring on its row — when `ring` — and the view on it, or on the band of the window
     * that could not be read there; the viewport handed back once the scroll is asked for.
     *
     * @returns Whether anything shows it
     */
    const landJump = useCallback((target: number, ring: boolean): boolean => {
        // A sought element is a row, or on a grouped sheet a group — the ring lands on its band — or a loose row (#846).
        const bi = body.findIndex((it) => {
            if (group !== undefined) return (it.kind === "group" || (it.kind === "real" && it.loose !== undefined)) && it.position === target;
            return it.kind === "real" && it.position === target;
        });
        const r = bi >= 0 ? rowSpace.rowOf[bi] : undefined;
        if (ring && r !== undefined && r >= 0) dispatch({ t: "select.set", r, c: uiRef.current.sel.c });
        const shown = bi >= 0 ? bi : body.findIndex((it) => it.kind === "failed" && it.failure.from <= target && target <= it.failure.to);
        if (shown < 0) return false;
        setScrollTarget({ index: shown, align: "auto" }, true);
        handBack.current = true;
        return true;
    }, [body, rowSpace, group, dispatch, setScrollTarget, uiRef]);
    useEffect(() => {
        const target = seek.target;
        if (target === undefined || jumpInFlight) return;
        seek.clearTarget();
        if (landJump(target, true)) {
            handOff.land(focusGrid);
            return;
        }
        // Nothing to show: the viewport is the viewer's again. Under the lens the narrowing hides the row (the hidden
        // pick): the filters hiding it are cleared — those e3 named, else every choice of the `rows` source — and the
        // row gone to once the narrowing they leave draws it; the issue's cell, when an issue sought it.
        clearJump();
        if (!lensDrawn) {
            handOff.drop();
            return;
        }
        const sought = issueSought.current;
        issueSought.current = undefined;
        const issue = sought !== undefined && sought.row === target ? sought : undefined;
        revealRef.current(target, issue?.entry, issue !== undefined);
    }, [seek, jumpInFlight, landJump, clearJump, lensDrawn, handOff, focusGrid]);
    // The frame's own effects run first, so by now it has asked for the scroll: a fresh target's, which a jump's is.
    const scrollNonce = scrollTarget?.nonce;
    useEffect(() => {
        if (!handBack.current) return;
        handBack.current = false;
        clearJump();
    }, [scrollNonce, clearJump]);
    // A reveal goes to its row once the narrowing it wrote is in (the hidden pick): the jump the lens makes, landing
    // once that narrowing draws the row — or, with nothing left narrowing the rows, the pages' jump. A narrowing written
    // since decides for itself.
    useEffect(() => {
        const going = reveal;
        if (going === undefined) return;
        if (!stringEqual(rowsQuery, going.to)) {
            if (!stringEqual(rowsQuery, going.from)) setReveal(undefined);
            return;
        }
        if (!going.jumped) {
            jumpBy.current = "reveal";
            if (lensWanted) lensJumpTo(going.element);
            else jumpToElement(going.element);
            setReveal({ ...going, jumped: true });
            return;
        }
        const jump = lensWanted ? lens.jump : paging.jump;
        if (jump === undefined || !jump.settled) return;
        setReveal(undefined);
        // An issue's cell takes the ring and the keyboard as its row lands (`pendingIssue`); a pick's row takes them here.
        if (!landJump(going.element, !going.issue)) {
            clearJump();
            handOff.drop();
            return;
        }
        if (!going.issue) handOff.land(focusGrid);
    }, [reveal, rowsQuery, lensWanted, lensJumpTo, jumpToElement, lens.jump, paging.jump, landJump, clearJump, handOff, focusGrid, jumpBy]);
    // A key's move across an unloaded run (#860) lands once its window is in
    // the run: the ring goes to the first row at or past the element it was
    // headed for (↓, ⌘Home), the last at or before it (↑), or the last there
    // that is not blank padding (⌘End) — and where the window could not be
    // read, the view goes to its band. A gesture since the key, or an open
    // editor, abandons it, the rows it held put back as they were; a jump the
    // move did not ask for — the key search's — takes its place. Either way
    // the viewport is handed back once the scroll is asked for, as a search's
    // is. It lands in the commit that draws the jump's rows, before paint
    // (#1398, CL10): until then the rows shown stand in (the driver's `held`),
    // and then the ring and the view are on the row it went to in the frame
    // that first shows the jump's rows — never a frame of them at the old
    // place. The ring it places is placed in these rows: nothing follows it
    // there from the rows that stood in. Under the lens (#1349) the jump is the
    // lens's: the rows shown stay drawn while it reads where it goes, and the
    // ring lands once the stretch it lands in is read — the lens's jump settles
    // on its own row, and the lens may still be reading the rows beside it.
    const keyJump = lensDrawn ? lens.jump : paging.jump;
    const lensView = lens.reportViewport;
    useLayoutEffect(() => {
        const intent = seekIntent.current;
        if (intent === undefined) return;
        if (jumpBy.current !== "key") { seekIntent.current = undefined; return; }
        // The render that pins its window is still to come.
        if (keyJump === undefined || keyJump.window !== intent.window) return;
        if (ringMoves.current !== intent.moves || uiRef.current.edit !== null) {
            seekIntent.current = undefined;
            clearJump();
            return;
        }
        if (!keyJump.settled) return;
        if (lensDrawn) {
            // The first stretch at or past where it goes — or, landing on the last row there, at or before it: a band still
            // read holds the ring back until it is drawn, so it never lands on a row short of it.
            const meets = (it: SheetBodyItem): boolean => {
                const span = spanOf(it);
                if (span === undefined || (it.kind !== "band" && it.kind !== "failed" && !isRowSpace(it))) return false;
                return intent.land === "first" ? span.to >= intent.element : span.from <= intent.element;
            };
            let at: SheetBodyItem | undefined;
            if (intent.land === "first") at = body.find(meets);
            else for (let i = body.length - 1; i >= 0 && at === undefined; i--) if (meets(body[i]!)) at = body[i];
            if (at?.kind === "band") return;
        }
        seekIntent.current = undefined;
        const positionOf = (it: SheetBodyItem): number | undefined => (intent.land === "end" ? elementOf(it) ?? undefined : rowPositionOf(it));
        let bi = -1;
        if (intent.land === "first") bi = body.findIndex((it) => { const p = positionOf(it); return p !== undefined && p >= intent.element; });
        else for (let i = body.length - 1; i >= 0 && bi < 0; i--) { const p = positionOf(body[i]!); if (p !== undefined && p <= intent.element && isRowSpace(body[i]!)) bi = i; }
        const r = bi >= 0 ? rowSpace.rowOf[bi] : undefined;
        if (r !== undefined && r >= 0) {
            seenRows.current = { source: sourceRows, slots: rowSpaceSlots };
            dispatch({ t: "select.move", r, c: intent.c });
        }
        const shown = r !== undefined && r >= 0 ? bi : body.findIndex((it) => it.kind === "failed" && it.failure.from <= intent.element && intent.element <= it.failure.to);
        // Nothing to show (a lens hides every row there): the viewport is the viewer's again.
        if (shown < 0) { clearJump(); return; }
        // Under the lens, the view is where the ring landed from here on, so what it read there stays read — the jump's own
        // row may be one the narrowing does not hold, which hands the lens no view — until the frame reports where it rests.
        const landedAt = lensDrawn ? spanOf(body[shown]!) : undefined;
        if (landedAt !== undefined) lensView(landedAt.from, landedAt.to, false);
        setScrollTarget({ index: shown, align: "auto" }, true);
        handBack.current = true;
    }, [keyJump, lensDrawn, lensView, body, rowSpace, dispatch, clearJump, sourceRows, rowSpaceSlots, jumpBy, ringMoves, seekIntent, seenRows, setScrollTarget, uiRef]);

    // ── Where the scroll rests (#857) ─────────────────────────────────────
    // The anchor the last session left is restored once its item is in the
    // body; a paged sheet first fetches the window its element is in, the way
    // a key search jumps, and hands the viewport back once the frame has
    // scrolled there. The element is clamped to the source's count first: a
    // jump past the end pins a window no demand makes resident, so it would
    // never settle — and a pending jump owns the viewport. An anchor whose
    // item is gone lands in its place (`placeOf`). Where the frame mounts is never reported
    // (`VirtualRows` reports settles, not its first rest), so the top the
    // sheet opens at never overwrites the anchor it restores.
    const [anchorPhase, setAnchorPhase] = useState<"pending" | "seeking" | "settled">(() => (restored.anchor === null ? "settled" : "pending"));
    const [restoreAnchor, setRestoreAnchor] = useState<{ index: number; offset: number } | undefined>(undefined);
    const anchorHandBack = useRef(false);
    const anchorJump = paging.jump;
    const pagedTotal = paging.total;
    const lensReadyNow = lens.ready;
    useEffect(() => {
        if (anchorPhase === "settled") return;
        const saved = restored.anchor;
        if (saved === null) { setAnchorPhase("settled"); return; }
        // Under the lens (#1349) a row it has laid out comes back where it was, once the layout near the top is drawn;
        // a row the lens does not draw, the view starts at the top: no element of the record is sought for it.
        if (lensWanted) {
            if (!lensReadyNow) return;
            const shown = body.findIndex((it, i) => it.kind !== "band" && keyOfItem(it, i) === saved.key);
            if (shown >= 0) setRestoreAnchor({ index: shown, offset: saved.offset });
            setAnchorPhase("settled");
            return;
        }
        if (body.length === 0) return;
        // A band is a place in one run, never the item (see elementUnder): its element decides.
        const at = body.findIndex((it, i) => it.kind !== "band" && keyOfItem(it, i) === saved.key);
        // Where its element is now: a source that shrank past it keeps its last one.
        const element = pagedSource !== undefined && saved.element !== null && pagedTotal !== undefined && pagedTotal > 0
            ? Math.min(saved.element, pagedTotal - 1) : undefined;
        if (at < 0 && element !== undefined) {
            if (anchorPhase === "pending") {
                setAnchorPhase("seeking");
                jumpBy.current = "anchor";
                jumpToElement(element);
                return;
            }
            // Until its window is in the run — landed, or failed — the item may yet come.
            if (anchorJump === undefined || !anchorJump.settled) return;
        }
        anchorHandBack.current = anchorPhase === "seeking";
        setRestoreAnchor(at >= 0 ? { index: at, offset: saved.offset } : { index: placeOf(body, saved.index, element), offset: 0 });
        setAnchorPhase("settled");
    }, [anchorPhase, restored, body, pagedSource, pagedTotal, jumpToElement, anchorJump, lensWanted, lensReadyNow, jumpBy]);
    useEffect(() => {
        if (!anchorHandBack.current) return;
        anchorHandBack.current = false;
        clearJump();
    }, [restoreAnchor, clearJump]);

    // ── A narrowing keeps the row in view (#1398, CL8) ────────────────────
    // A new narrowing of the rows keeps the row at the top of the view where it was — by its key, and the px into it —
    // when the narrowing holds it, and else starts at the top, the view's top at the first item's however tall it is
    // (#1345, #1349). Drawn already, the row is put back there at once. Over the record's rows, one the narrowing holds
    // but has not drawn — far from where the lens reads first, or in a window the pages have not read — is read where it
    // is, as a key search's jump reads it, and put back once drawn: under the lens the narrowing says whether it holds
    // the row; the record's own rows hold every one. A narrowed source's own rows have no place to keep but their
    // order: a new narrowing of them starts at the top.
    const [keeping, setKeeping] = useState<{ anchor: SheetAnchor; element: number; phase: "asking" | "seeking"; query: string } | undefined>(undefined);
    const toTop = useCallback(() => { setScrollTarget({ index: 0, align: "start" }, true); }, [setScrollTarget]);
    const seenRowsQuery = useRef(rowsQuery);
    useEffect(() => {
        if (standingIn) return;
        const previous = seenRowsQuery.current;
        seenRowsQuery.current = rowsQuery;
        if (rowsPart === undefined || previous === rowsQuery) return;
        // A narrowing a reveal wrote: the reveal takes the view to its row (the hidden pick).
        const revealed = revealedQuery.current;
        revealedQuery.current = undefined;
        if (revealed !== undefined && stringEqual(revealed, rowsQuery)) { setKeeping(undefined); return; }
        const anchor = persistedRef.current.anchor;
        const at = anchor === null ? -1 : body.findIndex((it, i) => (it.kind === "real" || it.kind === "group") && keyOfItem(it, i) === anchor.key);
        if (anchor !== null && at >= 0) {
            setKeeping(undefined);
            setRestoreAnchor({ index: at, offset: anchor.offset });
            return;
        }
        if (anchor !== null && recordRows && anchor.element !== null && (anchor.key.startsWith("row:") || anchor.key.startsWith("group:"))) {
            setKeeping({ anchor, element: anchor.element, phase: "asking", query: rowsQuery });
            return;
        }
        setKeeping(undefined);
        toTop();
    }, [rowsQuery, rowsPart, standingIn, body, recordRows, toTop, persistedRef]);
    // Whether the new narrowing holds the row: every row where nothing narrows the record's rows; under the lens, as the
    // narrowing says — a tracked read, none while it is asked.
    const askKept = useCallback(() => {
        if (keeping === undefined || keeping.phase !== "asking") return none;
        if (!lensWanted || rowsPart === undefined || rowsWhere === undefined) return some(true);
        const held = recordSliceWithinAt(rowsPart, rowsWhere, BigInt(keeping.element), 1n);
        return held.type === "some" ? some(held.value[0] === true) : none;
    }, [keeping, lensWanted, rowsPart, rowsWhere]);
    const keptHeld = useTrackedEvaluation(askKept).result;
    const keptJump = lensDrawn ? lens.jump : paging.jump;
    useEffect(() => {
        if (keeping === undefined) return;
        // Another narrowing since: it decides for itself.
        if (keeping.query !== rowsQuery) { setKeeping(undefined); return; }
        if (keeping.phase === "asking") {
            if (!keptHeld.ok) { setKeeping(undefined); toTop(); return; }
            if (keptHeld.value.type === "none") return;
            if (!keptHeld.value.value) { setKeeping(undefined); toTop(); return; }
            setKeeping({ ...keeping, phase: "seeking" });
            jumpBy.current = "anchor";
            if (lensDrawn) lensJumpTo(keeping.element);
            else jumpToElement(keeping.element);
            return;
        }
        if (keptJump === undefined || !keptJump.settled) return;
        setKeeping(undefined);
        const at = body.findIndex((it, i) => (it.kind === "real" || it.kind === "group") && keyOfItem(it, i) === keeping.anchor.key);
        if (at < 0) { clearJump(); toTop(); return; }
        // Put back, the view is the viewer's again once the frame has scrolled there.
        anchorHandBack.current = true;
        setRestoreAnchor({ index: at, offset: keeping.anchor.offset });
    }, [keeping, keptHeld, rowsQuery, lensDrawn, lensJumpTo, jumpToElement, keptJump, body, clearJump, toTop, jumpBy]);

    const onAnchorChange = useCallback((at: { index: number; offset: number }) => {
        const item = body[at.index];
        if (item === undefined) return;
        const next: SheetAnchor = { key: keyOfItem(item, at.index), offset: at.offset, index: at.index, element: pagedSource !== undefined ? elementUnder(item, at.offset) : null };
        const p = persistedRef.current;
        if (sameAnchor(p.anchor, next)) return;
        persist({ ...p, anchor: next });
    }, [body, pagedSource, persist, persistedRef]);

    const [pendingIssue, setPendingIssue] = useState<SheetTransactionsIssue | undefined>(undefined);
    const onIssue = useCallback((issue: SheetTransactionsIssue) => {
        dispatch({ t: "editor.blur" });
        setPendingIssue(issue);
    }, [dispatch]);
    useEffect(() => {
        const issue = pendingIssue;
        if (issue === undefined) return;
        const groupIndex = body.findIndex(item => item.kind === "group" && stringEqual(item.row.id, issue.entry));
        const groupItem = body[groupIndex];
        if (issue.row.type === "some" && groupItem?.kind === "group" && groupItem.folded) {
            dispatch({ t: "fold.toggle", r: rowSpace.rowOf[groupIndex]! });
            return;
        }
        const index = issue.row.type === "none" ? body.findIndex(item => (item.kind === "real" || item.kind === "group") && stringEqual(item.row.id, issue.entry))
            : body.findIndex(item => item.kind === "real" && item.group !== undefined && stringEqual(item.group.row.id, issue.entry) && item.group.index === Number(issue.row.value));
        if (index < 0) return;
        const r = rowSpace.rowOf[index]!;
        const field = issue.field.type === "some" ? issue.field.value : undefined;
        const column = field === undefined ? -1 : columns.list.findIndex(col => stringEqual(col.key, field));
        dispatch({ t: "select.set", r, c: Math.max(0, column) });
        setScrollTarget({ index, align: "auto" });
        // The note names the place as the sheet does: the column by its header, else the row by its first text.
        const where = column >= 0 ? columns.list[column]!.header : rowNameOf(rows.find((row) => stringEqual(row.id, issue.entry)), columns) ?? issue.entry;
        dispatchStore({ t: "patch", patch: { msg: { id: "issue", where, issue } } });
        cardRef.current?.focus({ preventScroll: true });
        setPendingIssue(undefined);
    }, [pendingIssue, body, rowSpace, columns, rows, dispatch, cardRef, dispatchStore, setScrollTarget]);
    return { issueSought, onAnchorChange, onIssue, pickSearch, restoreAnchor, revealRef, rowsPick, seek };
}

/** What {@link useSheetJumps} gives the parts after it. */
export type SheetJumps = ReturnType<typeof useSheetJumps>;
