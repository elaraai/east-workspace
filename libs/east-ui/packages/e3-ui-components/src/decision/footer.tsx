/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { LoadingLine, RecordSliceSaveNotice, useFooterFit, useRevealed, type LoadingLineValue, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { DecisionQueueWords } from "./messages.js";

/**
 * The DecisionQueue's footer (`Decision Queue Spec.md` §7, R26): the shared
 * footer rail holding a Save's notice of the cases it took out of the
 * narrowing — `3 decisions left this view` — and at its trailing end the
 * shared loading line (#1398, CL3): `Loading decisions…`, a new narrowing's
 * `Filtering decisions…`, or `Couldn't read decisions` with Retry; nothing
 * while nothing is in flight. The line shows on the frame's one reveal clock
 * (CL4, its `LoadingReveal`), a failure at once.
 *
 * @param props - The `decisionQueue` recipe's styles, the queue's words, the slice's part over the cases and what the
 *   cases' read says
 * @returns The footer
 */
export function DecisionFooter({ styles, words, slice, line }: {
    readonly styles: SlotStyles;
    readonly words: DecisionQueueWords;
    /** The slice's part over the cases, whose Save notice counts the cases a Save took out of the narrowing; `undefined` with none. */
    readonly slice: ValueTypeOf<RecordSliceBindType> | undefined;
    /** What the cases' read says: what is read, or why it could not be; `undefined` while it has landed. */
    readonly line: LoadingLineValue | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    return (
        <Box ref={ref} css={styles.footer} data-decision-footer="">
            {slice !== undefined && <RecordSliceSaveNotice slice={slice} singular={words.m.nounOne()} plural={words.m.noun()} />}
            <LoadingLine value={line} shown={shown} form={fit.form} />
        </Box>
    );
}
