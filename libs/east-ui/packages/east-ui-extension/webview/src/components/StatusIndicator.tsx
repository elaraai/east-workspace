/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<StatusIndicator>` — bsys status pattern (dot + mono-uppercase word, never
 * a tinted background). Consumes the shared `status` slot-recipe so colours
 * and type come straight from the design system, the same way the showcase
 * sidebar consumes `navList`.
 *
 * @packageDocumentation
 */

import { Box, useSlotRecipe } from '@chakra-ui/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

export interface StatusIndicatorProps {
    tone: StatusTone;
    label: string;
    size?: 'sm' | 'md' | 'lg';
    pulsing?: boolean;
    live?: boolean;
    /** Render the dot only; `label` becomes the title/aria-label so the
     *  status word stays available to assistive tech and on hover. */
    hideLabel?: boolean;
    /**
     * Glyph to show instead of the dot. Reserve it for states worth
     * interrupting a scan for — a dot varies only in hue, which is the first
     * channel lost to a glance, so spending a shape on every state spends it
     * on none.
     */
    icon?: IconDefinition;
    /** Rotate the glyph — work is in flight. Ignored without `icon`. */
    spinning?: boolean;
}

export function StatusIndicator({ tone, label, size = 'sm', pulsing, live, hideLabel, icon, spinning }: StatusIndicatorProps) {
    const recipe = useSlotRecipe({ key: 'status' });
    const styles = recipe({ status: tone, size, pulsing, live, spinning });
    return (
        <Box css={styles.root} title={hideLabel ? label : undefined} aria-label={hideLabel ? label : undefined}>
            {icon
                ? <Box css={styles.icon} aria-hidden="true"><FontAwesomeIcon icon={icon} /></Box>
                : <Box css={styles.indicator} />}
            {!hideLabel && <Box as="span" css={styles.label}>{label}</Box>}
        </Box>
    );
}
