/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The source's card (#936) — what a query starts with, as the Query tab draws
 * it at the top of the steps (`Query Editor Spec.md` §4.3): "Start with
 * orders" over "{workspace}.orders · list of orders".
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDatabase } from "@fortawesome/free-solid-svg-icons";
import type { SourceCard } from "./model/cards.js";
import type { PartStyles } from "./parts.js";

/** Props of {@link SourceCardView}. */
export interface SourceCardViewProps {
    /** The card. */
    readonly card: SourceCard;
    /** The data source's name. */
    readonly source: string;
    /** The workspace it is read in, when the builder knows it. */
    readonly workspace: string | undefined;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
}

/**
 * Renders the source's card — see the module docs.
 *
 * @param props - The card, the source, the workspace and the styles ({@link SourceCardViewProps})
 * @returns The card
 */
export const SourceCardView = memo(function SourceCardView({ card, source, workspace, ps }: SourceCardViewProps) {
    const { styles, words } = ps;
    const path = workspace === undefined ? source : `${workspace}.${source}`;
    return (
        <Box css={styles.source} data-query-source={source}>
            <Box as="span" css={styles.sourceIcon} aria-hidden><FontAwesomeIcon icon={faDatabase} /></Box>
            <Box css={styles.sourceText}>
                <Box as="span" css={styles.sourceTitle}>{card.title}</Box>
                <Box as="span" css={styles.sourceKind}>{words.messages.sourceLine({ path, kind: card.kind })}</Box>
            </Box>
        </Box>
    );
});
