/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a visual's tile says about itself (#1671): what it shows of how many,
 * under it — a records table's rows, or the groups a visual holds when it
 * holds fewer than its source has (CHT-9); and that its source could not be
 * read, with a Retry where asking again may mend it.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import { Box, Button } from "@chakra-ui/react";
import { BannerView, useFormatters } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useStudioMessages } from "../messages.js";
import type { VisualShown } from "./values.js";

/**
 * The line under a visual that says what it shows of how many, in its words.
 *
 * @param props - Its words
 * @returns The line
 */
export function VisualNote({ children }: { readonly children: ReactNode }) {
    const styles = useSlotStyles("studioVisual");
    return <Box as="span" css={styles.note} data-studio-visual-note="">{children}</Box>;
}

/**
 * What a visual holds of how many groups — `Showing 500 of 1,240 groups`.
 *
 * @param props - What it holds of how many
 * @returns The line
 */
export function ShownNote({ shown }: { readonly shown: VisualShown }) {
    const m = useStudioMessages();
    const f = useFormatters();
    return <VisualNote>{m.groupsShown({ shown: f.number(shown.shown), of: f.number(shown.of), n: shown.of })}</VisualNote>;
}

/** Props of {@link SourceFailed}. */
export interface SourceFailedProps {
    /** The source's name. */
    readonly source: string;
    /** What was said of why. */
    readonly message: string;
    /** Asks again; `undefined` where asking again cannot mend it. */
    readonly retry?: (() => void) | undefined;
}

/**
 * A visual's source that could not be read: its banner, with a Retry where
 * asking again may mend it.
 *
 * @param props - The source's name, why, and how to ask again
 * @returns The banner
 */
export function SourceFailed({ source, message, retry }: SourceFailedProps) {
    const m = useStudioMessages();
    return (
        <BannerView status="error" title={m.sourceError({ source })} description={message}
            actions={retry === undefined ? undefined : <Button size="xs" variant="outline" onClick={retry}>{m.retry()}</Button>} />
    );
}
