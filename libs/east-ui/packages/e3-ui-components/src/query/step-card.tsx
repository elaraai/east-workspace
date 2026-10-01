/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A step's card (#936) — #934's `Card` as the Query tab draws it
 * (`Query Editor Spec.md` §4.3): its number, icon and title, its head slot
 * when it has one ("all of these are true"), and Move up, Move down and
 * Remove, quiet until hovered — Move up off on the first step, Move down on
 * the last; then its lines, and, while it is not finished, dashed, with "Not
 * in the query until it's finished."
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faArrowDown, faArrowUp, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { Card } from "./model/cards.js";
import { IconPart, Lines, Parts, type PartActions, type PartStyles } from "./parts.js";

/** What a card asks of the Query tab, besides its parts'. */
export interface CardActions extends PartActions {
    /** Moves a step up (`-1`) or down (`1`). */
    readonly onMove: (stepId: string, by: -1 | 1) => void;
    /** Takes a step out. */
    readonly onRemoveStep: (stepId: string) => void;
}

/** Props of {@link StepCard}. */
export interface StepCardProps {
    /** The card. */
    readonly card: Card;
    /** How many steps the query has. */
    readonly count: number;
    /** Whether an issue the history item went to is on it. */
    readonly focused: boolean;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** What its parts and its buttons ask. */
    readonly actions: CardActions;
}

/**
 * Renders a step's card — see the module docs.
 *
 * @param props - The card, the step count, and what it asks ({@link StepCardProps})
 * @returns The card
 */
export const StepCard = memo(function StepCard({ card, count, focused, ps, actions }: StepCardProps) {
    const { styles, words } = ps;
    const m = words.messages;
    return (
        <Box css={styles.card} role="group" aria-label={card.title} data-step-id={card.stepId} data-step-kind={card.kind}
            data-unfinished={card.complete ? undefined : ""} data-error={card.errors > 0 ? "" : undefined}
            data-focus={focused ? "" : undefined}>
            <Box css={styles.cardHead}>
                <Box as="span" css={styles.cardNumber}>{m.stepNumber({ n: words.formatters.bare(card.index + 1) })}</Box>
                <Box as="span" css={styles.cardIcon} aria-hidden><FontAwesomeIcon icon={["fas", card.icon as IconName]} /></Box>
                <Box as="span" css={styles.cardTitle}>{card.title}</Box>
                <Parts parts={card.head} ps={ps} actions={actions} />
                <Box css={styles.cardSpacer} />
                <Box css={styles.cardActions}>
                    <IconPart label={m.moveUp()} icon={faArrowUp} disabled={card.index === 0} css={ps.icon}
                        onClick={() => actions.onMove(card.stepId, -1)} />
                    <IconPart label={m.moveDown()} icon={faArrowDown} disabled={card.index === count - 1} css={ps.icon}
                        onClick={() => actions.onMove(card.stepId, 1)} />
                    <IconPart label={m.removeStep()} icon={faXmark} css={ps.icon} onClick={() => actions.onRemoveStep(card.stepId)} />
                </Box>
            </Box>
            <Box css={styles.cardBody}>
                <Lines lines={card.lines} ps={ps} actions={actions} />
                {!card.complete && <Box as="span" css={styles.unfinished}>{m.notFinished()}</Box>}
            </Box>
        </Box>
    );
});
