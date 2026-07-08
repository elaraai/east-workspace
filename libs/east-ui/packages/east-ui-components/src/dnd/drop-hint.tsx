/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared `DropHint` affordance (#267) — the "this empty region accepts
 * drops" marker: a dashed outline + host-supplied hint text, consistent
 * with the `data-drop-valid` stage vocabulary (dashed = ephemeral). Blend's
 * empty-allocations box renders it; Roster/Board empty cells may adopt it
 * later. Zero baked copy — the hint text arrives from the caller.
 */

import { type ReactNode } from "react";
import { Box, useRecipe } from "@chakra-ui/react";

export interface DropHintProps {
    /** The hint content (host-supplied — the component bakes in no copy). */
    children?: ReactNode;
}

/** The dashed empty-destination drop affordance. */
export function DropHint({ children }: DropHintProps) {
    const recipe = useRecipe({ key: "dropHint" });
    return (
        <Box css={recipe({})} data-drop-hint="">
            {children}
        </Box>
    );
}
