/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's resolved UIComponent-coupled IR — since the data-interface
 * redesign only the ROOT and the review config touch `UIComponentType`; the
 * whole row vocabulary (elements, kinds, rows) is pure data in `./types.ts`.
 * These are the named twins of the `Plan` arm in `component.ts`, which spells
 * the SAME shapes inline with the recursion `node`. The renderer decodes the
 * arm's values through {@link PlanRootType}, so the two must be one East
 * type: `test/collections/plan.spec.ts` compares them as East type values,
 * and a field (or a field type) on only one side fails it.
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
import { PickBindType } from "../../contracts/pick.js";
import { reviewType, type ReviewStructType } from "../../contracts/approval.js";
import { CanDropFnType, DragEventType } from "../../contracts/drag.js";
import { SliceChromeType } from "../../platform/slice/index.js";
import {
    PlanAxisType,
    PlanGrainType,
    PlanLinkType,
    PlanRowsType,
    PlanElementRefType,
    PlanRowIdType,
    PlanGroupToggleEventType,
    PlanFooterItemType,
    PlanStyleType,
    PlanUiBindType,
} from "./types.js";

// ============================================================================
// Resolved types — the UIComponent-coupled shapes at `UIComponentType`
// ============================================================================

/**
 * The Plan review config — the shared review contract at the row's id
 * ({@link PlanRowIdType}, #822).
 */
export const PlanReviewType: ReviewStructType<PlanRowIdType, UIComponentType> = reviewType(PlanRowIdType, UIComponentType);
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
 * developer render for rows declaring `expand`, over the row's id) — one stored function per
 * surface instead of UI embedded per element. A click on any element reports
 * to ONE callback over the same ref (`onElementClick`, #824), and the
 * interaction state a host wants to hold — selection, collapse, charts, a row
 * to bring into view — rides a bound `ui` state.
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
    expandRender: OptionType(FunctionType([PlanRowIdType], UIComponentType)),
    // The GUTTER half of R2. An expanded row's gutter cell grows with the row
    // (one tall cell, top-aligned), and the space that opens up is the
    // author's — identity that only earns its place when the row has the
    // canvas. Same shape as `expandRender`, over the same row id.
    expandGutter: OptionType(FunctionType([PlanRowIdType], UIComponentType)),
    review: OptionType(PlanReviewType),
    pick: OptionType(PickBindType),
    slice: OptionType(SliceChromeType),
    footer: ArrayType(PlanFooterItemType),
    // DnD target role — the shared grammar verbatim (contracts/drag.ts); no
    // id, no drop target (#824 — it used to be `""`).
    id: OptionType(StringType),
    sources: ArrayType(StringType),
    onDrag: OptionType(FunctionType([DragEventType], NullType)),
    canDrop: OptionType(CanDropFnType),
    // Selection + the one element click (#824).
    onSelect: OptionType(FunctionType([PlanRowIdType], NullType)),
    onElementClick: OptionType(FunctionType([PlanElementRefType], NullType)),
    onGroupToggle: OptionType(FunctionType([PlanGroupToggleEventType], NullType)),
    onGrainChange: OptionType(FunctionType([PlanGrainType], NullType)),
    // The interaction state a host holds — a bound `State.bind` handle (#824).
    ui: OptionType(PlanUiBindType),
    style: OptionType(PlanStyleType),
});
/** Type alias for {@link PlanRootType}. */
export type PlanRootType = typeof PlanRootType;
