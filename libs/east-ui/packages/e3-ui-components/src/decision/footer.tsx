/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { LoadingLine, useFooterFit, useRevealed, type LoadingLineValue, type SlotStyles } from "@elaraai/east-ui-components/internal";

/**
 * The DecisionQueue's footer (`Decision Queue Spec.md` §7): the shared footer
 * rail holding the shared loading line alone (#1398, CL3) — `Loading
 * decisions…`, a new narrowing's `Filtering decisions…`, or `Couldn't read
 * decisions` with Retry — and nothing while nothing is in flight. The line
 * shows on the frame's one reveal clock (CL4, its `LoadingReveal`), a failure
 * at once.
 *
 * @param props - The `decisionQueue` recipe's styles, and what the cases' read says: `undefined` while it has landed
 * @returns The footer
 */
export function DecisionFooter({ styles, line }: { readonly styles: SlotStyles; readonly line: LoadingLineValue | undefined }) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    return (
        <Box ref={ref} css={styles.footer} data-decision-footer="">
            <LoadingLine value={line} shown={shown} form={fit.form} />
        </Box>
    );
}
