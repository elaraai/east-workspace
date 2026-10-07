/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's footer (#1245, `Flowchart Builder Spec.md` §7, FB10) —
 * today's counts, in its frame's footer: over many flows the open flow's
 * name first; then its transitions — narrowed from how many, and by what
 * share, while the host's slice narrows them — and on the right their split,
 * planned · observed · unresolved; over a record, when it was last saved. The
 * changes waiting on Apply join them with the editing session (#1247).
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
    /** When the record was last saved, as the footer says it; `undefined` over `data`, or a record with no commit. */
    readonly saved: string | undefined;
    /** The formatters its numbers print with, in the app's locale. */
    readonly words: Formatters;
}

/**
 * Renders the footer — see the module docs.
 *
 * @param props - The open flow's name, its counts and the record's last save
 * @returns The footer
 */
export function FlowchartFooter({ styles, name, links, narrowedFrom, counts, saved, words }: FlowchartFooterProps) {
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
            <Box css={styles.footerSplit}>
                {words.number(counts.planned)} planned · {words.number(counts.observed)} observed
                {counts.unresolved > 0 ? ` · ${words.number(counts.unresolved)} unresolved` : ""}
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
