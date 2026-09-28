/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas's live region (#819) — one polite status line that says what
 * changed where a sighted reader would SEE it change: a selection, a section
 * or chart opening or closing, a row focus coming or going, a grain or
 * resolution change, a paged window landing.
 *
 * The words are the controller's (`PlanSnapshot.announce`), made by the
 * action that changed the state — so a landing announces in the same
 * notification, and the same commit, as its rows. This leaf only shows them:
 * it is subscribed to nothing else, so an announcement renders nothing else.
 *
 * @packageDocumentation
 */

import { VisuallyHidden } from "@chakra-ui/react";
import { usePlanSelector } from "../controller/react.js";
import type { PlanSnapshot } from "../controller/index.js";

const selectAnnounce = (s: PlanSnapshot) => s.announce;

/**
 * The live region — mount once, inside the canvas's controller.
 *
 * @returns The visually hidden status line
 */
export function PlanAnnouncer() {
    const announce = usePlanSelector(selectAnnounce);
    return (
        <VisuallyHidden role="status" aria-live="polite" aria-atomic="true" data-plan-announce>
            {/* Keyed by the message's number: the same words said twice are a
                new node, and a new announcement. */}
            {announce !== null && <span key={announce.seq}>{announce.text}</span>}
        </VisuallyHidden>
    );
}
