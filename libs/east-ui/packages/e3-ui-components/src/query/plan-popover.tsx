/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The plan's read-out (#941), beside a run's read-outs in the results'
 * footer (`Query Editor Spec.md` §4.11): how the run reads its data, in a
 * word — "One call", "Split call · 3 of 12 pieces done" while it goes,
 * "Split call · 12 pieces" once it has — and, on a click, the plan's
 * explanation (`planWords`) in the design system's popover
 * (`SliceEditPopover`, as the builder's save popover is): the path and why, a
 * split's stages with the jq each is about, and the reads that prune.
 *
 * Its parts are the `queryResults` recipe's: the read-out's `footerPlan`, its
 * `data-state` open while the popover is, and the explanation's `planLines` of
 * `planLine`s, each a `planText` and its `planCode`, a line's kind in
 * `data-kind`. The popover's head, body and arrow are the `sliceEdit`
 * recipe's.
 *
 * @packageDocumentation
 */

import { memo, useMemo, useState } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import type { SplitCallProgress } from "@elaraai/e3-types";
import { SliceEditPopover } from "@elaraai/east-ui-components";
import { planBadge, planWords, type QueryWords } from "./model/words.js";
import type { Styles } from "./parts.js";
import type { QueryPlan } from "./plan.js";

/** Props of {@link QueryPlanReadout}. */
export interface QueryPlanReadoutProps {
    /** The run's plan. */
    readonly planned: QueryPlan;
    /** A split call's progress, while it goes. */
    readonly progress: SplitCallProgress | undefined;
    /** How many pieces a split call cut, once e3 says. */
    readonly pieces: number | undefined;
    /** The words. */
    readonly words: QueryWords;
}

/**
 * Renders the plan's read-out — see the module docs.
 *
 * @param props - The plan, a split call's progress and pieces, and the words ({@link QueryPlanReadoutProps})
 * @returns The read-out, and its popover while open
 */
export const QueryPlanReadout = memo(function QueryPlanReadout({ planned, progress, pieces, words }: QueryPlanReadoutProps) {
    const styles = useSlotRecipe({ key: "queryResults" })() as Styles;
    const [open, setOpen] = useState(false);
    const badge = useMemo(() => planBadge(planned, words, { progress, pieces }), [planned, words, progress, pieces]);
    const lines = useMemo(() => planWords(planned.explanation, words, { progress, pieces }), [planned, words, progress, pieces]);
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} size="lg" label={words.messages.planTitle()}
            trigger={
                <chakra.button type="button" css={styles.footerPlan} data-query-result-plan={planned.kind} data-state={open ? "open" : "closed"}>
                    {badge}
                </chakra.button>
            }>
            <Box as="ul" css={styles.planLines} data-query-plan={planned.kind}>
                {lines.map((line, i) => (
                    <Box as="li" key={i} css={styles.planLine} data-kind={line.kind} data-query-plan-line="">
                        <Box as="span" css={styles.planText}>{line.text}</Box>
                        {line.code !== undefined && <Box as="code" css={styles.planCode}>{line.code}</Box>}
                    </Box>
                ))}
            </Box>
        </SliceEditPopover>
    );
});
