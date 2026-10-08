/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's footer (#1245, #1247, `Flowchart Builder Spec.md` §7, FB10)
 * — today's counts, in its frame's footer: over many flows the open flow's
 * name first; then its transitions — narrowed from how many, and by what
 * share, while the host's slice narrows them — and on the right their split,
 * planned · observed · unresolved; where the flowchart edits, the changes
 * waiting on Save in the open flow (`3 pending`); over a record, when it was
 * last saved; and, after a card's ⏎ that is refused (#1249, FB34), why — a
 * polite live line, so a screen reader hears it too.
 *
 * The counts are of the transitions the flow holds, not the arrows drawn: an
 * in-place transition folds into its state's `↻ n` badge and still counts,
 * and an unresolved one counts once, under unresolved.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, equalFor, none } from "@elaraai/east";
import { useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartModel, FlowchartValue } from "./model.js";

type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);

/** Props of {@link FlowchartFooter}. */
export interface FlowchartFooterProps {
    /** The `flowchart` recipe's styles. */
    readonly styles: Styles;
    /** The open flow's name, over many flows; `undefined` over one. */
    readonly name: string | undefined;
    /** How many transitions the flow holds — the slice's rows, when it narrows them. */
    readonly links: number;
    /** How many there were before the slice narrowed them; `undefined` when it narrowed none. */
    readonly narrowedFrom: number | undefined;
    /** The transitions' split. */
    readonly counts: FlowchartModel["counts"];
    /** The changes waiting on Save in the open flow; `undefined` where the flowchart does not edit. */
    readonly pending: number | undefined;
    /** When the record was last saved, as the footer says it; `undefined` over `data`, or a record with no commit. */
    readonly saved: string | undefined;
    /** Why a card's ⏎ was refused (#1249) — `Drop onto a transition`; `undefined`, nothing to say. */
    readonly message?: string | undefined;
    /** The flowchart's words: its numbers print in the app's locale. */
    readonly words: FlowchartWords;
}

/**
 * Renders the footer — see the module docs.
 *
 * @param props - The open flow's name, its counts, the record's last save and a refused ⏎'s reason
 * @returns The footer
 */
export function FlowchartFooter({ styles, name, links, narrowedFrom, counts, pending, saved, message, words }: FlowchartFooterProps) {
    const share = narrowedFrom !== undefined && narrowedFrom > 0 ? 1 - links / narrowedFrom : undefined;
    return (
        <Box css={styles.footer} data-flowchart-footer="">
            {name !== undefined && (
                <>
                    <Box as="span" css={styles.footerFlow} data-flowchart-flow="">{name}</Box>
                    <Box as="span">·</Box>
                </>
            )}
            <Box as="span" css={styles.footerStrong}>{words.number(links)}</Box>
            <Box as="span">{links === 1 ? "link" : "links"}</Box>
            {narrowedFrom !== undefined && share !== undefined && (
                <>
                    <Box as="span">· narrowed from {words.number(narrowedFrom)} ·</Box>
                    <Box as="span" css={styles.footerNeg}>−{words.percent(share)}</Box>
                </>
            )}
            {message !== undefined && <Box as="span">·</Box>}
            {/* Always there, so a screen reader hears each line it takes. */}
            <Box as="span" css={styles.footerMessage} data-flowchart-message="" aria-live="polite">{message ?? ""}</Box>
            <Box css={styles.footerSplit}>
                {words.number(counts.planned)} planned · {words.number(counts.observed)} observed
                {counts.unresolved > 0 ? ` · ${words.number(counts.unresolved)} unresolved` : ""}
                {pending !== undefined && <Box as="span" data-flowchart-pending="">{` · ${words.m.footerPending({ n: pending, count: words.number(pending) })}`}</Box>}
                {saved !== undefined && <Box as="span" data-flowchart-saved="">{` · saved ${saved}`}</Box>}
            </Box>
        </Box>
    );
}

/**
 * When a record of flows was last saved (FB10): its newest commit's time
 * when it was today, its date and time otherwise — read where the flowchart
 * renders, and again when the record commits.
 *
 * @param source - Where the flows come from
 * @param words - The formatters the time prints with, in the app's locale
 * @returns The last save, or `undefined` over `data`, while the commits are unread, or when there are none
 */
export function useLastSave(source: FlowchartValue["source"], words: Formatters): string | undefined {
    const history = source.type === "record" ? source.value.history : undefined;
    const read = useCallback(() => (history === undefined ? none : history()), [history]);
    const { result } = useTrackedEvaluation(read);
    const at = result.ok && result.value.type === "some" ? result.value.value[0]?.at : undefined;
    if (at === undefined) return undefined;
    return stringEqual(words.date(at), words.date(new Date())) ? words.time(at) : words.dateTime(at);
}
