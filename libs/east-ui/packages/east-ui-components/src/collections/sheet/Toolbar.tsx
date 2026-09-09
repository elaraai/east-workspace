/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar row (§7): the view tabs at left, then the lens's context
 * switch and its `n matches · m context` line, and, taking the rest of the
 * row and hugging its right edge, the key search over a paged source's
 * `seek` (in place of the rail's search, which would only filter the
 * loaded prefix), the slice rail cluster (search / filter / cohort on the
 * bound slice) and the paged scope badge *loaded rows only*. Mounts only
 * when the sheet has a reason: a bound slice or a paged source.
 *
 * ONE row, always — nothing wraps and nothing scrolls. Under width pressure
 * the rail gives way first: it folds its affordances into summary chips,
 * then into one chip, then into its icon alone (every rung opens the slice
 * editor popover). Only when the rail is at its icon do the tabs give way,
 * folding into their `+n` menu; only when the tabs are at their floor — the
 * whole-sheet tab, the active tab, `+n`, `+ TAB` — does the toolbar's own
 * ladder run: the count line goes, then the context switch's label, then
 * the `+ TAB` label and the whole-sheet count, then the tab names cap at
 * 72px, and last the context switch itself (the strip closing up and
 * dropping its counts with it). The first two steps are the flex
 * layout's by construction (the rail group takes the leftover and has a
 * floor; the tabs shrink only past it); for the third the strip reports
 * through {@link SheetTabsFoldContext} when it is at its floor and still
 * overflowing, and the toolbar climbs one rung per report — moving the
 * strip's measure key after each, so the strip measures again and the
 * ladder settles before paint. Growth resets it once the width has settled
 * (the rail's rule), as does the count or the context switch coming or
 * going.
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail/index.js";
import { DatasetKeySearch } from "../key-search/index.js";
import { SheetTabsFoldContext, type SheetTabsFold } from "./fold-context.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetSearch } from "./use-seek.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The context switch's stops (B§8). */
const CONTEXTS: readonly LensContext[] = [0, 1, 3];

/** The toolbar's ladder (the recipe reads `data-tight`): 1 drops the count, 2 the
 *  context label, 3 the `+ TAB` label and the whole-sheet count, 4 caps the tab
 *  names, 5 drops the context switch, closes the strip up and drops every count. */
const TIGHT_MAX = 5;

export interface SheetToolbarProps {
    styles: Styles;
    slice: SliceBindValue | undefined;
    affordances: readonly string[];
    /** The lens count line — empty without a narrowing. */
    count: string;
    /** The paged scope badge. */
    partial: boolean;
    /** The view tabs — with a bound slice. */
    tabs?: ReactNode | undefined;
    /** The lens's context switch — while a narrowing is active. */
    context?: { value: LensContext; onChange: (c: LensContext) => void } | undefined;
    /** Key search over the paged source's `seek` — replaces the rail's `search`. */
    search?: SheetSearch | undefined;
    /** A key in the rail's search box the tabs claim (⏎ · esc); returns `true` when claimed. */
    onSearchKey?: ((key: string) => boolean) | undefined;
}

/** Renders the toolbar. */
export const SheetToolbar = memo(function SheetToolbar({ styles, slice, affordances, count, partial, tabs, context, search, onSearchKey }: SheetToolbarProps) {
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

    // The toolbar's own ladder (see the header): climbs a rung per report
    // from the strip at its floor; resets on settled growth, and when the
    // count or the context switch comes or goes. Every move bumps the
    // strip's measure key; a move that changes nothing (a climb at the top,
    // a reset at the bottom) bumps nothing, so neither can loop.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [tight, setTight] = useState(0);
    const tightRef = useRef(0);
    const [measure, setMeasure] = useState(0);
    const climb = useCallback(() => {
        if (tightRef.current >= TIGHT_MAX) return;
        tightRef.current += 1;
        setTight(tightRef.current);
        setMeasure((m) => m + 1);
    }, []);
    const reset = useCallback(() => {
        if (tightRef.current === 0) return;
        tightRef.current = 0;
        setTight(0);
        setMeasure((m) => m + 1);
    }, []);
    const onTabsOverflow = useCallback((overflowing: boolean) => { if (overflowing) climb(); }, [climb]);
    const fold = useMemo<SheetTabsFold>(() => ({ onOverflow: onTabsOverflow, measureKey: measure }), [onTabsOverflow, measure]);
    const hasCount = count !== "";
    const hasContext = context !== undefined;
    useLayoutEffect(() => { reset(); }, [hasCount, hasContext, search, reset]);
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (el === null || typeof ResizeObserver === "undefined") return;
        let width = el.clientWidth;
        let settle: number | undefined;
        const ro = new ResizeObserver(() => {
            if (el.clientWidth <= width) { width = el.clientWidth; return; }
            width = el.clientWidth;
            if (settle !== undefined) window.clearTimeout(settle);
            settle = window.setTimeout(() => { settle = undefined; reset(); }, 200);
        });
        ro.observe(el);
        return () => { ro.disconnect(); if (settle !== undefined) window.clearTimeout(settle); };
    }, [reset]);

    return (
        <Box ref={rootRef} css={styles.toolbar} data-slot="toolbar" data-tight={tight > 0 ? tight : undefined}>
            <SheetTabsFoldContext.Provider value={fold}>{tabs}</SheetTabsFoldContext.Provider>
            {context !== undefined && (
                <Box css={styles.contextSwitch} data-slot="contextSwitch" role="radiogroup" aria-label="Context rows either side of a hit">
                    {tight < 2 && <Box as="span" css={styles.contextLabel}>context</Box>}
                    {CONTEXTS.map((n) => (
                        <Box
                            key={n}
                            as="button"
                            css={styles.contextOption}
                            data-slot="contextOption"
                            data-context={n}
                            data-on={context.value === n ? "" : undefined}
                            role="radio"
                            aria-checked={context.value === n}
                            onMouseDown={(e: MouseEvent) => { e.preventDefault(); context.onChange(n); }}
                        >
                            {n === 0 ? "none" : `±${n}`}
                        </Box>
                    ))}
                </Box>
            )}
            {hasCount && tight < 1 && <Box as="span" css={styles.toolbarCount} data-slot="toolbarCount">{count}</Box>}
            <Box css={styles.toolbarRailGroup} data-slot="toolbarRailGroup">
                {search !== undefined && (
                    <DatasetKeySearch keyType={search.keyType} onFind={search.find} onListRange={search.listRange} onJump={search.jump} onClear={search.clear} />
                )}
                {slice !== undefined && kinds.length > 0 && (
                    <Box css={styles.toolbarCluster} onKeyDownCapture={onKeyDownCapture} data-slot="toolbarRail">
                        <SliceRailCluster slice={slice} affordanceKinds={kinds} align="end" />
                    </Box>
                )}
                {partial && <Box as="span" css={styles.toolbarBadge} data-slot="toolbarBadge">loaded rows only</Box>}
            </Box>
        </Box>
    );
});
