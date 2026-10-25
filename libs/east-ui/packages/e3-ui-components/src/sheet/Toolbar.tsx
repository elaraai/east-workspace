/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar's items (§7): the view tabs at left, then the lens's
 * `n matches` line, and hugging the row's right edge the key search over a
 * paged source's `seek`, the rail — one over the sheet's `Slice.bindRecords`,
 * each source's fields in source order, the presets, and one summary counting
 * each source (#1345) — the paged scope badge *loaded rows only* while nothing
 * narrows the rows, and the history controls. The count line is the lens's
 * (#1349): it shows while the `rows` source's narrowing narrows the rows.
 *
 * ONE row, always — nothing wraps and nothing scrolls. They are the frame's
 * toolbar's items, the shared toolbar (#952), folded on one ladder, in this
 * order:
 *   1. the rail gives way first — its fields fold into summary chips, then
 *      into one chip, then into its icon (every one of them opens the slice
 *      editor popover);
 *   2. the tabs fold into their `+n` menu, one tab at a time, the active tab
 *      always kept;
 *   3. the count line goes;
 *   4. the tab strip drops the `+ TAB` label and the whole-sheet count;
 *   5. the tab names cap at 72px;
 *   6. the strip closes up, its counts with it;
 *   7. the key search's box folds to its icon, which opens the box in a
 *      popover (#1221) — the shared item the Plan's toolbar takes too;
 *   8. the strip folds into one chip, the open view's tab, whose menu holds
 *      every view, `+ TAB` and the open view's close (#1221) — so a phone's
 *      row holds the views a planner has saved;
 *   9. where the sheet has a key search, the chip folds into the key search's
 *      popover, one move (#1345): its views, `+ TAB` and the open view's
 *      close over the search box, as the Flowchart's orientation sits over
 *      find state's — so a phone's row keeps the rail and Save beside it;
 * and the history item folds last, to its buttons.
 * Each is a form of an item, measured and chosen before paint: the toolbar's
 * configuration is a function of its width, whatever width it came from.
 *
 * The items are a part of their own (SB4): `useSheetToolbarItemsFor` builds
 * them, and the Sheet's frame places them in its one toolbar (#1216).
 */

import { type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { HOST_RANK, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { type ToolbarItem, useKeySearchToolbarItem } from "@elaraai/east-ui-components";
import type { SheetTabsFold } from "./Tabs.js";
import type { SheetSearch } from "./use-seek.js";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;

/** The sheet's own fold ranks, after every step of the slice rail's (#952) —
 *  the order in the module doc. */
const SHEET_RANK = {
    tabFold: HOST_RANK,
    count: HOST_RANK + 1,
    stripCompact: HOST_RANK + 2,
    stripCapped: HOST_RANK + 3,
    close: HOST_RANK + 4,
    seek: HOST_RANK + 5,
    tabsMenu: HOST_RANK + 6,
    searchViews: HOST_RANK + 7,
} as const;

/** The bundle the views' chip and the key search fold into one popover by (#1345). */
const SEARCH_VIEWS = "sheet.searchViews";

/** The view tabs, as the toolbar folds them. */
export interface SheetToolbarTabs {
    /** The strip in a fold. */
    render: (fold: SheetTabsFold) => ReactNode;
    /** How many tabs can fold into `+n` — every view but the active one. */
    maxFold: number;
    /** Changes when what the strip shows does (a view added, renamed or
     *  closed, a count moving, another tab active): its widths are measured again. */
    version: string;
    /** A tab is being renamed: the strip keeps its form. */
    held: boolean;
}

export interface SheetToolbarProps {
    styles: Styles;
    /** The rail (#1345): one over the sheet's `Slice.bindRecords`, its affordances and its persistence; `undefined` with no slice. */
    chrome?: ValueTypeOf<RecordSlicesChromeType> | undefined;
    /** What each source is counted in on the rail's summary, by its name — `rows`, `orders`, `templates`. */
    nouns?: Readonly<Record<string, string>> | undefined;
    /** The lens count line — `3 matches`; empty without a narrowing. */
    count: string;
    /** The paged scope badge: the rows still to load, and nothing narrowing them. */
    partial: boolean;
    /** The view tabs — while the slice narrows the rows. */
    tabs?: SheetToolbarTabs | undefined;
    /** Key search over the paged source's `seek`. */
    search?: SheetSearch | undefined;
    /** The editing session's history item (#988) — undo · redo · discard · apply at the row's end, right of the rail. */
    history?: ToolbarItem | undefined;
}

/**
 * Builds the toolbar's items in the row's order, each with its forms and its
 * fold ranks: what the Sheet's frame places in its toolbar (SB4).
 *
 * @param props - What the items show and drive.
 * @returns The items, a falsy entry for each the sheet has no use for.
 */
export function useSheetToolbarItemsFor({ styles, chrome, nouns, count, partial, tabs, search, history }: SheetToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    // The toolbar's own words (#861).
    const { m } = useSheetWords();

    // The key search over a seekable source: its box, or its icon on a row short of room — and, where the sheet
    // has views, last its popover holding them over its box, the views' chip gone in the same move (#1345).
    const combine = tabs !== undefined && search !== undefined;
    const keySearch = useKeySearchToolbarItem(search, {
        side: "end", rank: SHEET_RANK.seek, label: m.keySearch(),
        compact: combine ? { label: m.keySearchViews(), controls: (close) => tabs.render({ folded: tabs.maxFold, strip: "search", onDone: close }) } : undefined,
    });
    const seek: ToolbarItem | undefined = keySearch !== undefined && combine
        ? { ...keySearch, rank: [SHEET_RANK.seek, SHEET_RANK.searchViews], bundle: [undefined, SEARCH_VIEWS] }
        : keySearch;

    // The rail: one over every source of the sheet's slice, each counted in its own noun (#1345).
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        ...(nouns === undefined ? {} : { nouns }),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map((a) => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });

    // The tabs: one tab at a time into `+n`, then the strip's own closing up,
    // then the strip as one chip (#1221) — and, with a key search, last into
    // the search's popover, the chip gone in the move that folds it there (#1345).
    const tabsItem: ToolbarItem | undefined = tabs === undefined ? undefined : {
        key: "tabs",
        forms: [
            ...Array.from({ length: tabs.maxFold + 1 }, (_f, folded) => tabs.render({ folded })),
            tabs.render({ folded: tabs.maxFold, strip: "compact" }),
            tabs.render({ folded: tabs.maxFold, strip: "capped" }),
            tabs.render({ folded: tabs.maxFold, strip: "closed" }),
            tabs.render({ folded: tabs.maxFold, strip: "menu" }),
            ...(combine ? [null] : []),
        ],
        rank: [
            ...Array.from({ length: tabs.maxFold }, () => SHEET_RANK.tabFold),
            SHEET_RANK.stripCompact, SHEET_RANK.stripCapped, SHEET_RANK.close, SHEET_RANK.tabsMenu,
            ...(combine ? [SHEET_RANK.searchViews] : []),
        ],
        bundle: combine ? [...Array.from({ length: tabs.maxFold + 4 }, () => undefined), SEARCH_VIEWS] : undefined,
        version: tabs.version,
        held: tabs.held,
    };

    return [
        tabsItem,
        count !== "" && {
            key: "count",
            forms: [<Box as="span" css={styles.toolbarCount} data-slot="toolbarCount">{count}</Box>, null],
            rank: SHEET_RANK.count,
        },
        seek,
        ...rail,
        partial && { key: "badge", side: "end", forms: [<Box as="span" css={styles.toolbarBadge} data-slot="toolbarBadge">{m.scopeBadge()}</Box>] },
        history,
    ];
}
