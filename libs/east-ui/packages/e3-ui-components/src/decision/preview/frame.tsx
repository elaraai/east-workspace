/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What every preview shares (`Decision Queue Spec.md` P1, P2, P18, P21, P23,
 * P25): its frame — one image, its sentence its name, at its kind's height,
 * dashed while stale — its rows not read yet, the shared placeholder shapes
 * in its final layout after its own reveal clock, and a read that failed,
 * said once; and the other cases' changes of an entry, counted for its `+N`.
 * The `decisionPreview` recipe draws them from the attributes they set.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { LoadingFailedLine, LoadingReveal, PlaceholderShape, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { ScheduleEditing } from "../../shared/schedule/editing.js";
import type { DecisionRecord, DecisionTarget } from "../editing.js";
import type { DecisionCase } from "../layout.js";
import type { DecisionQueueWords } from "../messages.js";
import type { CardView, ChangedRow, RowsState } from "../state.js";

/** A flag attribute: present while `on`. */
export const flag = (on: boolean): "" | undefined => (on ? "" : undefined);

/** How many waiting cases' chosen options change each row (P18): by the record's key, then the row's. */
export type SharedRows = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * How many other cases change a row (P18): the waiting cases whose chosen option changes it, this one aside.
 *
 * @param shared - The rows every waiting case's chosen option changes
 * @param record - The row's record's key
 * @param key - The row's key
 * @returns How many other cases change it
 */
export function sharedOf(shared: SharedRows, record: string, key: string): number {
    return Math.max(0, (shared.get(record)?.get(key) ?? 0) - 1);
}

/** What a preview draws from: the case, its target and record, the rows its change leaves, and the queue's editing. */
export interface PreviewProps {
    /** The case. */
    readonly c: DecisionCase;
    /** The card's view of it: the chosen option, and the recommended one. */
    readonly view: CardView;
    /** The target the chosen option's change names. */
    readonly target: DecisionTarget;
    /** That target's record. */
    readonly record: DecisionRecord | undefined;
    /** How the card's read of the rows the change leaves stands. */
    readonly rows: RowsState;
    /** The rows the change changes, as they stand, as it proposes them and as the viewer edited them. */
    readonly changed: readonly ChangedRow[];
    /** The queue's editing: the rows as they stand, drafts in place. */
    readonly schedule: ScheduleEditing;
    /** The rows every waiting case changes (P18). */
    readonly shared: SharedRows;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionPreview` recipe's styles. */
    readonly styles: SlotStyles;
}

/** Props of {@link PreviewFrame}. */
export interface PreviewFrameProps {
    /** The target's kind: the frame's height (P2). */
    readonly kind: DecisionTarget["kind"]["type"];
    /** How its rows are laid out: the Roster's week, lanes, a Sheet's rows, or a map's own. */
    readonly layout: "roster" | "people" | "lanes" | "sheet" | undefined;
    /** Its sentence (P25). */
    readonly label: string;
    /** Whether the change no longer applies (P21). */
    readonly stale: boolean;
    /** Whether its rows are read still. */
    readonly busy?: boolean | undefined;
    /** The recipe's styles. */
    readonly styles: SlotStyles;
    /** What it draws. */
    readonly children?: ReactNode;
}

/**
 * A preview's frame (P1, P2, P21, P25): one image named by its sentence, at its kind's height, dashed while stale.
 *
 * @param props - Its kind, layout, sentence and state, and what it draws ({@link PreviewFrameProps})
 * @returns The frame
 */
export function PreviewFrame({ kind, layout, label, stale, busy, styles, children }: PreviewFrameProps) {
    return (
        <Box css={styles.root} role="img" aria-label={label} aria-busy={busy === true || undefined} data-decision-preview="" data-kind={kind}
            data-layout={layout} data-stale={flag(stale)}>
            {children}
        </Box>
    );
}

/**
 * A preview whose rows are read still (P23): its frame and head at once, the shared placeholder shapes in its rows —
 * a name and its measure, a chip a cell — shown after its own reveal clock, so a quick read never flashes.
 *
 * @param props - Its kind and layout, how many rows and cells it draws, and the queue's words
 * @returns The placeholder
 */
export function PreviewPending({ kind, layout, rows, cells, words, styles }: Pick<PreviewFrameProps, "kind" | "layout" | "styles"> & {
    readonly rows: number; readonly cells: number; readonly words: DecisionQueueWords;
}) {
    return (
        <LoadingReveal waiting>
            <PreviewFrame kind={kind} layout={layout} label={words.m.applyOff({ why: "reading" })} stale={false} busy styles={styles}>
                <Box css={styles.header} aria-hidden="true" />
                {Array.from({ length: rows }, (_, row) => (
                    <Box key={row} css={styles.row} aria-hidden="true" data-preview-pending="">
                        <Box css={styles.rowHead}><PlaceholderShape kind="label2" index={row} /></Box>
                        {Array.from({ length: cells }, (_, cell) => (
                            <Box key={cell} css={styles.cell}><PlaceholderShape kind="chip" index={row * cells + cell} /></Box>
                        ))}
                    </Box>
                ))}
            </PreviewFrame>
        </LoadingReveal>
    );
}

/**
 * A preview whose read failed (P23): said once, in its frame. Its Retry is the open card's, in its Change part: the
 * preview stands in the card's head, a button of its own.
 *
 * @param props - Its kind and layout, and the queue's words
 * @returns The failure
 */
export function PreviewFailed({ kind, layout, words, styles }: Pick<PreviewFrameProps, "kind" | "layout" | "styles"> & { readonly words: DecisionQueueWords }) {
    const message = words.m.applyOff({ why: "failed" });
    return (
        <PreviewFrame kind={kind} layout={layout} label={message} stale={false} styles={styles}>
            <Box css={styles.failed}><LoadingFailedLine message={message} /></Box>
        </PreviewFrame>
    );
}
