/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's UIComponent-coupled IR — since the data-interface redesign only
 * the ROOT touches `UIComponentType`; the whole row
 * vocabulary (elements, kinds, rows) is pure data in `./types.ts`. The root
 * is the canvas `<Plan>` carries in its payload (`./plan.ts`, #1191).
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
import { CanDropFnType, PickBindType, UIComponentType } from "@elaraai/east-ui";
import { SliceChromeType } from "@elaraai/east-ui/internal";
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
    PlanEditingType,
} from "./types.js";

// ============================================================================
// Resolved types — the UIComponent-coupled shapes at `UIComponentType`
// ============================================================================

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
    // The editing session (#880) — every dropped card and every moved or
    // resized element (#825) is a draft, saved as one checked batch.
    editing: OptionType(PlanEditingType),
    pick: OptionType(PickBindType),
    slice: OptionType(SliceChromeType),
    footer: ArrayType(PlanFooterItemType),
    // DnD target role — the shared grammar (contracts/drag.ts); no id, no
    // library card lands (#824 — it used to be `""`), though the canvas's own
    // elements still move (#825). A drop or a move is a gesture of the editing
    // session (#880); `canDrop` vets it first.
    id: OptionType(StringType),
    sources: ArrayType(StringType),
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
