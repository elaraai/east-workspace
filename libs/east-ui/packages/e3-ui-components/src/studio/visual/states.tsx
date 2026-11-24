/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's states, as its tile draws them (#1671, TIL-3). Its messages,
 * each one look and centred in its body at whatever height the tile stands
 * ({@link TileMessage}): the wells it needs — its view's icon, "Add fields to
 * draw it", and a checklist, a check for what is chosen and a dot for what is
 * missing; a follower that asks for a pick — what to pick, in which visual,
 * and what it then shows (#1673, LNK-5); a field its source does not have —
 * its name, as code, and the link that opens its fields; a source or a date
 * range it cannot read. And what stands where its drawing would: no rows —
 * `no data` where its value would be, and on the annotation line what emptied
 * it, or that its source has none; and, while its answer is awaited, Skeleton
 * blocks in its own shape.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { Box, Skeleton } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircle, faCircleCheck, faCircleExclamation, type IconDefinition, type IconName } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { filterWords } from "../../query/visual/filters.js";
import type { PrintSource, PrintState } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { midSentence, type Visual, type VisualView } from "./values.js";

/** Props of {@link TileMessage}. */
export interface TileMessageProps {
    /** Which state it says: what a tile's tests and the showcase's specs find it by (`data-studio-visual`). */
    readonly state: string;
    /** Its icon: Font Awesome's, solid — or its name. */
    readonly icon: IconDefinition | string;
    /** What it says. */
    readonly title: string;
    /** What it adds under its title, in the quiet ink; nothing unless given. */
    readonly hint?: string | undefined;
    /** What it holds under its title in place of a hint — the wells' checklist — drawn in the larger of its two forms. */
    readonly children?: ReactNode;
}

/**
 * A visual's message in place of its drawing (TIL-3): its icon, what it says,
 * and a hint — or a checklist — under it, centred in its tile's body at
 * whatever height the tile stands (the `studioVisual` recipe's `message`).
 * Every message a visual's tile says is drawn by it, in one look: the spec's
 * smaller form, a follower's prompt's, for words alone; its larger, the
 * wells', with a checklist.
 *
 * @param props - Which state, its icon, its words, and what it holds
 * @returns The message
 */
export function TileMessage({ state, icon, title, hint, children }: TileMessageProps) {
    const styles = useSlotStyles("studioVisual");
    return (
        <Box css={styles.message} data-studio-visual={state}>
            <Box css={styles.empty} data-prompt={children === undefined ? "" : undefined}>
                <Box as="span" css={styles.emptyIcon} aria-hidden><FontAwesomeIcon icon={typeof icon === "string" ? ["fas", icon as IconName] : icon} /></Box>
                <Box as="h4" css={styles.emptyTitle}>{title}</Box>
                {hint !== undefined && <Box as="span" css={styles.emptyHint} data-studio-visual-hint="">{hint}</Box>}
                {children}
            </Box>
        </Box>
    );
}

/** Props of {@link WellsEmpty}. */
export interface WellsEmptyProps {
    /** The view's icon, by its Font Awesome name. */
    readonly icon: string;
    /** The wells it needs filled, each in its words — `A number in Values`. */
    readonly needed: readonly string[];
}

/**
 * A visual with wells it needs: what is chosen — its source — and what is
 * missing.
 *
 * @param props - The view's icon and the wells it needs
 * @returns The state
 */
export function WellsEmpty({ icon, needed }: WellsEmptyProps) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioVisual");
    return (
        <TileMessage state="empty" icon={icon} title={m.wellsEmpty()}>
            <Box as="ul" css={styles.checks}>
                <Box as="li" css={styles.check} data-done="">
                    <Box as="span" css={styles.checkMark} aria-hidden><FontAwesomeIcon icon={faCircleCheck} /></Box>
                    {m.sourcePicked()}
                </Box>
                {needed.map((well) => (
                    <Box as="li" key={well} css={styles.check}>
                        <Box as="span" css={styles.checkMark} aria-hidden><FontAwesomeIcon icon={faCircle} /></Box>
                        {well}
                    </Box>
                ))}
            </Box>
        </TileMessage>
    );
}

/** Props of {@link NoRows}. */
export interface NoRowsProps {
    /** The visual. */
    readonly visual: Visual;
    /** The page's state, as its programs read it: the page's filters on its source, and what it follows. */
    readonly state: PrintState;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** Its source's name. */
    readonly source: string;
}

/**
 * A visual that read no rows: `no data` where its value would be, never a
 * zero, and under it what emptied it (#1673) — its own filter, the page's
 * filters on its source and what it follows, each once, in the words its chip
 * says — or, with none of them, that its source has no rows; the whole on
 * hover where the line is cut.
 *
 * @param props - The visual, the page's state, and its source
 * @returns The state
 */
export function NoRows({ visual, state, read, source }: NoRowsProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const conditions = [...(visual.where.type === "some" ? [visual.where.value] : []), ...state.filters];
    const causes = [...new Set(conditions.map((condition) => filterWords(condition, read, words)))];
    const reason = m.noDataReason({ rows: midSentence(source), source, causes });
    return (
        <Box css={styles.state} data-studio-visual="no-rows">
            <Box css={styles.kpi}>
                <Box as="span" css={styles.absent}>{m.noData()}</Box>
                <Box css={styles.anno} title={reason}>{reason}</Box>
            </Box>
        </Box>
    );
}

/** Props of {@link FieldMissing}. */
export interface FieldMissingProps {
    /** The source's name. */
    readonly source: string;
    /** The fields it reads that the source does not have. */
    readonly fields: readonly string[];
    /** Opens the visual's fields, to pick another; with none — a published page — no link is drawn. */
    readonly onPick?: (() => void) | undefined;
}

/**
 * A visual reading a field its source does not have.
 *
 * @param props - The source, the fields, and what the link opens
 * @returns The state
 */
export function FieldMissing({ source, fields, onPick }: FieldMissingProps) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioVisual");
    return (
        <Box css={styles.message} data-studio-visual="missing">
            <Box css={styles.missing}>
                <Box css={styles.missingLine}>
                    <Box as="span" css={styles.missingIcon} aria-hidden><FontAwesomeIcon icon={faCircleExclamation} /></Box>
                    <span>
                        {m.noField({ source })}
                        {fields.map((field) => <span key={field}>{" "}<Box as="code" css={styles.code}>{field}</Box></span>)}
                    </span>
                </Box>
                {onPick !== undefined && <Box as="button" css={styles.link} onClick={onPick}>{m.pickAnotherField()}</Box>}
            </Box>
        </Box>
    );
}

/** How many rows stand for a table or a list while its answer is awaited. */
const LOADING_ROWS = [0, 1, 2, 3] as const;

/**
 * A visual whose answer is awaited: Skeleton blocks in its own shape.
 *
 * @param props - The view
 * @returns The state
 */
export function VisualLoading({ view }: { readonly view: VisualView }) {
    const styles = useSlotStyles("studioVisual");
    const shape = view.type === "kpi" ? "kpi" : view.type === "chart" ? "chart" : "rows";
    return (
        <Box css={styles.state} data-studio-visual="waiting">
            <Box css={styles.load} data-shape={shape}>
                {shape === "kpi" && <><Skeleton css={styles.loadBlock} data-block="number" /><Skeleton css={styles.loadBlock} data-block="line" /></>}
                {shape === "chart" && <><Skeleton css={styles.loadBlock} data-block="line" /><Skeleton css={styles.loadBlock} data-block="plot" /></>}
                {shape === "rows" && LOADING_ROWS.map((row) => <Skeleton key={row} css={styles.loadBlock} data-block="row" data-row={row} />)}
            </Box>
        </Box>
    );
}
