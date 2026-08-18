/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cross-cutting contract types — the semantic-layer subset of `style.ts`
 * plus the `StateValueType` seven-state vocabulary.
 *
 * @remarks
 * Downstream components that encode §0 contracts (states, paired-icon status,
 * density cascade, hover intent, focus ring, elevation) import from here so
 * the dependency graph is explicit. The full `Style` namespace (with raw
 * layout tokens) remains the public surface; `contracts/` is an internal
 * sibling used by component IR factories and renderer helpers.
 *
 * @packageDocumentation
 */

export {
    StatusTokenType, type StatusTokenLiteral,
    HoverIntentType, type HoverIntentLiteral,
    DensityType, type DensityLiteral,
    VerbosityType, type VerbosityLiteral,
    ElevationType, type ElevationLiteral,
    FocusStyleType, type FocusStyleLiteral,
    TextStyleType, type TextStyleLiteral,
    MotionDurationType, type MotionDurationLiteral,
    MotionEasingType, type MotionEasingLiteral,
    TransitionType, type TransitionLiteral,
} from "../style.js";

export {
    StateValueType, type StateValueLiteral, StateValue,
    EventFlavourType, EventStateType, type EventStateLiteral,
} from "./states.js";

export {
    TimeResolutionType, type TimeResolutionLiteral,
    TimeStepType,
} from "./time.js";

export {
    SliceAffordanceType, type SliceAffordanceLiteral, SliceAffordance,
} from "./slice-affordances.js";

export {
    ValueFormatType,
} from "./format.js";

export {
    LibraryRefType,
    CellRefType,
    DragSinkType, type DragSinkLiteral,
    DragEdgeType, type DragEdgeLiteral,
    DragEventType,
    CanDropFnType,
} from "./drag.js";

export {
    ApprovalStateType, type ApprovalStateLiteral,
    RowRefType,
    reviewType, type ReviewStructType,
    RowReviewType,
    type ReviewConfig,
    buildReview,
    deriveApproval,
} from "./review.js";

export {
    PickStateType, PickItemType, PickStateHandleType,
    PickBindType, PickHandleType, type PickHandle,
    type PickOptions,
    createPickState, createPickBind, pickActive, pickVisible,
    Pick,
} from "./pick.js";

export {
    SeekRangeType, SeekQueryType,
    PagedSourceType, type PagedSource,
    RowSourceType, type RowSource,
    type PagedSourceLike, type RowSourceInput, type ResolvedRowSource,
    resolveRowSource, buildRowSource,
    Paged, type PagedOfOptions,
} from "./source.js";
