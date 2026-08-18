/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's resolved UIComponent-coupled IR — since the data-interface
 * redesign only the ROOT and the review config touch `UIComponentType`; the
 * whole row vocabulary (elements, kinds, rows, templates) is pure
 * data in `./types.ts`. These are the named twins of the `Plan` arm in
 * `component.ts` (which spells the SAME shapes inline with the recursion
 * `node`). Keep the two in lockstep: every factory builds values of these
 * types and `Plan.Root` constructs the variant against the arm, so any
 * drift fails the specs at build time.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { reviewType, type ReviewStructType } from "../../contracts/approval.js";
import { CanDropFnType, DragEventType } from "../../contracts/drag.js";
import { SliceChromeType } from "../../platform/slice/index.js";
import {
    PlanAxisType,
    PlanGrainType,
    PlanLinkType,
    PlanRowsType,
    PlanElementRefType,
    PlanRowRefType,
    PlanRunClickEventType,
    PlanEventClickEventType,
    PlanMarkClickEventType,
    PlanChipClickEventType,
    PlanCellClickEventType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
} from "./types.js";

// ============================================================================
// Resolved types — the UIComponent-coupled shapes at `UIComponentType`
// ============================================================================

/**
 * The Plan review config — the shared review contract at the Plan's
 * keyed-row subject (`{ key }`).
 */
export const PlanReviewType: ReviewStructType<PlanRowRefType, UIComponentType> = reviewType(PlanRowRefType, UIComponentType);
/** Type alias for {@link PlanReviewType}. */
export type PlanReviewType = typeof PlanReviewType;

/**
 * The Plan root IR — the whole canvas.
 *
 * @remarks
 * Window and resolution deliberately have **no callbacks**: they are slice
 * writes (`setRange` / `setResolution`) — hosts observe the slice. Row
 * order is data (no sort callback), and element detail lives in the root
 * RESOLVERS: `popover` / `hover` over {@link PlanElementRefType} (a `none`
 * result opens nothing) and `expandRender` over the row ref (the R2
 * developer render for rows declaring `expand`) — one stored function per
 * surface instead of UI embedded per element.
 */
export const PlanRootType = StructType({
    rows: PlanRowsType,
    // The link graph (R1) — run-edge to run-edge quantity links; the
    // links-focus control gathers a row's transitive family over it.
    links: ArrayType(PlanLinkType),
    axis: PlanAxisType,
    grain: OptionType(PlanGrainType),
    // The generalized element resolvers (Plan Data Interface.md §3.3) —
    // invoked lazily at interaction time; naming per the Schematic /
    // Flowchart `*Hover` resolver convention (never `on*` — that prefix is
    // the action callbacks below).
    popover: OptionType(FunctionType([PlanElementRefType], OptionType(UIComponentType))),
    hover: OptionType(FunctionType([PlanElementRefType], OptionType(UIComponentType))),
    expandRender: OptionType(FunctionType([PlanRowRefType], UIComponentType)),
    // The GUTTER half of R2. An expanded row's gutter cell grows with the row
    // (one tall cell, top-aligned), and the space that opens up is the
    // author's — identity that only earns its place when the row has the
    // canvas. Same shape as `expandRender`, over the same row ref.
    expandGutter: OptionType(FunctionType([PlanRowRefType], UIComponentType)),
    review: OptionType(PlanReviewType),
    slice: OptionType(SliceChromeType),
    footer: ArrayType(PlanFooterItemType),
    // DnD target role — the shared grammar verbatim (contracts/drag.ts).
    id: StringType,
    sources: ArrayType(StringType),
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    canDrop: OptionType(CanDropFnType),
    // Selection + per-element clicks.
    onSelect: OptionType(FunctionType([PlanRowRefType], NullType)),
    onRunClick: OptionType(FunctionType([PlanRunClickEventType], NullType)),
    onEventClick: OptionType(FunctionType([PlanEventClickEventType], NullType)),
    onMarkClick: OptionType(FunctionType([PlanMarkClickEventType], NullType)),
    onChipClick: OptionType(FunctionType([PlanChipClickEventType], NullType)),
    onCellClick: OptionType(FunctionType([PlanCellClickEventType], NullType)),
    onGroupToggle: OptionType(FunctionType([PlanGroupToggleEventType], NullType)),
    onGrainChange: OptionType(FunctionType([PlanGrainType], NullType)),
    style: OptionType(PlanStyleType),
});
/** Type alias for {@link PlanRootType}. */
export type PlanRootType = typeof PlanRootType;
