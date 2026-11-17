/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pivot's tile (#1671, TBL-4): {@link pivotModel}'s cells drawn by
 * east-ui-components' Matrix, filling its tile, which scrolls a wide one
 * inside it; under it, with heat on, the heat legend — its five steps over
 * their lower edges, the top step closed — and, when it holds fewer groups
 * than its source has, a line that says how many of how many.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { EastChakraMatrix } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { ShownNote } from "./notes.js";
import { pivotModel, type PivotView } from "./pivot-matrix.js";
import type { VisualAsked } from "./values.js";

/** Props of {@link PivotVisual}: the pivot, its answers and its source, and where its Matrix keeps its state. */
export interface PivotVisualProps extends VisualAsked {
    /** The pivot. */
    readonly pivot: PivotView;
    /** Where its Matrix keeps its state: its row header's width. */
    readonly storageKey: string;
}

/**
 * A pivot's tile: its cells, its heat legend, and what it holds of how many.
 *
 * @param props - The pivot, its answers, its source and where its Matrix keeps its state
 * @returns The tile's body; nothing when its program did not answer
 */
export function PivotVisual({ pivot, asks, answers, source, storageKey }: PivotVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => pivotModel(pivot, asks, answers, source, words, m), [pivot, asks, answers, source, words, m]);
    if (model === undefined) return null;
    return (
        <Box css={styles.root} data-studio-pivot="">
            <Box css={styles.table}>
                <EastChakraMatrix value={model.matrix} storageKey={`${storageKey}.matrix`} />
            </Box>
            {(model.heat !== undefined || model.shown !== undefined) && (
                <Box css={styles.foot}>
                    {model.heat !== undefined && (
                        <Box css={styles.heat} data-studio-heat="">
                            <Box css={styles.heatRamp}>
                                {model.heat.map((step, i) => <Box key={i} as="span" css={styles.heatSwatch} data-step={i + 1} role="img" aria-label={step.name} />)}
                            </Box>
                            <Box css={styles.heatTicks} aria-hidden>
                                {model.heat.map((step, i) => <span key={i}>{step.label}</span>)}
                            </Box>
                        </Box>
                    )}
                    {model.shown !== undefined && <ShownNote shown={model.shown} />}
                </Box>
            )}
        </Box>
    );
}
