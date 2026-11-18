/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's states, as its tile draws them (#1671, TIL-3): the wells it
 * needs — its view's icon, "Add fields to draw it", and a checklist, a check
 * for what is chosen and a dot for what is missing; no rows — `no data` where
 * its value would be, and why on the annotation line; a field its source
 * does not have — its name, as code, and the link that opens its fields; and,
 * while its answer is awaited, Skeleton blocks in its own shape.
 *
 * @packageDocumentation
 */

import { Box, Skeleton } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircle, faCircleCheck, faCircleExclamation, type IconName } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useStudioMessages } from "../messages.js";
import type { VisualView } from "./values.js";

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
        <Box css={styles.state} data-studio-visual="empty">
            <Box css={styles.empty}>
                <Box as="span" css={styles.emptyIcon} aria-hidden><FontAwesomeIcon icon={["fas", icon as IconName]} /></Box>
                <Box as="h4" css={styles.emptyTitle}>{m.wellsEmpty()}</Box>
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
            </Box>
        </Box>
    );
}

/**
 * A visual that read no rows: `no data` where its value would be, never a
 * zero, and why under it.
 *
 * @param props - Why
 * @returns The state
 */
export function NoRows({ reason }: { readonly reason: string }) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioVisual");
    return (
        <Box css={styles.state} data-studio-visual="no-rows">
            <Box css={styles.kpi}>
                <Box as="span" css={styles.absent}>{m.noData()}</Box>
                <Box css={styles.anno}>{reason}</Box>
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
        <Box css={styles.state} data-studio-visual="missing">
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
