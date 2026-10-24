/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of the Plan's rows not drawn yet (#1398, CL2) — an unloaded run of a
 * paged block (#577, #823), or a window whose read failed (#811) — as the
 * shared `UnloadedRun`: rows at the rows' pitch where the run meets the view,
 * each on the canvas's own two columns with the gutter's rule, the bucket grid
 * and the now line; its label a bar, and its sub line one on two-line rows;
 * its plot the region wash — no bar, card or event shape, so nothing implies
 * a time (CL2). The canvas cannot know how many rows an unvisited window
 * produces (a series emits several per source element, or none), so the
 * placeholder rows say nothing of a count: they are the rows' look at the
 * rows' pitch, and nothing else.
 *
 * Its height comes from the ledger, so the run and the rows that replace it
 * occupy exactly the same space: scrolling in loads content without moving
 * anything below, and eviction puts the run back with nothing shifting either.
 *
 * In the treegrid (#819) each run is ONE row, and its one cell — the grid's
 * row count says only what is known, and a keyboard move onto it asks the
 * source for the window beside it. Its placeholders are `aria-hidden` (CL12),
 * and it is busy while its own windows are in flight. A failed window says so once, in its first
 * row in view: the reason and Retry across its plot, its gutter kept; its
 * other rows keep the gutter column, the grid and the rules, their plots bare
 * (CL11). Its Retry is out of the tab order — the row's Tab walk reaches it.
 */

import { useMemo } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { UnloadedRun, loadingLineText, type RunCell, type RunFailure } from "@elaraai/east-ui-components/internal";
import { NowLine } from "../../shared/time/now-line.js";
import { bandElements, type PlanBand, type PlanWindowFailure } from "../use-plan-paging.js";
import { usePlanWords } from "../words.js";
import { bodyItemKey } from "../model.js";
import { usePlanGeometry, usePlanScale } from "../context.js";
import { usePlanItemNav } from "../controller/react.js";
import { usePlanGridRow } from "../root/grid.js";
import { GridSeparators } from "./RowShell.js";

type Styles = Record<string, Record<string, unknown>>;

/** A recipe slot's styles, as the shared run merges them over its own. */
const slot = (styles: Styles, name: string): SystemStyleObject | undefined => styles[name] as SystemStyleObject | undefined;

/** To the treegrid the run is one row, and its one cell (#819): the grid numbers no columns. */
const RUN_CELL = {};

/** Props of {@link PlanRunRow}: an unloaded run, or a failed window. */
export interface PlanRunRowProps {
    /** The unloaded run above or below a block's resident rows. */
    band?: PlanBand | undefined;
    /** A window whose read failed. */
    failure?: PlanWindowFailure | undefined;
    styles: Styles;
    /** The rows' grid tracks: the gutter, then the plot. */
    gridTemplate: string;
    /** The rows' pitch, px: what the run's placeholder rows draw at. */
    pitch: number;
    /** What the rail counts the rows in — `work orders`: what a failed window's line names them by. */
    noun: string;
    /** Ask a failed window again. */
    onRetry: (w: number) => void;
}

/** A run of rows not drawn yet — see the module docs. */
export function PlanRunRow({ band, failure, styles, gridTemplate, pitch, noun, onRetry }: PlanRunRowProps) {
    const words = usePlanWords();
    const { m } = words;
    const scale = usePlanScale();
    const geometry = usePlanGeometry();
    const itemKey = band !== undefined ? bodyItemKey({ kind: "band", band }) : bodyItemKey({ kind: "failed", failure: failure! });
    const { active, focusSeq } = usePlanItemNav(itemKey);
    const grid = usePlanGridRow(itemKey, active, focusSeq);
    const px = Math.max(0, band?.px ?? failure?.px ?? 0);
    const from = band?.from ?? failure?.from ?? 0;
    const to = band?.to ?? failure?.to ?? -1;
    // The gutter's label — and its sub line on two-line rows — then the plot: the wash under the grid and the now line.
    const nowFrac = scale.nowFrac;
    const cells = useMemo((): RunCell[] => [
        { kind: pitch >= geometry.rowStacked ? "label2" : "label", css: slot(styles, "runGutter") },
        {
            kind: "wash", css: slot(styles, "runPlot"),
            overlay: <>
                <GridSeparators styles={styles} />
                {nowFrac !== undefined && <NowLine styles={styles} at={nowFrac} data-plan-axisline data-plan-now />}
            </>,
        },
    ], [pitch, geometry.rowStacked, styles, nowFrac]);
    // Said once, in its first row in view, across its plot: in the rail's noun, its elements 1-based as the footer's are.
    const w = failure?.w;
    const range = { from: words.number(from + 1), to: words.number(to + 1) };
    const failed = useMemo((): RunFailure | undefined => (w === undefined ? undefined : {
        message: loadingLineText(m.lineFailed({ noun, ...range })),
        retry: { onRetry: () => onRetry(w), label: m.retry(), name: m.retryRange({ noun, ...range }), tabStop: false },
        from: 1,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the range is its two formatted ends
    }), [w, m, noun, range.from, range.to, onRetry]);
    return (
        <Box
            ref={grid.ref}
            css={styles.runBand}
            role="row"
            aria-level={1}
            tabIndex={grid.tabIndex}
            onFocus={grid.onFocus}
            data-plan-item={itemKey}
            data-plan-window-band={band?.at}
            data-plan-failed={w}
            data-plan-elements={band !== undefined ? bandElements(band) : to - from + 1}
            // The ledger-derived height, as data: the height itself is the run's, which a DOM test (jsdom resolves
            // no Chakra classes) holds the geometry contract against (#613).
            data-plan-px={Math.round(px)}
            aria-busy={band?.loading !== undefined ? "true" : undefined}
        >
            <UnloadedRun height={px} pitch={pitch} columns={gridTemplate} cells={cells} first={from} rowCss={slot(styles, "runRow")} failed={failed} cell={RUN_CELL} />
        </Box>
    );
}
