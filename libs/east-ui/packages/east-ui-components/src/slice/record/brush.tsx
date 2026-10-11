/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { useFormatters } from "../../format/index.js";
import { BrushStrip } from "../brush-strip.js";
import { useSliceReactivity } from "../use-slice-reactivity.js";
import { RecordSliceFailure } from "./index.js";
import { clearRecordSliceWindow, recordSliceDomain, recordSliceWindow, setRecordSliceWindow } from "./range.js";

/** A bounded index extent on the existing brush. Only release changes the query. */
export function RecordSliceBrush({ slice }: { slice: ValueTypeOf<RecordSliceBindType> }) {
    useSliceReactivity(slice.key);
    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const edit = useSlotRecipe({ key: "sliceEdit" })();
    const words = useFormatters();
    const [error, setError] = useState<string>();
    const read = useCallback(() => ({ domain: recordSliceDomain(slice), window: recordSliceWindow(slice) }), [slice]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) return <RecordSliceFailure slice={slice} message="Could not load range" />;
    const { domain, window } = result.value;
    if (domain === undefined) return null;
    // Geometry uses JS numbers; precise Integer controls keep all 64 bits.
    // Refuse an imprecise brush instead of rounding a record key silently.
    const safe = domain.kind !== "integer" || (Number.isSafeInteger(domain.min) && Number.isSafeInteger(domain.max + 1));
    const step = domain.kind === "float" ? Math.max(Number.MIN_VALUE, Math.abs(domain.max) * Number.EPSILON) : 1;
    const end = domain.max + step;
    const span = end - domain.min;
    if (!safe || !Number.isFinite(span) || span <= 0 || (domain.kind === "datetime" && !Number.isFinite(new Date(end).getTime()))) {
        return <Box css={edit.hint}>Use the range fields to choose exact bounds.</Box>;
    }
    const clamp = (fraction: number) => Math.max(0, Math.min(1, fraction));
    const fraction = (value: number) => clamp((value - domain.min) / span);
    const at = (fraction: number) => domain.min + clamp(fraction) * span;
    const from = window === undefined ? 0 : fraction(window.min);
    const to = window === undefined ? 1 : fraction(window.max);
    const label = (value: number) => domain.kind === "datetime" ? words.monthDay(new Date(value)) : words.number(value);
    const run = (action: () => void) => {
        try { action(); setError(undefined); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this range"); }
    };
    return <Box css={frame.brushStack} data-record-slice-brush="">
        <BrushStrip counts={undefined} window={window !== undefined && to > from ? { from, to } : undefined}
            height={18} barHeight={9} onCommit={(lo, hi) => run(() => {
                const a = domain.kind === "float" ? at(lo) : Math.floor(at(lo));
                const b = domain.kind === "float" ? at(hi) : Math.max(a + 1, Math.ceil(at(hi)));
                setRecordSliceWindow(slice, a, b);
            })} onClear={() => run(() => clearRecordSliceWindow(slice))} />
        <Box css={frame.brushAxis} aria-hidden="true"><Box as="span">{label(domain.min)}</Box><Box as="span">{label(domain.max)}</Box></Box>
        {error !== undefined && <Box css={edit.hintError} role="alert">{error}</Box>}
    </Box>;
}
