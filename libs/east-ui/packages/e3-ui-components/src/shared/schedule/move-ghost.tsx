/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The same pointer preview for Plan and Calendar; the label never inherits bar width. */
import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** A compact label and optional span, styled by the shared move-ghost recipe part. */
export function MoveGhost({ label, detail, styles, planKind }: {
    label: string; detail?: ReactNode; styles: Record<string, Record<string, unknown>>; planKind?: string;
}) {
    return <Box css={styles.moveGhost} data-move-ghost="" data-plan-ghost={planKind}>
        <Box as="span" css={styles.moveGhostLabel} data-move-ghost-label="">{label}</Box>
        {detail !== undefined && <Box as="span" css={styles.moveGhostSpan} data-plan-ghost-span={planKind === undefined ? undefined : ""}>{detail}</Box>}
    </Box>;
}
