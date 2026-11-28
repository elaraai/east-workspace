/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The thin per-row adapter (#616): compute one row's PRIMITIVE facts under
 * the canvas's focus and hand them to the memoized `PlanBodyRow` — plus the
 * bands a links focus gathers its rows under (#1680's review).
 *
 * The row reads its own selection, chart toggle and active control from the
 * controller (#815), so none of those pass through here: a selection click
 * renders the two rows it moved, and the canvas not at all.
 *
 * The bands drawn here, as every row's parts, are plain elements of their
 * slots' classes, made once a theme (`useSlotClass`, #1780).
 *
 * @packageDocumentation
 */

import type { ComponentProps, ReactNode } from "react";
import { visuallyHiddenStyle } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { EastChakraComponent } from "@elaraai/east-ui-components";
import { useSlotClass } from "@elaraai/east-ui-components/internal";
import { PlanBodyRow } from "../rows/BodyRow.js";
import { BandPlot } from "../rows/GroupRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import { planRowRole } from "../rows/row-facts.js";
import type { PlanRowDrop } from "../rows/RowShell.js";
import type { PlanDraftMark } from "../use-plan-editing.js";
import { usePlanItemNav } from "../controller/react.js";
import { usePlanWords } from "../words.js";
import { usePlanGridRow } from "./grid.js";
import {
    chartsOpenFor, focusBandKey, rowHeight,
    type PlanDerived, type PlanFocusBand, type PlanFocusCtx, type PlanLaneBand, type PlanRowIndex, type PlanRowValue,
    type VisibleRow,
} from "../model.js";
import type { PlanEvent, RowKey } from "../plan-state.js";

type Styles = Record<string, Record<string, unknown>>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

/** What every body row of one render shares. */
export interface PlanRowContext {
    styles: Styles;
    gridTemplate: string;
    /** The Plan declares the right axis's rail (#1750): the template's last track, which a chart row's right axis reads
     *  its numbers in. */
    rail: boolean;
    dense: boolean;
    storageKey: string;
    index: PlanRowIndex;
    derived: PlanDerived;
    dispatch: (e: PlanEvent) => void;
    /** The chart rows the user expanded (heights read it). */
    chartsExpanded: ReadonlySet<RowKey>;
    /** Which row is focused — all the row roles need. */
    focusCtx: PlanFocusCtx | undefined;
    /** The same, with the expand clamp — what the heights need. */
    heightCtx: PlanFocusCtx | undefined;
    /** The rows any link edge touches — they grow the links control. */
    linkedKeys: ReadonlySet<RowKey>;
    /** Whether the root declares `expandRender`. */
    canExpand: boolean;
    /** The focused row's developer render / gutter body, or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** Whether the source is not yet exhausted — a paged canvas still loading
     *  (a top-level section's count then covers only the loaded windows). */
    partial: boolean | undefined;
    rowDrop: PlanRowDrop | undefined;
    /** Each drafted row's mark, by key (#880) — a row reads its own. */
    marks: ReadonlyMap<RowKey, PlanDraftMark>;
    /** The rows that close an open group — each the last visible member of
     *  one (#949, `groupEndsOf`). */
    groupEnds: ReadonlySet<RowKey>;
    /** Whether a row's events are unread (#1398, CL2): a paged kind's resource whose cells have not landed, or are read
     *  again — its plot washed under what it holds. Absent, every row's are read. */
    unread?: ((row: PlanRowValue) => boolean) | undefined;
}

/**
 * One visible row, as the memoized body row.
 *
 * @param v - The visible row
 * @param ctx - What the render's rows share
 * @returns The row element
 */
export function renderPlanRow(v: VisibleRow, ctx: PlanRowContext): ReactNode {
    const { focusCtx, expandBody, expandGutterBody, styles, storageKey } = ctx;
    const h = rowHeight(v, ctx.dense, ctx.chartsExpanded, ctx.heightCtx, ctx.derived);
    // R1 pinned strips (a pinned row a links focus does not gather, 16px), R2
    // context strips (every data row but the focused one under an expand
    // focus, 16px) and the FOCUSED row, which carries the render inside itself
    // — what makes it (and its gutter) tall, see `PlanFocusCtx.renderPx`.
    // Group bands are exempt: they are wayfinding, and a wall of strips with no
    // structure between them is unreadable (`planRowRole`).
    const role = planRowRole(v, focusCtx, expandBody !== null);
    const isFocal = role === "focal";
    // R2 — the focused row keeps its NORMAL anatomy; `axis` washes /
    // suppresses the shared lines inside its plot.
    const rowExpand = v.row.expand.type === "some" ? v.row.expand.value : undefined;
    const axisMode = isFocal && rowExpand !== undefined && rowExpand.axis.type !== "keep"
        ? rowExpand.axis.type
        : undefined;
    return (
        <PlanBodyRow
            v={v}
            h={h}
            styles={styles}
            gridTemplate={ctx.gridTemplate}
            rail={ctx.rail}
            // A gathered row opens nothing: its subtree is the others' (#1680's review).
            hasChildren={v.gathered === undefined && (ctx.index.children.get(v.row.key)?.length ?? 0) > 0}
            derived={ctx.derived}
            dispatch={ctx.dispatch}
            focusRole={role}
            axisMode={axisMode}
            showLinksControl={ctx.linkedKeys.has(v.row.key)}
            showExpandControl={v.row.expand.type === "some" && ctx.canExpand}
            partial={ctx.partial}
            rowDrop={ctx.rowDrop}
            draft={ctx.marks.get(v.row.key)}
            groupEnd={ctx.groupEnds.has(v.row.key)}
            unread={ctx.unread?.(v.row) === true}
            {...(isFocal && expandBody !== null ? {
                // The author's render is its own part (#811): a throw while
                // rendering it stays inside the focused row.
                expandBody: (
                    <PlanPartBoundary part={{ kind: "expandRender" }} resetKey={expandBody} styles={styles}>
                        <EastChakraComponent value={expandBody} storageKey={`${storageKey}.${v.row.key}.expand`} />
                    </PlanPartBoundary>
                ),
                // Its natural height: an expandable chart's expanded one, its render open (#1680's review).
                bandHeight: rowHeight(v, ctx.dense, v.row.kind.type === "chart"
                    ? chartsOpenFor(v.row.key, v.row.kind.value.expandable, ctx.chartsExpanded) : ctx.chartsExpanded, undefined, ctx.derived),
                ...(expandGutterBody !== null ? {
                    expandGutter: (
                        <PlanPartBoundary part={{ kind: "expandGutter" }} resetKey={expandGutterBody} styles={styles}>
                            <EastChakraComponent value={expandGutterBody}
                                storageKey={`${storageKey}.${v.row.key}.expandgutter`} />
                        </PlanPartBoundary>
                    ),
                } : {}),
            } : {})}
        />
    );
}

/**
 * The sticky parent (#823) — pinned under a bounded frame's header while the
 * rows in view belong to a parent whose own row has scrolled off: the
 * parent's name — for a deep tree, the path of its ancestors down to it — in
 * the group band's look. A click takes the reader to the parent's row. Not a
 * row of the grid: a reader already hears each row's level, and ← walks to
 * the parent.
 */
export function PlanStickyParent({ parent, path, styles, gridTemplate, onGo }: {
    parent: PlanRowValue;
    /** The parent's ancestors, outermost first. */
    path: readonly PlanRowValue[];
    styles: Styles;
    gridTemplate: string;
    /** Go to the parent's row. */
    onGo: () => void;
}) {
    const slot = useSlotClass();
    return (
        <div className={slot(styles.stickyParent)} style={{ gridTemplateColumns: gridTemplate }}
            data-plan-sticky={parent.key} aria-hidden="true" onClick={onGo}>
            {/* A heading across the whole row (#1680's review): its path, then its name. */}
            <div className={slot(styles.groupName)} data-across="">
                {path.map((a) => <span key={a.key} className={slot(styles.stickyPath)}>{a.gutter.label}</span>)}
                <span>{parent.gutter.label}</span>
            </div>
        </div>
    );
}

/**
 * A links focus's band (#1680's review) — the open group band's look, a 26px
 * heading over the rows its role gathers: `Upstream · 2`, `Focused`, `Linked ·
 * 1`, `Downstream · 3`, a role with no rows saying so; or `Other rows · 27`,
 * which every row the focus does not gather folds into, and which opens in
 * place as a section does — its caret, a click, Enter or Space. A grid row of
 * its own (#819), at the first level: the rows a role gathers stand one in.
 */
export function PlanFocusBandRow({ band, h, styles, gridTemplate, dispatch }: {
    band: PlanFocusBand;
    /** The height the model laid the band out at (#817). */
    h: number;
    styles: Styles;
    gridTemplate: string;
    dispatch: (e: PlanEvent) => void;
}) {
    const words = usePlanWords();
    const slot = useSlotClass();
    const itemKey = focusBandKey(band.role);
    const { active, focusSeq } = usePlanItemNav(itemKey);
    const grid = usePlanGridRow(itemKey, active, focusSeq);
    const others = band.role === "others";
    const caption = band.role === "others" ? words.m.otherRows() : words.m.focusRole({ role: band.role });
    // The focused row's band holds the one row: it counts nothing. A role with no rows says so.
    const counted = band.role !== "focused" && band.count > 0;
    return (
        <div ref={grid.ref} className={slot(styles.groupBand)} style={{ gridTemplateColumns: gridTemplate, height: `${h}px` }}
            role="row" aria-level={1} aria-expanded={others ? band.open : undefined}
            tabIndex={grid.tabIndex} onFocus={grid.onFocus}
            data-plan-item={itemKey}
            data-plan-focusband={band.role}
            data-plan-h={h}
            // A role's band opens nothing: no click, no hand.
            data-static={others ? undefined : ""}
            onClick={others ? () => dispatch({ t: "focus.others" }) : undefined}>
            {/* Its heading lies across the row whether the band is open or not, its plot in the row's first line under
                it, so the band, folded, is never marked so: its caret says it, as `aria-expanded` does. At the first
                level, the recipe's own padding. */}
            <div className={slot(styles.groupName)} role="rowheader" data-across="">
                <span className={slot(styles.caret)} data-collapsed={others && !band.open ? "" : undefined}>
                    {others && <FontAwesomeIcon icon={faCaretDown} />}
                </span>
                <span data-plan-gutter="title">
                    <span className={slot(styles.gutterLabel)} data-plan-gutter="label">{caption}</span>
                    {counted ? (
                        <>
                            <span className={slot(styles.groupMeta)} data-plan-gutter="meta" aria-hidden="true">{words.number(band.count)}</span>
                            <span className={slot(visuallyHiddenStyle)}>{words.m.groupMeta({ n: band.count, count: words.number(band.count) })}</span>
                        </>
                    ) : band.count === 0 && <span className={slot(styles.focusNone)} data-plan-focusnone>{words.m.focusNone()}</span>}
                </span>
                <span />
            </div>
            <BandPlot styles={styles} />
        </div>
    );
}

/**
 * A rule a links focus opens for its family's lanes (#1680's review): room
 * between two rows it gathers, as tall as the lane tracks the links layer draws
 * along it. No row of the grid — a reader hears the rows either side.
 */
export function PlanLaneBandRow({ band, h, styles, gridTemplate }: {
    band: PlanLaneBand;
    /** The height the model laid the band out at (#817). */
    h: number;
    styles: Styles;
    gridTemplate: string;
}) {
    const slot = useSlotClass();
    return (
        <div className={slot(styles.laneBand)} style={{ gridTemplateColumns: gridTemplate, height: `${h}px` }} aria-hidden="true"
            data-plan-lanes={band.rule} data-plan-h={h}>
            <div data-plan-lane-gutter />
            <BandPlot styles={styles} />
        </div>
    );
}
