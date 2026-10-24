/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Library tab whose cards are not read yet (#1398, CL13): a run of the
 * Library's own pending rows — the paged Library's card-sized skeletons, in
 * its recipe — where the cards go, so a tab never says it is empty before its
 * read lands. The Calendar's Backlog while its period is read, as the Plan's
 * is.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box, Skeleton, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";

/** How many rows a pending tab draws: as many as the paged Library draws before its count is known. */
const PENDING_ROWS = 8;

/**
 * The pending rows (see the module docs). `aria-hidden`: the tab's pane says it is busy.
 *
 * @returns The rows
 */
export function PendingCards() {
    const recipe = useSlotRecipe({ key: "library" });
    const styles = useMemo(() => recipe() as Record<string, SystemStyleObject>, [recipe]);
    return <Box aria-hidden="true" data-library-pending="">
        {Array.from({ length: PENDING_ROWS }, (_, i) => <Box key={i} css={styles.pagedRow}><Skeleton css={styles.pagedSkeleton} /></Box>)}
    </Box>;
}
