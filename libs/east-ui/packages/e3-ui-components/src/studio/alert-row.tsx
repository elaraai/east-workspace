/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An alert's row in a popover's list (#1674): its name over where it stands.
 * It is the row every list in a flush popover of the app draws — the pick
 * panel's (`pickPanel` recipe: the Plan's Series list), its label over its
 * sub-line, rows fenced by a hairline — so a list of alerts looks and hovers
 * as those do: a visual's alerts in its bell's popover, and the alerts firing
 * in the bar's. Where it stands is in `--neg` while it fires.
 *
 * @packageDocumentation
 */

import { Box, chakra } from "@chakra-ui/react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";

/** Props of {@link AlertRow}. */
export interface AlertRowProps {
    /** The alert's name. */
    readonly name: string;
    /** Where it stands: what its line is marked by, a firing one's in `--neg`. */
    readonly status: "firing" | "cleared" | "paused" | "watching";
    /** Where it stands, in words. */
    readonly words: string;
    /** Opens it: its editor, or its page. */
    readonly onOpen: () => void;
}

/**
 * One alert of a popover's list: a button, its name over where it stands.
 *
 * @param props - Its name, where it stands, and what opens it
 * @returns The row
 */
export function AlertRow({ name, status, words, onOpen }: AlertRowProps) {
    const row = useSlotStyles("pickPanel");
    const styles = useSlotStyles("studioVisual");
    return (
        <chakra.button type="button" css={row.row} data-studio-alert={name} onClick={onOpen}>
            <Box as="span" css={row.text}>
                <Box as="span" css={row.label}>{name}</Box>
                <Box as="span" css={[row.sub!, styles.alertStatus!]} data-status={status}>{words}</Box>
            </Box>
        </chakra.button>
    );
}
