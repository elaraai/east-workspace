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
}

export function StatusIndicator({ tone, label, size = 'sm', pulsing, live, hideLabel }: StatusIndicatorProps) {
    const recipe = useSlotRecipe({ key: 'status' });
    const styles = recipe({ status: tone, size, pulsing, live });
    return (
        <Box css={styles.root} title={hideLabel ? label : undefined} aria-label={hideLabel ? label : undefined}>
            <Box css={styles.indicator} />
            {!hideLabel && <Box as="span" css={styles.label}>{label}</Box>}
        </Box>
    );
}
