/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar's items (§7): the view tabs at left, then the lens's context
 * switch and its `n matches · m context` line, and hugging the row's right
 * edge the key search over a paged source's `seek` (in place of the rail's
 * search, which would only filter the loaded prefix), the slice rail (search
 * / filter / cohort on the bound slice), the paged scope badge *loaded rows
 * only*, and the history controls.
 *
 * ONE row, always — nothing wraps and nothing scrolls. They are the frame's
 * toolbar's items, the shared toolbar (#952), folded on one ladder, in this
 * order:
 *   1. the rail gives way first — its affordances fold into summary chips,
 *      then into one chip, then into its icon (every one of them opens the
 *      slice editor popover);
 *   2. the tabs fold into their `+n` menu, one tab at a time, the active tab
 *      always kept;
 *   3. the count line goes;
 *   4. the context switch drops its label;
 *   5. the tab strip drops the `+ TAB` label and the whole-sheet count;
 *   6. the tab names cap at 72px;
 *   7. the context switch goes and the strip closes up, its counts with it;
 *   8. the key search's box folds to its icon, which opens the box in a
 *      popover (#1221) — the shared item the Plan's toolbar takes too;
 *   9. the strip folds into one chip, the open view's tab, whose menu holds
 *      every view, `+ TAB` and the open view's close (#1221) — so a phone's
 *      row holds the views a planner has saved;
 * and the history item folds last, to its buttons.
 * Each is a form of an item, measured and chosen before paint: the toolbar's
 * configuration is a function of its width, whatever width it came from.
 *
 * The items are a part of their own (SB4): `useSheetToolbarItemsFor` builds
 * them, and the Sheet's frame places them in its one toolbar (#1216).
 */

import { useCallback, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { radioGroupKey, HOST_RANK, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { type ToolbarItem, useKeySearchToolbarItem } from "@elaraai/east-ui-components";
import type { SheetTabsFold } from "./Tabs.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetSearch } from "./use-seek.js";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The context switch's stops (B§8). */
const CONTEXTS: readonly LensContext[] = [0, 1, 3];

/** The sheet's own fold ranks, after every step of the slice rail's (#952) —
 *  the order in the module doc. */
const SHEET_RANK = {
    tabFold: HOST_RANK,
    count: HOST_RANK + 1,
    contextLabel: HOST_RANK + 2,
    stripCompact: HOST_RANK + 3,
    stripCapped: HOST_RANK + 4,
    close: HOST_RANK + 5,
    seek: HOST_RANK + 6,
    tabsMenu: HOST_RANK + 7,
} as const;

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
    slice: SliceBindValue | undefined;
    affordances: readonly string[];
    /** The lens count line — empty without a narrowing. */
    count: string;
    /** The paged scope badge. */
    partial: boolean;
    /** The view tabs — with a bound slice. */
    tabs?: SheetToolbarTabs | undefined;
    /** The lens's context switch — while a narrowing is active. */
    context?: { value: LensContext; onChange: (c: LensContext) => void } | undefined;
    /** Key search over the paged source's `seek` — replaces the rail's `search`. */
    search?: SheetSearch | undefined;
    /** A key in the rail's search box the tabs claim (⏎ · esc); returns `true` when claimed. */
    onSearchKey?: ((key: string) => boolean) | undefined;
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
export function useSheetToolbarItemsFor({ styles, slice, affordances, count, partial, tabs, context, search, onSearchKey, history }: SheetToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    // The toolbar's own words (#861).
    const words = useSheetWords();
    const { m } = words;
    // A seek-capable source replaces `search` outright (the Plan's rule):
    // filtering the loaded prefix and seeking the whole source are different
    // operations, and one word for both would mislead.
    const kinds = search !== undefined ? affordances.filter((k) => k !== "search") : affordances;
    const onKeyDownCapture = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (onSearchKey === undefined || (e.key !== "Enter" && e.key !== "Escape")) return;
        if (!(e.target instanceof HTMLInputElement)) return;
        // A highlighted suggestion is the combobox's to take.
        if (e.key === "Enter" && document.querySelector('[data-scope="combobox"][data-part="content"] [data-highlighted]') !== null) return;
        if (onSearchKey(e.key)) { e.preventDefault(); e.stopPropagation(); }
    }, [onSearchKey]);

    // The key search over a seekable source: its box, or its icon on a row short of room.
    const seek = useKeySearchToolbarItem(search, { side: "end", rank: SHEET_RANK.seek, label: m.keySearch() });

    // The rail — its forms wrapped so the tabs can claim the keys its search box takes.
    const railItem = useSliceToolbarItems(slice, [{ key: "rail", kinds, side: "end" }])[0];
    const rail: ToolbarItem | undefined = railItem === undefined ? undefined : {
        ...railItem,
        forms: railItem.forms.map((form) => (
            <Box css={styles.toolbarRail} data-slot="toolbarRail" onKeyDownCapture={onKeyDownCapture}>{form}</Box>
        )),
    };

    // The tabs: one tab at a time into `+n`, then the strip's own closing up,
    // and last the strip as one chip (#1221).
    const tabsItem: ToolbarItem | undefined = tabs === undefined ? undefined : {
        key: "tabs",
        forms: [
            ...Array.from({ length: tabs.maxFold + 1 }, (_f, folded) => tabs.render({ folded })),
            tabs.render({ folded: tabs.maxFold, strip: "compact" }),
            tabs.render({ folded: tabs.maxFold, strip: "capped" }),
            tabs.render({ folded: tabs.maxFold, strip: "closed" }),
            tabs.render({ folded: tabs.maxFold, strip: "menu" }),
        ],
        rank: [
            ...Array.from({ length: tabs.maxFold }, () => SHEET_RANK.tabFold),
            SHEET_RANK.stripCompact, SHEET_RANK.stripCapped, SHEET_RANK.close, SHEET_RANK.tabsMenu,
        ],
        version: tabs.version,
        held: tabs.held,
    };

    // A radio group (#860, the Plan's #632 segment): one tab stop on the
    // checked option; ←/→ and Home/End move and pick; a press picks.
    const contextSwitch = (labelled: boolean) => context === undefined ? null : (
        <Box css={styles.contextSwitch} data-slot="contextSwitch" role="radiogroup" aria-label={m.contextSwitch()}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                radioGroupKey(e, (j) => { const n = CONTEXTS[j]; if (n !== undefined && n !== context.value) context.onChange(n); });
            }}>
            {labelled && <Box as="span" css={styles.contextLabel} aria-hidden="true">{m.contextLabel()}</Box>}
            {CONTEXTS.map((n) => (
                <chakra.button
                    key={n}
                    type="button"
                    css={styles.contextOption}
                    data-slot="contextOption"
                    data-context={n}
                    data-on={context.value === n ? "" : undefined}
                    role="radio"
                    aria-checked={context.value === n}
                    tabIndex={context.value === n ? 0 : -1}
                    onMouseDown={(e: MouseEvent) => { e.preventDefault(); context.onChange(n); }}
                    // Enter or Space on the focused option: a click with no pointer behind it.
                    onClick={(e: MouseEvent) => { if (e.detail === 0) context.onChange(n); }}
                >
                    {m.contextOption({ n, count: words.number(n) })}
                </chakra.button>
            ))}
        </Box>
    );

    return [
        tabsItem,
        context !== undefined && {
            key: "context",
            forms: [contextSwitch(true), contextSwitch(false), null],
            rank: [SHEET_RANK.contextLabel, SHEET_RANK.close],
        },
        count !== "" && {
            key: "count",
            forms: [<Box as="span" css={styles.toolbarCount} data-slot="toolbarCount">{count}</Box>, null],
            rank: SHEET_RANK.count,
        },
        seek,
        rail,
        partial && { key: "badge", side: "end", forms: [<Box as="span" css={styles.toolbarBadge} data-slot="toolbarBadge">{m.scopeBadge()}</Box>] },
        history,
    ];
}
