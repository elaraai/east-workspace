/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar row (§7): the view tabs (P5) at left, the lens's context
 * switch and `n matches · m context` line (P5), the slice rail cluster —
 * search / filter / cohort on the bound slice — at right, and the paged
 * scope badge *loaded rows only*. Mounts only when the sheet has a reason:
 * a bound slice.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../slice/rail/index.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

export interface SheetToolbarProps {
    styles: Styles;
    slice: SliceBindValue | undefined;
    affordances: readonly string[];
    /** The lens count line (P5). */
    count: string;
    /** The paged scope badge. */
    partial: boolean;
}

/** Renders the toolbar. */
export const SheetToolbar = memo(function SheetToolbar({ styles, slice, affordances, count, partial }: SheetToolbarProps) {
    return (
        <Box css={styles.toolbar} data-slot="toolbar">
            {count !== "" && <Box as="span" css={styles.toolbarCount} data-slot="toolbarCount">{count}</Box>}
            <Box marginLeft="auto" display="flex" alignItems="center" gap="{spacing.3}" minWidth="0" flex="0 1 auto" maxWidth="70%">
                {slice !== undefined && affordances.length > 0 && (
                    <Box display="flex" minWidth="0" width="min(640px, 100%)">
                        <SliceRailCluster slice={slice} affordanceKinds={affordances} />
                    </Box>
                )}
                {partial && <Box as="span" css={styles.toolbarBadge} data-slot="toolbarBadge">loaded rows only</Box>}
            </Box>
        </Box>
    );
});
