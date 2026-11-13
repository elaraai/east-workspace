/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drawing the rows: each body item as the grid draws it — a run not read yet, a sub row, a proposal, a band, a row a host
 * draws, or the Sheet's own row — with what the optimiser's runs left on it.
 *
 * @packageDocumentation
 */

import { useCallback, type ReactNode } from "react";
import { lineId } from "./model.js";
import type { SheetRowMarks } from "./optimise.js";
import { SheetRow, SheetRunRow, SheetProposalRow, SheetGroupRow, SheetRowBoundary, SheetSubRow } from "./Rows.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetGestures } from "./use-gestures.js";
import type { SheetInput } from "./use-input.js";
import type { SheetOpenEditor } from "./use-open-editor.js";
import type { SheetViewTabs } from "./use-view-tabs.js";
import type { SheetRing } from "./use-ring.js";
import type { SheetScroll } from "./use-scroll.js";
import type { SheetRowParts } from "./use-row-parts.js";
import type { SheetActions } from "./use-actions.js";
import { ariaRowIndexOf, dropText } from "./items.js";

/**
 * Builds the virtual rows' renderer (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetGestures - The history's runner, the discard and the insertion
 * @param sheetInput - The cells' and the grid's handlers
 * @param sheetOpenEditor - The styles and the open editor
 * @param sheetViewTabs - The view tabs, the summary and the folds
 * @param sheetRing - The strip, the active cell and the hint
 * @param sheetScroll - The scroll's report, the sticky rows, the sizes and the motion
 * @param sheetRowParts - The rows' drop, seams, inserts and runs
 * @param sheetActions - The action host, its overlay and the phone's bottom container
 * @returns The row renderer
 */
export function useSheetRows(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetGestures: SheetGestures, sheetInput: SheetInput, sheetOpenEditor: SheetOpenEditor,
    sheetViewTabs: SheetViewTabs, sheetRing: SheetRing, sheetScroll: SheetScroll, sheetRowParts: SheetRowParts,
    sheetActions: SheetActions) {
    const {
        bandPx, columns, driverColumn, folded, gridId, gridTemplate, group, gutterPx, hostGrid, hostLayout, noun,
        registers, rowPx, size, subRowPx, viewPx,
    } = sheetDecode;
    const { canEdit, changesOf, draftOf, editingState, optimised, ui } = sheetSession;
    const { body, colCount, linkCellCtx, memberships, rowSpace } = sheetBody;
    const { onRowDiscard } = sheetGestures;
    const {
        onCellDouble, onCellDown, onCellEnter, onFillRow, onProposalAccept, onProposalPick, onProposalReject, onRowPick,
        onTake,
    } = sheetInput;
    const { edit, styles } = sheetOpenEditor;
    const { onFold, onSubRows } = sheetViewTabs;
    const { anchorR, nextTarget, wr } = sheetRing;
    const { arriving, editorAt, rangeCols, rect } = sheetScroll;
    const {
        bandMixed, dropOn, foldedInserts, insertPreview, movesGroups, movesLines, movesRows, onRowSeamEnter,
        onSeamLeave, retryRead, rowDrop, rowsNoun, runLoading, seamSide, seamsOn,
    } = sheetRowParts;
    const { rowActions } = sheetActions;
    // What the runs of the optimiser left on each row (#1409, R25), by the row's id — a line's by its line id — while the
    // drafts hold it: each row is handed its own marks, held still until a run touches it again.
    const marks: ReadonlyMap<string, SheetRowMarks> | undefined = optimised?.rows;
    const renderRow = useCallback((i: number): ReactNode => {
        const item = body[i];
        if (item === undefined) return null;
        // Its place among the grid's rows (#860).
        const ariaRowIndex = ariaRowIndexOf(item, i, group !== undefined);
        // A run of rows not drawn yet (#1398, CL2): an unloaded run, a stretch the lens reads, or a failed window.
        if (item.kind === "band" || item.kind === "failed") {
            return (
                <SheetRunRow styles={hostGrid?.runStyles ?? styles} band={item.kind === "band" ? item.band : undefined} failure={item.kind === "failed" ? item.failure : undefined}
                    loading={item.kind === "band" && runLoading(item.band)} gridTemplate={gridTemplate} columns={columns} rowPx={rowPx}
                    bandPx={group !== undefined ? bandPx : undefined} dense={size === "sm"} noun={rowsNoun} onRetry={retryRead} ariaRowIndex={ariaRowIndex}
                    // A host's grid (#1531): its lead's shape in the lead track, where it is laid out.
                    lead={hostGrid === undefined ? undefined : hostLayout.lead ? hostGrid.leadRun : null} />
            );
        }
        if (item.kind === "subRow") {
            return (
                <SheetSubRow
                    styles={styles}
                    subRowPx={subRowPx}
                    subRow={item.subRow}
                    parent={item.group.number}
                    index={item.index}
                    count={item.count}
                    gutterPx={gutterPx}
                    viewPx={viewPx}
                    membership={memberships[i]}
                    entering={arriving.has(`line:${item.lineId}`) ? Math.min(item.index, 8) : undefined}
                    ariaRowIndex={ariaRowIndex}
                    colCount={colCount}
                />
            );
        }
        if (item.kind === "proposal") {
            return (
                <SheetProposalRow
                    styles={styles}
                    columns={columns}
                    registers={registers}
                    driverColumn={driverColumn}
                    gridTemplate={gridTemplate}
                    rowPx={rowPx}
                    index={item.index}
                    number={item.number}
                    grouped={item.grouped}
                    cells={item.cells}
                    meta={item.meta}
                    picked={ui.gsel === item.index}
                    linkCtx={linkCellCtx}
                    onPick={onProposalPick}
                    onAccept={onProposalAccept}
                    onReject={onProposalReject}
                    ariaRowIndex={ariaRowIndex}
                    foldedGutter={folded}
                />
            );
        }
        const r = rowSpace.rowOf[i] ?? -1;
        const inRangeRow = ui.selEnd !== null && r >= rect.r0 && r <= rect.r1;
        if (item.kind === "group") {
            if (group === undefined) return null;
            return (
                <SheetRowBoundary styles={styles} rowPx={bandPx} number={item.position + 1} resetKey={item.row}>
                <SheetGroupRow
                    styles={styles}
                    columns={columns}
                    registers={registers}
                    gridTemplate={gridTemplate}
                    bandPx={bandPx}
                    seam={seamsOn ? seamSide(i) : undefined}
                    onSeamEnter={onRowSeamEnter}
                    onSeamLeave={onSeamLeave}
                    insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                    insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                    r={r}
                    row={item.row}
                    number={item.position + 1}
                    idPrefix={gridId}
                    ariaRowIndex={ariaRowIndex}
                    membership={memberships[i]}
                    draft={draftOf(item.row.id)}
                    onDiscard={onRowDiscard}
                    group={group}
                    folded={item.folded}
                    count={item.count}
                    first={i === 0}
                    selC={!ui.ringless && ui.sel.r === r ? ui.sel.c : undefined}
                    range={inRangeRow ? rangeCols : undefined}
                    picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                    mixed={bandMixed(r, wr !== null && r >= wr.r0 && r <= wr.r1)}
                    editor={edit !== null && edit.r === r ? editorAt : undefined}
                    onCellDown={onCellDown}
                    onCellDouble={onCellDouble}
                    onCellEnter={onCellEnter}
                    onRowPick={onRowPick}
                    onFold={onFold}
                    drop={dropOn ? rowDrop : undefined}
                    dropRow={dropOn ? dropText(item) : undefined}
                    movable={movesGroups}
                    foldedGutter={folded}
                    inserts={foldedInserts}
                    marks={marks?.get(item.row.id)}
                />
                </SheetRowBoundary>
            );
        }
        // A host draws the row (#1531): the Sheet's gestures, its cells' content and its editor, in the host's anatomy.
        if (hostGrid !== undefined) {
            const HostRow = hostGrid.Row;
            const real = item.kind === "real" ? item.row : undefined;
            return (
                <SheetRowBoundary styles={styles} rowPx={rowPx} number={item.position + 1} resetKey={real}>
                    <HostRow
                        styles={styles}
                        r={r}
                        row={real}
                        columns={columns}
                        registers={registers}
                        driverColumn={driverColumn}
                        gridTemplate={gridTemplate}
                        layout={hostLayout}
                        rowPx={rowPx}
                        idPrefix={gridId}
                        ariaRowIndex={ariaRowIndex}
                        selC={!ui.ringless && ui.sel.r === r ? ui.sel.c : undefined}
                        range={inRangeRow ? rangeCols : undefined}
                        editor={edit !== null && edit.r === r ? editorAt : undefined}
                        draft={real !== undefined ? draftOf(real.id) : undefined}
                        changes={real !== undefined ? changesOf(real.id, real) : undefined}
                        writable={canEdit && editingState.available}
                        linkCtx={linkCellCtx}
                        actions={rowActions}
                        onCellDown={onCellDown}
                        onCellDouble={onCellDouble}
                        onCellEnter={onCellEnter}
                    />
                </SheetRowBoundary>
            );
        }
        const lg = item.group;
        // A line with sub rows: how many, and whether they hang under it now.
        const subRowCount = item.kind === "real" && lg !== undefined ? lg.row.lines[lg.index]?.subRows.length ?? 0 : 0;
        const nextItem = body[i + 1];
        const subRowsOpen = subRowCount > 0 && nextItem !== undefined && nextItem.kind === "subRow" && item.kind === "real" && nextItem.lineId === item.row.id;
        return (
            <SheetRowBoundary styles={styles} rowPx={rowPx} number={lg !== undefined ? lg.number : item.position + 1} resetKey={item.kind === "real" ? item.row : undefined}>
            <SheetRow
                styles={styles}
                columns={columns}
                registers={registers}
                driverColumn={driverColumn}
                gridTemplate={gridTemplate}
                rowPx={rowPx}
                seam={seamsOn ? seamSide(i) : undefined}
                onSeamEnter={onRowSeamEnter}
                onSeamLeave={onSeamLeave}
                insertPreview={insertPreview?.r === r ? insertPreview.kind : undefined}
                insertSide={insertPreview?.r === r ? insertPreview.side : undefined}
                r={r}
                number={lg !== undefined ? lg.number : item.position + 1}
                idPrefix={gridId}
                ariaRowIndex={ariaRowIndex}
                first={i === 0}
                row={item.kind === "real" ? item.row : undefined}
                group={lg}
                membership={memberships[i]}
                draft={item.kind === "real" ? draftOf(lg?.row.id ?? item.row.id, lg?.key) : undefined}
                onDiscard={item.kind === "real" ? onRowDiscard : undefined}
                linkCtx={linkCellCtx}
                selC={!ui.ringless && ui.sel.r === r ? ui.sel.c : undefined}
                range={inRangeRow ? rangeCols : undefined}
                picked={wr !== null && r >= wr.r0 && r <= wr.r1}
                hit={item.kind === "real" && item.hit}
                editor={edit !== null && edit.r === r ? editorAt : undefined}
                fills={anchorR === r && ui.sugg !== null ? ui.sugg.fill : undefined}
                nextTargetC={nextTarget !== null && nextTarget.r === r ? nextTarget.c : undefined}
                hoverC={ui.hover !== null && ui.hover.r === r ? ui.hover.c : undefined}
                onCellDown={onCellDown}
                onCellDouble={onCellDouble}
                onCellEnter={onCellEnter}
                onRowPick={onRowPick}
                onTake={onTake}
                onFillRow={onFillRow}
                subRowCount={subRowCount > 0 ? subRowCount : undefined}
                subRowsOpen={subRowsOpen}
                onSubRows={onSubRows}
                noun={noun}
                entering={lg !== undefined && arriving.has(`group:${lg.row.id}`) ? Math.min(lg.index, 8) : undefined}
                drop={dropOn ? rowDrop : undefined}
                dropRow={dropOn ? dropText(item) : undefined}
                movable={item.kind === "real" && (lg !== undefined ? movesLines : movesRows)}
                foldedGutter={folded}
                inserts={foldedInserts}
                marks={item.kind === "real" ? marks?.get(lg !== undefined ? lineId(lg.row.id, lg.key) : item.row.id) : undefined}
                actions={rowActions}
            />
            </SheetRowBoundary>
        );
    }, [folded, foldedInserts, draftOf, memberships, seamsOn, seamSide, onRowSeamEnter, onSeamLeave, insertPreview, onRowDiscard, body, styles, runLoading, retryRead, rowsNoun, size, rowSpace, ui.selEnd, ui.sel, ui.sugg, ui.gsel, ui.hover, ui.ringless, rect, rangeCols, columns, registers, driverColumn, gridTemplate, rowPx, bandPx, subRowPx, gutterPx, viewPx, group, noun, wr, bandMixed, edit, editorAt, anchorR, nextTarget, onCellDown, onCellDouble, onCellEnter, onRowPick, onTake, onFillRow, onProposalPick, onProposalAccept, onProposalReject, onFold, onSubRows, linkCellCtx, arriving, gridId, colCount, dropOn, rowDrop, movesGroups, movesLines, movesRows, marks, rowActions, hostGrid, hostLayout, changesOf, canEdit, editingState.available]);
    return { renderRow };
}

/** What {@link useSheetRows} gives the parts after it. */
export type SheetRows = ReturnType<typeof useSheetRows>;
