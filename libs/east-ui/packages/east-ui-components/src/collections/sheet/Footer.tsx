/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The footer (B§9): the host's counts · a state-sensitive key hint · the
 * paged transport line · a right-aligned `aria-live` message for every action.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined } from "../../utils.js";
import { useSheetWords } from "./words.js";
import type { ValueTypeOf } from "@elaraai/east";
import type { Sheet } from "@elaraai/east-ui/internal";
import { SheetRetry } from "./Rows.js";

type Styles = Record<string, Record<string, unknown>>;

/** One decoded footer item. */
export type SheetFooterItemValue = ValueTypeOf<typeof Sheet.Types.FooterItem>;

/** The paged transport facts the footer states. */
export interface SheetTransport {
    loaded: number;
    total: number | undefined;
    loading: boolean;
    /** Why the source could not be read — its `total()` or `revision()` threw — while its rows show (#853). */
    error?: string | undefined;
}

export interface SheetFooterProps {
    styles: Styles;
    items: readonly SheetFooterItemValue[];
    /** The sheet's own count line before the host's items — a grouped sheet's `3 plans · 14 lines` (#740, G12). */
    summary?: string | undefined;
    hint: string;
    message: string;
    transport: SheetTransport | undefined;
    /** Ask the source again, when the transport line says it could not be read (#853). */
    onRetry?: (() => void) | undefined;
}

/** Renders the footer. */
export const SheetFooter = memo(function SheetFooter({ styles, items, summary, hint, message, transport, onRetry }: SheetFooterProps) {
    // The transport line, in the sheet's words and the app's locale (#850, #861).
    const words = useSheetWords();
    const line = transport === undefined ? ""
        : words.m.transport({ loaded: words.number(transport.loaded), total: transport.total !== undefined ? words.number(transport.total) : undefined });
    return (
        <Box css={styles.footer} data-slot="footer">
            {(items.length > 0 || summary !== undefined) && (
                <Box as="span" css={styles.footerCounts} data-slot="footerCounts">
                    {summary !== undefined && <Box as="span" data-slot="footerSummary">{summary}</Box>}
                    {items.map((it, i) => (
                        <Box key={i} as="span" data-tone={getSomeorUndefined(it.tone)?.type}>
                            {i > 0 || summary !== undefined ? `· ${it.text}` : it.text}
                        </Box>
                    ))}
                </Box>
            )}
            {transport !== undefined && (
                <Box as="span" css={styles.footerTransport} data-slot="footerTransport">
                    {transport.loading ? words.m.transportLoading({ line }) : line}
                    {transport.error !== undefined && (
                        <Box as="span" data-slot="transportError" role="alert">
                            {words.m.transportFailed({ reason: transport.error })}
                            {onRetry !== undefined && <SheetRetry styles={styles} onRetry={() => onRetry()} />}
                        </Box>
                    )}
                </Box>
            )}
            <Box as="span" css={styles.footerHint} data-slot="footerHint">{hint}</Box>
            <Box as="span" css={styles.footerMessage} data-slot="footerMessage" aria-live="polite">{message}</Box>
        </Box>
    );
});
