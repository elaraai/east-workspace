/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a gesture a builder refuses looks like (east-workspace#1709), so a change that did not happen is never read as
 * one that did:
 *
 * - **The row refused** — one whose fields would have moved it under a key another row holds, or under none — marks
 *   itself `data-refused`, and flashes: the danger ring inside its edge, drawn as an outline over its cells as a row
 *   that is a conflict draws the warn ring, and the danger wash, held a moment and then gone (`keyframes.ts`,
 *   `refused-a` and `refused-b`). The mark's value is the refusal's turn, `0` or `1`, each the other of the one
 *   before: a CSS animation starts only as its name changes, so a row refused twice running flashes twice. The row
 *   holds what it held, so nothing of the mark stays — but where the viewer asks for less motion, which shows no
 *   flash: there the ring stands for as long as the line beside it says why.
 * - **The line that says why** — a status line, a footer's message — marks itself `data-tone="refused"` and says its
 *   words in the danger ink.
 *
 * @packageDocumentation
 */

/** A row a gesture was refused on: its flash, by the refusal's turn. */
export const refusedRow = {
    "&[data-refused]": {
        animationDuration: "1400ms", animationTimingFunction: "{easings.out}", animationIterationCount: "1",
        _motionReduce: { outline: "2px solid {colors.status.neg}", outlineOffset: "-2px" },
    },
    "&[data-refused='0']": { animationName: "refused-a" },
    "&[data-refused='1']": { animationName: "refused-b" },
} as const;

/** A line saying a gesture was refused: the danger ink. */
export const refusedTone = {
    "&[data-tone=refused]": { color: "fg.danger" },
} as const;
