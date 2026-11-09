/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The parts as the frame places them (SB4): the optimiser's parts, the toolbar's items, what a host's chrome counts, the
 * root's facts, the footer and the history; and the grid — the header with its sticky copies, the rows, a host's empty
 * state, the strip or a phone's bottom container, and the action overlay — or, where the source failed before any row
 * landed, why.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { optimiseMessages, historyToolbarItem } from "@elaraai/east-ui-components";
import { VirtualRows } from "@elaraai/east-ui-components/internal";
import { BOTTOM_PAD_PX } from "./model.js";
import { clearNarrowing, clearSearch, narrowingEqual, narrowingQuery, writeNarrowing } from "./view-state.js";
import { useOptimiseParts } from "../shared/func/optimise-parts.js";
import { landSheetOptimise, sheetOptimisePeriod, sheetOptimiseRequest, type SheetOptimiseRequest } from "./optimise.js";
import { noticeText } from "./words.js";
import { SheetInsertLayer, SheetInsertStrip } from "./Insertion.js";
import { SheetHeader } from "./Header.js";
import { SheetRow, SheetGroupRow, SheetRetry } from "./Rows.js";
import { SheetPager, useWindowFirst } from "./Pager.js";
import { SheetStrip } from "./Strip.js";
import { layerCounts } from "./local-rows.js";
import type { SheetFooterProps } from "./Footer.js";
import { sheetToolbarRow, useSheetToolbarPartsFor } from "./Toolbar.js";
import type { SheetRootValue } from "./values.js";
import { PHONE_PIN_PX, type SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetEffects } from "./use-effects.js";
import type { SheetGestures } from "./use-gestures.js";
import type { SheetInput } from "./use-input.js";
import type { SheetOpenEditor } from "./use-open-editor.js";
import type { SheetReading } from "./use-reading.js";
import type { SheetJumps } from "./use-jumps.js";
import type { SheetViewTabs } from "./use-view-tabs.js";
import type { SheetRing } from "./use-ring.js";
import type { SheetScroll } from "./use-scroll.js";
import type { SheetRowParts } from "./use-row-parts.js";
import type { SheetActions } from "./use-actions.js";
import type { SheetRows } from "./use-rows.js";
import type { SheetInspector } from "./use-inspector.js";
import type { SheetDrops } from "./use-drops.js";
import type { SheetEntries, SheetHistory, SheetOptimiseParts, SheetParts, SheetRootFacts } from "./parts.js";
import { dropText } from "./items.js";

/** The rows' scroll element: sideways as wide as the columns; on a phone, snapping to a column — past a pinned one (SH1.3). */
const WIDE_ROOT_CSS = { overflowX: "auto" } as const;

const PHONE_ROOT_CSS = { overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none" } as const;

const PHONE_PINNED_ROOT_CSS = { ...PHONE_ROOT_CSS, scrollPaddingLeft: `${PHONE_PIN_PX}px` } as const;

/**
 * Puts the sheet's shared state together as the parts the frame places (see the module docs).
 *
 * @param value - The Sheet root value
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetEffects - The effect runner and what its effects reach
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @param sheetInput - The cells' and the grid's handlers
 * @param sheetOpenEditor - The styles and the open editor
 * @param sheetReading - The loading line and the frame's loading facts
 * @param sheetJumps - The key search, the scroll's anchor and the issue gone to
 * @param sheetViewTabs - The view tabs, the summary and the folds
 * @param sheetRing - The strip, the active cell and the hint
 * @param sheetScroll - The scroll's report, the sticky rows, the sizes and the motion
 * @param sheetRowParts - The rows' drop, seams, inserts and runs
 * @param sheetActions - The action host, its overlay and the phone's bottom container
 * @param sheetRows - The row renderer
 * @param sheetInspector - The inspector's reads and gestures, and a host's Add and Delete
 * @param sheetDrops - The library's ⏎ and the phone's Library
 * @returns The parts
 */
export function useSheetAssembled(value: SheetRootValue, sheetDecode: SheetDecode, sheetSession: SheetSession,
    sheetBody: SheetBody, sheetMachine: SheetMachine, sheetEffects: SheetEffects, sheetGestures: SheetGestures,
    sheetInput: SheetInput, sheetOpenEditor: SheetOpenEditor, sheetReading: SheetReading, sheetJumps: SheetJumps,
    sheetViewTabs: SheetViewTabs, sheetRing: SheetRing, sheetScroll: SheetScroll, sheetRowParts: SheetRowParts,
    sheetActions: SheetActions, sheetRows: SheetRows, sheetInspector: SheetInspector,
    sheetDrops: SheetDrops): SheetParts {
    const {
        bandPx, canInsertGroups, canInsertRows, chrome, columns, copilotOn, decodedRows, driverColumn, folded, gridId,
        gridTemplate, group, gutterPx, hostGrid, hostLayout, keyed, lensWanted, loose, minWidth, narrowing, noun,
        numberPx, pagedColumns, pagedSource, pagerColumns, phoneColumns, phoneFrame, pinPx, pinned, readOnly, registers,
        rowNumbers, rowPx, rowsPart, setRowNumbers, setViewport, slotPx, viewPx, viewport, words,
    } = sheetDecode;
    const {
        canEdit, changesOf, draftOf, draftType, draftVersion, editingState, exhausted, gestureCount, keyHeld, landRef,
        landing, landingRoot, landingStyles, layer, lens, lensDrawn, locked, optimiseTypes, optimised, paging, rows,
        run, session, setOptimised, sourceRows, standingIn, total, totalRevision, ui,
    } = sheetSession;
    const { body, colCount, lensLayout, linkCellCtx, memberships, rowAt, rowSpace } = sheetBody;
    const { emptyNarrowing } = sheetMachine;
    const { cardRef, scrollTarget, toolbarRef } = sheetEffects;
    const { actedRef, anchorFor, onHistoryAction, onInsert, onRowDiscard } = sheetGestures;
    const {
        actionApi, onCellDouble, onCellDown, onCellEnter, onCopy, onFillRow, onGridLeave, onKeyDown, onPaste, onRowPick,
        onTake,
    } = sheetInput;
    const { edit, onStripAction, styles } = sheetOpenEditor;
    const { busy, cold, line, loadingFacts, sourceFailure } = sheetReading;
    const { onAnchorChange, pickSearch, restoreAnchor, scrollNonce } = sheetJumps;
    const { count, foldAll, lensMatches, onFold, onSubRows, summary, tabs, wholeCount } = sheetViewTabs;
    const {
        activeCell, ariaRowCount, hint, previewed, ringCol, ringItem, strip, suggested, unreadRuns, wr,
    } = sheetRing;
    const {
        anchorable, headerRef, itemKey, moving, reportRange, revealLine, setNumberProbe, sizeOf, stickyAt, stickyLineAt,
        stickyLineRef, widest,
    } = sheetScroll;
    const {
        bandMixed, dropOn, foldedInserts, insertActions, insertLayerRef, onSeamLeave, railNouns, rowDrop, rowsNoun,
        seam, seamsOn,
    } = sheetRowParts;
    const { actionBar, actionOverlayNode, cellEditor } = sheetActions;
    const { renderRow } = sheetRows;
    const { addRow, conflictValue, goToIssue, inspect, removeRowsById, rowWhere, versionOf } = sheetInspector;
    const { enter, phoneLibrary } = sheetDrops;
    // ── The app's optimiser's parts (#1409, #1418) ─────────────────────────
    // The eye before the history item, the banner, the footer line and the legend, over the run (`use-session.ts`); the request
    // is the tab's rows as the session holds them, and the result lands as one step once the rows have moved.
    const period = sheetOptimisePeriod(wholeCount, group !== undefined ? noun : undefined, rowsNoun, words);
    const optimiseKeyType = optimiseTypes.keyType;
    // The eye is listed only where the rows can be optimised (ruled 25 Oct 2026): never read only; while a narrowing's
    // rows are read it waits, disabled, in its place.
    const optimiseParts = useOptimiseParts<SheetOptimiseRequest>({
        run, landing, period, readOnly, busy: !editingState.available,
        request: (n) => sheetOptimiseRequest(rows, versionOf, draftType, optimiseKeyType, n), landKey: rows,
    });
    actedRef.current = optimiseParts.acted;
    const originalVersion = editingState.original;
    const recordVersions = editingState.recordVersions;
    const landAfter = optimiseParts.landAfter;
    landRef.current = (result, request, n) => {
        const runText = words.number(n);
        const landed = landSheetOptimise({
            editing: value.editing, types: optimiseTypes, draftType, keyed, request, result, label: optimiseMessages.step({ run: runText }), runText,
            versionOf: (id) => versionOf(id) ?? originalVersion(id), record: recordVersions, before: optimised,
        });
        if (landed === undefined) return undefined;
        // A run that changed nothing leaves what earlier runs left (R10).
        if (landed.optimised !== undefined) { setOptimised(landed.optimised); landAfter(n); }
        return landed.counts;
    };
    // What a run left on the rows goes with the drafts (R17): once nothing is pending — Save, Discard — nothing is
    // marked. An Undo leaves nothing pending too, but its Redo brings the run's step back (R9): what the run left is
    // kept while that step is the next to redo.
    const sessionPending = session.pending;
    // `draftVersion` tracks the session's pending count and its redo stack, which the session object itself does not move with.
    useEffect(() => {
        if (sessionPending === 0 && session.nextRedo?.origin !== "optimise") setOptimised(undefined);
    }, [sessionPending, draftVersion, session, setOptimised]);
    const flash = optimised !== undefined && landing.lit;

    // ── The parts' facts: the toolbar's items (§7), the root, the footer ──
    const toolbarParts = useSheetToolbarPartsFor({
        styles,
        chrome,
        nouns: railNouns,
        count,
        // Loaded rows only, while nothing narrows them: a `rows` source pages the record's own narrowing.
        partial: pagedSource !== undefined && !exhausted && rowsPart === undefined,
        tabs,
        search: pickSearch,
        // The session's error is the frame's banner (#1184), never a line under the item. Its issues button goes to the
        // first issue as the Issues tab's lines do: sought where its row is not drawn, its filters cleared where they hide it.
        history: !readOnly ? historyToolbarItem({ session, words, editing: ui.edit !== null, onAction: onHistoryAction, onIssue: goToIssue, where: rowWhere, conflictValue, showError: false, locked }) : undefined,
        optimise: optimiseParts.toolbarItem,
        flash,
    });
    const toolbar = { items: sheetToolbarRow(toolbarParts), parts: toolbarParts, ref: toolbarRef };
    // What a host's own chrome counts and changes (#1533). The record's rows and the narrowing's, the drafts applied:
    // each new row one more of both — under the lens a planner's row stands among the narrowing's until the record says
    // otherwise — and each row a draft removes one fewer; a Save's, only while the count was read before it (#1536).
    // The narrowing's count is the lens's placement, read with the record's count; else its layout's, read with the rows
    // it draws — which a Save's rows are drawn over only while they were read before it.
    const savedFrom = editingState.savedFrom;
    const ofRecord = layerCounts(layer, savedFrom, totalRevision);
    const recordTotal = decodedRows !== undefined ? rows.length : total === undefined ? undefined : total + ofRecord.added - ofRecord.removed;
    const narrowedCount = !lensDrawn ? undefined : lensMatches ?? lensLayout?.hits;
    const ofNarrowing = narrowedCount === undefined ? undefined : layerCounts(layer, savedFrom, lensMatches !== undefined ? lens.revision : undefined, sourceRows);
    const entries: SheetEntries = {
        rows,
        whole: decodedRows !== undefined || (!unreadRuns && (lensDrawn ? lensLayout !== undefined : paging.exhausted)),
        count: { shown: !lensDrawn ? recordTotal : narrowedCount === undefined || ofNarrowing === undefined ? undefined : narrowedCount + ofNarrowing.added - ofNarrowing.removed, total: recordTotal },
        notice: ui.msg,
        gestures: gestureCount.current,
        add: addRow,
        remove: removeRowsById,
    };
    const root: SheetRootFacts = {
        partial: pagedSource !== undefined && !exhausted,
        copilot: copilotOn,
        lens: lensWanted,
        view: ui.tabs.active ?? undefined,
        moving,
    };
    // Ask again: the lens's reads while it narrows the rows, else the pages' (#853, #1349).
    const lensRetry = lens.retry;
    const pagesRetry = paging.retry;
    const retrySource = useCallback(() => { if (lensWanted) lensRetry(); else pagesRetry(); }, [lensWanted, lensRetry, pagesRetry]);
    const footer: SheetFooterProps = {
        styles, items: value.footer, summary, hint, message: ui.msg === null ? "" : noticeText(ui.msg, words), loading: line, noun: rowsNoun, onRetry: retrySource,
        optimise: { line: optimiseParts.line, legend: optimiseParts.legend },
    };
    const history: SheetHistory = { session, onAction: onHistoryAction };
    const optimise: SheetOptimiseParts = { banner: optimiseParts.banner, landing: { ref: landingRoot, attributes: landing.attributes, css: landingStyles.main } };
    // Where a phone's window rests, read as the pager reads it, for a host's header (#1536): a group's label is cut to
    // its columns in view, so it holds clear of the pinned column as the window pages.
    const hostPhone = hostGrid !== undefined && phoneFrame;
    const [windowFirst] = useWindowFirst(hostPhone ? viewport?.frame ?? null : null, slotPx, Math.max(0, pagerColumns.length - phoneColumns));

    if (sourceFailure !== undefined) {
        const failure = (
            <Box css={styles.diagnostic} data-sheet-error role="alert">
                {words.m.noSource({ reason: sourceFailure })}
                <SheetRetry styles={styles} onRetry={retrySource} />
            </Box>
        );
        return { styles, root, toolbar, grid: null, footer, loading: loadingFacts, history, failure, inspect, enter, optimise, phoneLibrary, entries };
    }

    const stickyItem = stickyAt !== undefined ? body[stickyAt] : undefined;
    // The open line whose sub rows scroll under the band.
    const stuck = stickyLineAt !== undefined ? body[stickyLineAt] : undefined;
    const stuckLine = stickyLineAt !== undefined && stuck !== undefined && stuck.kind === "real" && stuck.group !== undefined
        ? { at: stickyLineAt, r: rowSpace.rowOf[stickyLineAt] ?? -1, row: stuck.row, lg: stuck.group, hit: stuck.hit, dropRow: dropText(stuck) }
        : undefined;
    const HostHeader = hostGrid?.Header;
    const header = (
        <Box ref={headerRef} position="relative">
            {HostHeader !== undefined
                // A host's header (#1531): its column cells are `headerCell`s, as the Sheet's, which a key's reveal reads.
                ? <HostHeader columns={columns.list} gridTemplate={gridTemplate} layout={hostLayout} rowPx={rowPx} rowIds={rows.map((row) => row.id)}
                    columnWindow={hostPhone && slotPx > 0 ? { first: windowFirst, inView: phoneColumns, slotPx } : undefined} />
                : <SheetHeader styles={styles} columns={columns.list} gridTemplate={gridTemplate} picked={wr !== null} foldAll={foldAll} rowNumbers={rowNumbers}
                    selected={phoneFrame && ui.selEnd === null && (ringItem?.kind === "real" || ringItem?.kind === "group") ? ringCol : undefined} />}
            {stickyItem !== undefined && stickyItem.kind === "group" && group !== undefined && stickyAt !== undefined && (
                // The band of the group whose lines scroll under the header (G1) — laid over the rows, so the list never moves.
                // A copy: the band itself is the grid's row (#860).
                <Box position="absolute" top="100%" left="0" right="0" aria-hidden="true">
                    <SheetGroupRow
                        styles={styles}
                        columns={columns}
                        registers={registers}
                        gridTemplate={gridTemplate}
                        bandPx={bandPx}
                        r={rowSpace.rowOf[stickyAt] ?? -1}
                        row={stickyItem.row}
                        number={stickyItem.position + 1}
                        membership={memberships[stickyAt]}
                        draft={draftOf(stickyItem.row.id)}
                        onDiscard={onRowDiscard}
                        group={group}
                        folded={stickyItem.folded}
                        count={stickyItem.count}
                        sticky
                        selC={undefined}
                        range={undefined}
                        picked={false}
                        mixed={bandMixed(rowSpace.rowOf[stickyAt] ?? -1, false)}
                        editor={undefined}
                        onCellDown={onCellDown}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                        onRowPick={onRowPick}
                        onFold={onFold}
                        // A drop over the copy lands on its band: the band itself lies under the header (#1187).
                        drop={dropOn ? rowDrop : undefined}
                        dropRow={dropOn ? dropText(stickyItem) : undefined}
                        foldedGutter={folded}
                        inserts={foldedInserts}
                    />
                </Box>
            )}
            {stuckLine !== undefined && (
                // The line whose sub rows scroll under the band: laid over the rows just under the band, and
                // BENEATH the band and the header (z −1 inside the pinned header), so it slides away under them as its last
                // sub row leaves. A press on it first brings the line itself back under the band (`revealLine`). A copy,
                // like the band's (#860).
                <Box ref={stickyLineRef} position="absolute" left="0" right="0" zIndex="-1" aria-hidden="true">
                    <SheetRow
                        styles={styles}
                        columns={columns}
                        registers={registers}
                        driverColumn={driverColumn}
                        gridTemplate={gridTemplate}
                        rowPx={rowPx}
                        r={stuckLine.r}
                        number={stuckLine.lg.number}
                        row={stuckLine.row}
                        group={stuckLine.lg}
                        membership={memberships[stuckLine.at]}
                        draft={draftOf(stuckLine.lg.row.id, stuckLine.lg.key)}
                        onDiscard={onRowDiscard}
                        linkCtx={linkCellCtx}
                        selC={undefined}
                        range={undefined}
                        picked={false}
                        hit={stuckLine.hit}
                        editor={undefined}
                        fills={undefined}
                        nextTargetC={undefined}
                        hoverC={undefined}
                        onCellDown={(r, c, e) => { if (e.button === 0) revealLine(stuckLine.at, false); onCellDown(r, c, e); }}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                        onRowPick={(r, e) => { if (e.button === 0) revealLine(stuckLine.at, false); onRowPick(r, e); }}
                        onTake={onTake}
                        onFillRow={onFillRow}
                        subRowCount={stuckLine.lg.row.lines[stuckLine.lg.index]?.subRows.length ?? 0}
                        subRowsOpen
                        onSubRows={(r, all) => { revealLine(stuckLine.at, all); onSubRows(r, all); }}
                        noun={noun}
                        sticky
                        drop={dropOn ? rowDrop : undefined}
                        dropRow={dropOn ? stuckLine.dropRow : undefined}
                        foldedGutter={folded}
                        inserts={foldedInserts}
                    />
                </Box>
            )}
        </Box>
    );
    // A host's empty state (#1531): under its header, once every row is read and the narrowing leaves none to show.
    const HostEmpty = hostGrid?.Empty;
    const searched = narrowing !== undefined && narrowingQuery(narrowing).trim() !== "";
    const narrowedAll = narrowing !== undefined && emptyNarrowing !== undefined && !narrowingEqual(narrowing, emptyNarrowing);
    const empty = HostEmpty !== undefined && narrowing !== undefined && narrowedAll && body.length === 0 && cold !== true && !busy
        ? <HostEmpty query={searched} onClear={() => { if (chrome !== undefined) writeNarrowing(chrome, searched ? clearSearch(narrowing) : clearNarrowing(narrowing)); }} />
        : undefined;
    // The strip docked under the rows: an action's, else the Sheet's — or a host's (#1533), its own words for the cell
    // under the pointer, else the ring's, and the Sheet's while that speaks of what is in hand.
    const actionStrip = actionApi.current?.strip();
    const sheetStrip = actionStrip ?? strip;
    const HostStrip = hostGrid?.Strip;
    const stripItem = previewed === undefined ? undefined : rowAt(previewed.r);
    const stripColumn = previewed === undefined ? undefined : columns.list[previewed.c];
    const stripAt = previewed !== undefined && stripItem?.kind === "real" && stripColumn !== undefined
        ? { r: previewed.r, row: stripItem.row, column: stripColumn, changes: changesOf(stripItem.row.id, stripItem.row) } : undefined;
    const stripNode = HostStrip !== undefined
        ? <HostStrip styles={styles} model={sheetStrip} onAction={onStripAction} own={edit !== null || ui.selEnd !== null || suggested !== undefined || actionStrip !== undefined}
            at={stripAt} columns={columns} registers={registers} writable={canEdit && editingState.available} />
        : <SheetStrip styles={styles} model={sheetStrip} onAction={onStripAction} />;
    // The grid with its strip (SB4): the card — the header, the rows and the
    // insertion layer — the insertion strip, and the strip docked under them.
    const grid = (
        <>
            {/* A phone's column pager over the grid (SH1): the window of columns beside any pinned one — its `Row number` the Sheet's own. */}
            {phoneFrame && pagedColumns.length > phoneColumns && (
                <SheetPager styles={styles} frame={viewport?.frame ?? null} columns={pagerColumns} slotPx={slotPx} inView={phoneColumns} rowNumbers={rowNumbers}
                    onRowNumbers={hostGrid === undefined ? setRowNumbers : undefined} />
            )}
            <Box
                ref={cardRef}
                id={gridId}
                css={styles.card}
                tabIndex={0}
                data-sheet-card
                // Where the gutter ends — what the seam lines start from — whether it folded (#1215), and how wide its number column is.
                data-gutter={folded ? "folded" : undefined}
                // A phone's frame (`Mobile Sheet Spec.md`): its window of columns, any pinned column, its band across the view.
                data-phone={phoneFrame ? "" : undefined}
                data-pin={pinned ? "" : undefined}
                data-row-numbers={rowNumbers ? "" : undefined}
                style={{ "--sheet-gutter": `${gutterPx}px`, "--sheet-number": `${numberPx}px`, "--sheet-view": `${viewPx ?? 0}px`, "--sheet-pin": `${pinPx}px` } as CSSProperties}
                role="grid"
                // Rows that stand in — a narrowing's last, or those a key's far jump holds — are retained (#1398, CL8,
                // CL10): readable and walked by the keys, the frame's main busy, and taking no edit, drag or drop.
                aria-disabled={standingIn || keyHeld ? true : undefined}
                aria-rowcount={ariaRowCount}
                aria-colcount={colCount + (hostGrid !== undefined && gutterPx === 0 ? 0 : 1)}
                aria-multiselectable
                aria-activedescendant={activeCell}
                onKeyDown={onKeyDown}
                onCopy={onCopy}
                onPaste={onPaste}
                onMouseLeave={hostGrid !== undefined ? onGridLeave : undefined}
            >
                <VirtualRows
                    height={undefined}
                    maxHeight={undefined}
                    fillParent
                    header={header}
                    // A host's grid has no padding under its rows (#1531): its empty state, when it shows one.
                    footer={hostGrid === undefined ? <Box height={`${BOTTOM_PAD_PX}px`} /> : empty}
                    count={body.length}
                    estimateSize={sizeOf}
                    getItemKey={itemKey}
                    anchorable={anchorable}
                    onViewport={setViewport}
                    renderRow={renderRow}
                    minWidth={`${minWidth}px`}
                    headerZIndex={6}
                    scrollToIndex={scrollTarget?.index}
                    scrollNonce={scrollNonce}
                    scrollAlign={scrollTarget?.align ?? "auto"}
                    onRangeChange={pagedSource !== undefined ? reportRange : undefined}
                    sizeVersion={lensDrawn ? lens.sizeVersion : paging.sizeVersion}
                    // Where the scroll rests, persisted and restored as an item (#857).
                    onAnchorChange={onAnchorChange}
                    restoreAnchor={restoreAnchor}
                    // A phone's columns snap to the window's slots, past any pinned column (SH1.3).
                    rootCss={phoneFrame ? (pinned ? PHONE_PINNED_ROOT_CSS : PHONE_ROOT_CSS) : WIDE_ROOT_CSS}
                />
                {seam !== undefined && seamsOn && (
                    <SheetInsertLayer ref={insertLayerRef} styles={styles} seam={seam} actions={insertActions(seam.r, seam.side)} onLeave={onSeamLeave} />
                )}
                {/* What the number column is measured by: the widest numbers, drawn as the rows draw them at their boldest (a hit's) — never shown, never hit. */}
                <Box as="span" ref={setNumberProbe} css={styles.numberMeasure} data-slot="numberMeasure" aria-hidden="true">
                    <Box as="span" css={styles.gutterNumber} data-hit="">{widest.plain}</Box>
                    {widest.chevron > 0 && <Box as="span" css={styles.gutterNumber} data-hit="" data-chevron="">{widest.chevron}</Box>}
                </Box>
            </Box>
            {/* With rows picked; or, with none, only once a completed read says there are none (#1398, CL13) — never while a paged source is still read. */}
            {hostGrid === undefined && (wr !== null && edit === null || (rows.length === 0 && exhausted)) && canEdit && editingState.available && <SheetInsertStrip styles={styles}
                ordered={!keyed || anchorFor(ui.sel.r, "before").child !== undefined}
                above={canInsertRows ? () => onInsert("row", wr?.r0 ?? ui.sel.r, "before") : undefined}
                below={canInsertRows && (group === undefined || loose || rows.length > 0) ? () => onInsert("row", wr?.r1 ?? ui.sel.r, "after") : undefined}
                group={canInsertGroups ? () => onInsert("group", wr?.r1 ?? ui.sel.r, "after") : undefined}
                noun={noun.singular} />}
            {cellEditor ?? actionBar ?? stripNode}
            {actionOverlayNode}
        </>
    );
    return { styles, root, toolbar, grid, footer, loading: loadingFacts, history, failure: undefined, inspect, enter, optimise, phoneLibrary, entries };
}
