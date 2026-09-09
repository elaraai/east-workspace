/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The two-line sticky header (B§11): the gutter's blank corner, then one
 * cell per column — the label line (mono 10/600/.16em uppercase) over the
 * grey `sub` line that tells the planner what the cell accepts.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import type { SheetColumnMeta } from "./model.js";

type Styles = Record<string, Record<string, unknown>>;

export interface SheetHeaderProps {
    styles: Styles;
    columns: readonly SheetColumnMeta[];
    /** The CSS grid template — the gutter track then one per column. */
    gridTemplate: string;
}

/** Renders the header row. */
export const SheetHeader = memo(function SheetHeader({ styles, columns, gridTemplate }: SheetHeaderProps) {
    return (
        <Box css={styles.header} style={{ gridTemplateColumns: gridTemplate }} data-slot="header" role="row">
            <Box css={styles.headerGutter} />
            {columns.map((col) => (
                <Box key={col.key} css={styles.headerCell} data-slot="headerCell" data-key={col.key} role="columnheader" title={col.sub}>
                    <Box as="span" css={styles.headerLabel}>{col.header}</Box>
                    {col.sub !== undefined && <Box as="span" css={styles.headerSub}>{col.sub}</Box>}
                </Box>
            ))}
        </Box>
    );
});
