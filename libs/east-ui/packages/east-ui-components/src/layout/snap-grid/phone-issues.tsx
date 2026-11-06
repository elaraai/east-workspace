/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Issues tab of a phone's inspector (`Studio Mobile Spec.md` ST7, ST37, D9):
 * what the session's Issues button opens. A card for each conflict still waiting
 * — its row, its tile and field, mine against theirs, Keep theirs and Keep mine —
 * each choice one step of the history, which clears the card; then what else
 * stands in the way of a Save.
 *
 * @packageDocumentation
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { conflictCards } from "../../editing/conflicts.js";
import type { EditIssue, EditSession } from "../../editing/session.js";
import type { SnapGridWords } from "./messages.js";
import { startColumn, type SnapGridRowModel } from "./model.js";
import type { SnapGridEntryRef } from "./use-snap-grid-editing.js";

/** Props of {@link SnapGridPhoneIssues}. */
export interface SnapGridPhoneIssuesProps {
    readonly session: EditSession<SnapGridEntryRef>;
    readonly rows: readonly SnapGridRowModel[];
    readonly words: SnapGridWords;
    /** A tile's name, for an issue. */
    readonly where: (issue: EditIssue) => string;
}

/**
 * The tab's body — see the module docs.
 *
 * @param props - The session, the rows, the words, and how an issue is named
 * @returns The cards
 */
export function SnapGridPhoneIssues({ session, rows, words, where }: SnapGridPhoneIssuesProps) {
    useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    const styles = useSlotStyles("snapGridPhone");
    const m = words.m;
    const cards = conflictCards(session, words, where, undefined, undefined).filter((card) => card.choice === undefined);
    const readiness = session.readiness;
    const others = readiness.type === "ready" ? session.issues : readiness.value;
    const spanField = m.conflictField({ field: "span" });
    if (cards.length === 0 && others.length === 0) {
        return <Box css={styles.issuesNone} data-snap-grid-issues="" data-empty="">{m.phoneIssuesNone()}</Box>;
    }
    const line = (key: string, value: ReactNode) => (
        <Box css={styles.issueLine}><Box as="span" css={styles.issueKey}>{key}</Box><Box as="span" css={styles.issueValue}>{value}</Box></Box>
    );
    return (
        <Box css={styles.issues} data-snap-grid-issues="">
            {cards.length > 0 && <Box css={styles.issuesIntro}>{m.conflictsIntro()}</Box>}
            {cards.map((card) => {
                const at = rows.findIndex((row) => row.tiles.some((t) => t.id === card.issue.entry));
                const row = rows[at];
                const tile = row?.tiles.find((t) => t.id === card.issue.entry);
                const label = card.view.label.join(" · ");
                const isSpan = card.view.label.length === 1 && card.view.label[0] === spanField;
                const first = row !== undefined && tile !== undefined ? startColumn(row.tiles, tile.key) : undefined;
                const mine = !isSpan ? card.view.yours
                    : first === undefined || tile === undefined ? m.phoneSpan({ span: card.view.yours })
                        : `${m.phoneSpan({ span: card.view.yours })} · ${m.phoneIssueColumns({ first: words.number(first), last: words.number(first + tile.span - 1) })}`;
                const theirs = isSpan ? m.phoneSpan({ span: card.view.theirs }) : card.view.theirs;
                return (
                    <Box key={card.key} css={styles.issue} data-snap-grid-issue="">
                        <Box css={styles.issueHead}>
                            <Box as="span" css={styles.conflictDot} aria-hidden />
                            {at < 0 ? m.phoneConflict() : m.phoneIssueHead({ row: words.number(at + 1) })}
                        </Box>
                        <Box css={styles.issueTitle}>{label === "" ? card.item : `${card.item} · ${label.toLowerCase()}`}</Box>
                        {line(m.phoneMine(), mine)}
                        {line(m.phoneTheirs(), card.said === undefined ? theirs : `${theirs} · ${card.said}`)}
                        <Box css={styles.issueActions}>
                            <chakra.button type="button" css={styles.issueAction} data-issue-keep="source" disabled={session.carrying} onClick={() => card.settle("source")}>{m.phoneKeepTheirs()}</chakra.button>
                            <chakra.button type="button" css={styles.issueAction} data-issue-keep="draft" disabled={session.carrying} onClick={() => card.settle("draft")}>{m.phoneKeepMine()}</chakra.button>
                        </Box>
                    </Box>
                );
            })}
            {others.map((issue, i) => (
                <Box key={i} css={styles.issue} data-snap-grid-issue-other="">
                    <Box css={styles.issueTitle}>{where(issue)}</Box>
                    <Box css={styles.issuesIntro} data-flush="">{issue.message}</Box>
                </Box>
            ))}
        </Box>
    );
}
