/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keyboard carry's live region (#825) — what a carried element does, said
 * as it happens: picked up, where it would land, refused there, dropped or
 * cancelled. Its own region, as a pointer drag speaks through the drag
 * layer's: a carry's steps are its own, not the canvas's state changes.
 *
 * @packageDocumentation
 */

import { useSyncExternalStore } from "react";
import { VisuallyHidden } from "@chakra-ui/react";
import type { PlanEditStore } from "./store.js";

/**
 * The carry's live region — mount once per canvas.
 *
 * @param props - The canvas's moves
 * @returns The visually hidden status line
 */
export function PlanCarryAnnouncer({ store }: { store: PlanEditStore }) {
    const said = useSyncExternalStore(store.subscribe, () => store.said);
    return (
        <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-plan-carry-announce>
            {/* Keyed by the message's number: the same words said twice are a
                new node, and a new announcement. */}
            {said !== null && <span key={said.seq}>{said.text}</span>}
        </VisuallyHidden>
    );
}
