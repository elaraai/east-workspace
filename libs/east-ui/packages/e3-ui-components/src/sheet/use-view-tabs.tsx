/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The view tabs and the lens's chrome: each tab's count, a grouped sheet's summary, the folds, and the lens's count line.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { countNoun, isLooseRow, lineRowsOf, rowIsBlank } from "./model.js";
import { narrowingQuery, narrowingScope } from "./view-state.js";
import { useRecordViewCounts } from "./use-record-view-counts.js";
import { lensCount } from "./lens.js";
import type { SheetWords } from "./words.js";
import { SheetTabs, type SheetTabsFold, type SheetTabView } from "./Tabs.js";
import type { SheetToolbarTabs } from "./Toolbar.js";
import type { SheetSavedView } from "./values.js";
import type { SheetDecode } from "./use-decode.js";
import type { SheetSession } from "./use-session.js";
import type { SheetBody } from "./use-body.js";
import type { SheetMachine } from "./use-machine.js";
import type { SheetOpenEditor } from "./use-open-editor.js";

/** A view's hover title, worded by the existing Sheet message table. */
function viewTitle(view: SheetSavedView, words: SheetWords): string {
    const q = narrowingQuery(view.narrowing).trim();
    return words.m.viewTitle({ scope: narrowingScope(view.narrowing), query: q });
}

/**
 * Reads the view tabs and what the toolbar says of the lens (see the module docs).
 *
 * @param sheetDecode - The decoded columns, layout, callbacks, narrowing and row source
 * @param sheetSession - The store, the lens, the paging, the session and the rows
 * @param sheetBody - The body, the row space and the cells at each place
 * @param sheetMachine - The machine's context and dispatch
 * @param sheetOpenEditor - The styles and the open editor
 * @returns The tabs, the summary, the folds and the lens's count
 */
export function useSheetViewTabs(sheetDecode: SheetDecode, sheetSession: SheetSession, sheetBody: SheetBody,
    sheetMachine: SheetMachine, sheetOpenEditor: SheetOpenEditor) {
    const { allColumns, gridId, group, lensWanted, narrowing, noun, rowsPart, views, words } = sheetDecode;
    const { foldedOf, lens, rows, ui } = sheetSession;
    const { lensLayout } = sheetBody;
    const { dirty, dispatch } = sheetMachine;
    const { styles } = sheetOpenEditor;
    // ── The view tabs and the lens's chrome (B§8) ─────────────────────────
    // A grouped sheet counts LINES (#740) — and its loose rows, each a row of its own (#846). A row is
    // counted by every declared column, the hidden ones too (#1186).
    const countedRows = useMemo(() => (group !== undefined ? rows.flatMap((g) => (isLooseRow(g) ? [g] : lineRowsOf(g))) : rows), [group, rows]);
    const wholeCount = useMemo(() => countedRows.filter((row) => !rowIsBlank(row, allColumns)).length, [countedRows, allColumns]);
    // Each tab counts the rows its view's narrowing of the `rows` source shows, through the record's indexes (#1345):
    // the records — a grouped sheet's groups — never the resident rows.
    const recordViewCounts = useRecordViewCounts(rowsPart, views);
    const tabWholeCount = recordViewCounts.ok ? recordViewCounts.value.total : undefined;
    const tabViews = useMemo<SheetTabView[]>(() => {
        if (rowsPart === undefined) return [];
        return views.map((v) => {
            const result = recordViewCounts.ok ? recordViewCounts.value.counts.get(v.id) : undefined;
            return { id: v.id, name: v.name, count: result?.count,
                title: result?.error === undefined ? viewTitle(v, words) : `${viewTitle(v, words)} — ${result.error}` };
        });
    }, [rowsPart, recordViewCounts, views, words]);
    const summary = useMemo(() => {
        if (group === undefined) return undefined;
        // The groups, their lines and the sub rows under them — and the loose rows between the groups (#846).
        const groups = rows.filter((g) => !isLooseRow(g));
        const lines = groups.reduce((n, g) => n + g.lines.length, 0);
        const looseCount = rows.length - groups.length;
        const subRows = groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.subRows.length, 0), 0);
        return words.m.summary({
            groups: countNoun(groups.length, noun, words), n: lines, lines: words.number(lines),
            nLoose: looseCount, loose: words.number(looseCount), nSub: subRows, subRows: words.number(subRows),
        });
    }, [group, noun, rows, words]);
    const onTabSwitch = useCallback((id: string | null) => dispatch({ t: "tab.switch", id }), [dispatch]);
    const onTabCreate = useCallback(() => dispatch({ t: "tab.create" }), [dispatch]);
    const onTabClose = useCallback((id: string) => dispatch({ t: "tab.close", id }), [dispatch]);
    const onTabRenameStart = useCallback((id: string) => dispatch({ t: "tab.rename.start", id }), [dispatch]);
    const onTabRenameChange = useCallback((val: string) => dispatch({ t: "tab.rename.change", val }), [dispatch]);
    const onTabRenameCommit = useCallback(() => dispatch({ t: "tab.rename.commit" }), [dispatch]);
    const onTabRenameCancel = useCallback(() => dispatch({ t: "tab.rename.cancel" }), [dispatch]);
    const onTabReorder = useCallback((id: string, to: number) => dispatch({ t: "tab.reorder", id, to }), [dispatch]);
    const onFold = useCallback((r: number, all?: boolean) => dispatch({ t: "fold.toggle", r, ...(all === true ? { all: true } : {}) }), [dispatch]);
    // A line's chevron: its sub rows show or hide; ⌥ takes the group's every line.
    const onSubRows = useCallback((r: number, all: boolean) => dispatch({ t: "subRows.toggle", r, ...(all ? { all: true } : {}) }), [dispatch]);
    // The header corner's fold-all: whether every group is folded decides which way it goes.
    const onFoldAll = useCallback((folded: boolean) => dispatch({ t: "fold.all", folded }), [dispatch]);
    const foldAll = useMemo(() => {
        if (group === undefined) return undefined;
        // Loose rows have nothing to fold (#846): fold-all passes them by.
        const groups = rows.filter((row) => !isLooseRow(row));
        return { folded: groups.length > 0 && groups.every((row) => foldedOf(row)), count: groups.length, noun, onFoldAll };
    }, [group, noun, rows, foldedOf, onFoldAll]);
    const hasQuery = narrowing !== undefined && narrowingQuery(narrowing).trim() !== "";
    // Whether any source holds a choice: what a phone's strip offers `+ TAB` over, on the whole sheet (FR2).
    const narrowed = narrowing !== undefined && narrowingScope(narrowing) !== "none";
    // The view tabs, as the toolbar folds them (#952): the strip in each of
    // its forms, how far it can fold, and what it shows — so a change of it
    // has the strip measured again.
    const tabsVersion = `${tabViews.map((v) => `${v.id}:${v.name}:${v.count}`).join("|")}|${tabWholeCount}|${ui.tabs.active ?? ""}|${dirty}|${hasQuery}|${narrowed}`;
    // The view tabs show while the slice narrows the rows: each view is every source's narrowing.
    const tabs: SheetToolbarTabs | undefined = rowsPart !== undefined
        ? {
            maxFold: tabViews.length - (tabViews.some((v) => v.id === ui.tabs.active) ? 1 : 0),
            version: tabsVersion,
            held: ui.tabs.renaming !== null,
            render: (fold: SheetTabsFold) => (
                <SheetTabs
                    styles={styles}
                    views={tabViews}
                    wholeCount={tabWholeCount}
                    active={ui.tabs.active}
                    dirty={dirty}
                    hasQuery={hasQuery}
                    narrowed={narrowed}
                    renaming={ui.tabs.renaming}
                    renameVal={ui.tabs.renameVal}
                    fold={fold}
                    onSwitch={onTabSwitch}
                    onCreate={onTabCreate}
                    onClose={onTabClose}
                    onRenameStart={onTabRenameStart}
                    onRenameChange={onTabRenameChange}
                    onRenameCommit={onTabRenameCommit}
                    onRenameCancel={onTabRenameCancel}
                    onReorder={onTabReorder}
                    panelId={gridId}
                />
            ),
        }
        : undefined;
    // The lens's count line (#1349): the rows — a grouped sheet's groups — the narrowing holds, as e3 counts them.
    const lensMatches = lens.matches;
    const count = !lensWanted || lensLayout === undefined ? "" : lensCount(lensMatches ?? lensLayout.hits, words);
    return { count, foldAll, lensMatches, onFold, onSubRows, summary, tabs, wholeCount };
}

/** What {@link useSheetViewTabs} gives the parts after it. */
export type SheetViewTabs = ReturnType<typeof useSheetViewTabs>;
