/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pivot's tile (#1671, TBL-4): {@link pivotModel}'s cells drawn by
 * east-ui-components' Matrix, filling its tile, which scrolls a wide one
 * inside it; under it, with heat on, the heat legend — its five steps over
 * their lower edges, the top step closed; a page of its rows at a time
 * (#1667), with where the page stands and the Pagination in its foot past one
 * page; and, when it holds fewer groups than its source has, a line that says
 * how many of how many.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { some, variant } from "@elaraai/east";
import { EastChakraMatrix, type MatrixRootValue } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { PrintSource, PrintState } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { useGroupClicks } from "./clicks.js";
import { VisualMeta } from "./meta.js";
import { SourceFailed } from "./notes.js";
import { VisualGroupsFoot, usePagedModel, type PageModelOf } from "./paging.js";
import { pivotModel, type PivotView } from "./pivot-matrix.js";
import type { Visual, VisualSource } from "./values.js";

/** Props of {@link PivotVisual}: the pivot, its source, the page's state, and where its Matrix and pager keep their state. */
export interface PivotVisualProps {
    /** The visual: a pivot. */
    readonly visual: Visual;
    /** The pivot. */
    readonly pivot: PivotView;
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The page's state, as its programs read it. */
    readonly state: PrintState;
    /** Where its Matrix keeps its state — its row header's width — and its pager. */
    readonly storageKey: string;
}

/**
 * A pivot's tile: a page of its rows' cells, its heat legend, where the page
 * stands, and what it holds of how many.
 *
 * @param props - The pivot, its source, the page's state and where its Matrix and pager keep their state
 * @returns The tile's body; nothing until its program answers
 */
export function PivotVisual({ visual, pivot, source, read, state, storageKey }: PivotVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const modelOf = useCallback<PageModelOf<ReturnType<typeof pivotModel>>>((asks, answers, offset) => pivotModel(pivot, asks, answers, source, words, m, offset),
        [pivot, source, words, m]);
    const { drawn, waiting, failed, offset, setPage } = usePagedModel(visual, read, state, modelOf);
    // A click on a cell tells the groups it stands for (TBL-6): the Matrix tells its row's and its column's keys.
    const { raise, onClickCapture } = useGroupClicks();
    const matrix = useMemo((): MatrixRootValue | undefined => (drawn === undefined || raise === undefined ? drawn?.matrix : {
        ...drawn.matrix,
        onCellClick: some((event) => {
            raise(drawn.clicked(event.row, event.column));
            return null;
        }),
    }), [drawn, raise]);
    if (failed !== undefined) return <SourceFailed source={source.name} message={failed.message} retry={failed.retry} />;
    if (drawn === undefined || matrix === undefined) return null;
    return (
        <Box css={styles.root} data-studio-pivot="" data-waiting={waiting ? "" : undefined} onClickCapture={onClickCapture}>
            <VisualMeta view={variant("table", variant("pivot", pivot))} source={source} shown={drawn.shown} />
            <Box css={styles.table}>
                <EastChakraMatrix value={matrix} storageKey={`${storageKey}.matrix`} tile />
            </Box>
            {drawn.heat !== undefined && (
                <Box css={styles.heat} data-studio-heat="">
                    <Box css={styles.heatRamp}>
                        {drawn.heat.map((step, i) => <Box key={i} as="span" css={styles.heatSwatch} data-step={i + 1} role="img" aria-label={step.name} />)}
                    </Box>
                    <Box css={styles.heatTicks} aria-hidden>
                        {drawn.heat.map((step, i) => <span key={i} data-studio-heat-tick="">{step.label}</span>)}
                    </Box>
                </Box>
            )}
            <VisualGroupsFoot place={drawn.place} shown={drawn.shown} offset={offset} onPage={setPage} storageKey={storageKey} />
        </Box>
    );
}
