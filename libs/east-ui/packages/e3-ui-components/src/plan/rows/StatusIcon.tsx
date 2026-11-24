/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row's status in its gutter line's value slot (#1749): its tone's icon,
 * told by its shape as by its ink — a row's and a group band's alike.
 */

import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCheck, faCircleExclamation, faCircleInfo, faTriangleExclamation, type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { statusText } from "../a11y.js";
import { usePlanWords } from "../words.js";
import type { PlanRowValue } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;

/** A status's tone, by its case's name — the row's own, where the theme's recipe names its tones for itself. */
type Tone = Extract<PlanRowValue["status"], { type: "some" }>["value"]["type"];

/** Each tone's icon; a neutral status says nothing to mark, and draws none. */
const STATUS_ICONS: Readonly<Record<Tone, IconDefinition | undefined>> = {
    warning: faTriangleExclamation,
    danger: faCircleExclamation,
    success: faCheck,
    info: faCircleInfo,
    neutral: undefined,
};

/**
 * A status as its tone's icon, named for a reader by its status.
 *
 * @param props.tone - The status's tone; none for a row with no status
 * @param props.styles - The Plan's slot styles
 * @param props.ctx - `""` in a context strip, which draws it at its marks' height
 * @param props.keep - `""` in a strip that keeps its value and its status as they are
 */
export function PlanStatusIcon({ tone, styles, ctx, keep }: {
    tone: Tone | undefined;
    styles: Styles;
    ctx?: "" | undefined;
    keep?: "" | undefined;
}) {
    const words = usePlanWords();
    const icon = tone === undefined ? undefined : STATUS_ICONS[tone];
    if (tone === undefined || icon === undefined) return null;
    return (
        <Box as="span" css={styles.statusIcon} data-tone={tone} data-ctx={ctx} data-keep={keep} role="img" aria-label={statusText(tone, words)}>
            <FontAwesomeIcon icon={icon} />
        </Box>
    );
}
