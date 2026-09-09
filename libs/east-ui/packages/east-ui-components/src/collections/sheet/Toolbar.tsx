/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar row (§7): the view tabs at left, the lens's context switch
 * and its `n matches · m context` line, then — right-aligned — the key
 * search over a paged source's `seek` (in place of the rail's search, which
 * would only filter the loaded prefix), the slice rail cluster (search /
 * filter / cohort on the bound slice) and the paged scope badge *loaded
 * rows only*. Mounts only when the sheet has a reason: a bound slice or a
 * paged source.
 */

import { memo, useCallback, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail/index.js";
import { DatasetKeySearch } from "../key-search/index.js";
import type { LensContext } from "./sheet-types.js";
import type { SheetSearch } from "./use-seek.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The context switch's stops (B§8). */
const CONTEXTS: readonly LensContext[] = [0, 1, 3];

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
    return (
        <Box css={styles.toolbar} data-slot="toolbar">
            {tabs}
            {context !== undefined && (
                <Box css={styles.contextSwitch} data-slot="contextSwitch" role="radiogroup" aria-label="Context rows either side of a hit">
                    <Box as="span" css={styles.contextLabel}>context</Box>
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
            {count !== "" && <Box as="span" css={styles.toolbarCount} data-slot="toolbarCount">{count}</Box>}
            <Box marginLeft="auto" display="flex" alignItems="center" gap="{spacing.3}" minWidth="0" flex="0 1 auto" maxWidth="70%">
                {search !== undefined && (
                    <DatasetKeySearch keyType={search.keyType} onFind={search.find} onListRange={search.listRange} onJump={search.jump} onClear={search.clear} />
                )}
                {slice !== undefined && kinds.length > 0 && (
                    <Box display="flex" minWidth="0" width="min(640px, 100%)" onKeyDownCapture={onKeyDownCapture} data-slot="toolbarRail">
                        <SliceRailCluster slice={slice} affordanceKinds={kinds} />
                    </Box>
                )}
                {partial && <Box as="span" css={styles.toolbarBadge} data-slot="toolbarBadge">loaded rows only</Box>}
            </Box>
        </Box>
    );
});
