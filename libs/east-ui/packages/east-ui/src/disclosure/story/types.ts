/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    variant,
} from "@elaraai/east";

// ============================================================================
// Story Layout Type
// ============================================================================

/**
 * Layout options for Story (design/story.html §Story.Root Layouts).
 *
 * @remarks
 * `stacked` is also forced automatically below 720px container width: the
 * stage compresses to `min(stageHeight, 280px)`, sticks to the top, and the
 * prose scrolls beneath it full-width. There is no overlay layout — text
 * never floats over the visual.
 *
 * @property rail-left - Prose rail left, stage right (default; reading order matches scan order)
 * @property rail-right - Mirror image; for pages whose surrounding chrome already sits left
 * @property stacked - Stage on top, prose beneath (forced under 720px)
 */
export const StoryLayoutType = VariantType({
    "rail-left": NullType,
    "rail-right": NullType,
    stacked: NullType,
});

/**
 * Type representing the StoryLayout structure.
 */
export type StoryLayoutType = typeof StoryLayoutType;

/**
 * String literal type for story layout values.
 */
export type StoryLayoutLiteral = "rail-left" | "rail-right" | "stacked";

/**
 * Helper function to create story layout values.
 *
 * @param v - The layout string
 * @returns An East expression representing the story layout
 */
export function StoryLayout(v: StoryLayoutLiteral): ExprType<StoryLayoutType> {
    return East.value(variant(v, null), StoryLayoutType);
}

// ============================================================================
// Story Step Length Type
// ============================================================================

/**
 * Step runway presets — the scroll distance the reader travels per keyframe
 * (design/story.html §Story.Root Dimensions).
 *
 * @property compact - 36vh per step
 * @property default - 52vh per step
 * @property long - 72vh per step
 */
export const StoryStepLengthType = VariantType({
    compact: NullType,
    default: NullType,
    long: NullType,
});

/**
 * Type representing the StoryStepLength structure.
 */
export type StoryStepLengthType = typeof StoryStepLengthType;

/**
 * String literal type for story step length values.
 */
export type StoryStepLengthLiteral = "compact" | "default" | "long";

/**
 * Helper function to create story step length values.
 *
 * @param v - The step length string
 * @returns An East expression representing the step length
 */
export function StoryStepLength(v: StoryStepLengthLiteral): ExprType<StoryStepLengthType> {
    return East.value(variant(v, null), StoryStepLengthType);
}

// ============================================================================
// Story Binding Types
// ============================================================================

/**
 * The narrative-position binding: Integer read/write closures, the exact
 * struct `State.bind([IntegerType], key, default)` produces — bindings pass
 * straight through, no adapter (design/story.html §Wiring).
 *
 * @remarks
 * The scroll driver writes it as steps cross the trigger line; an external
 * write is treated as navigation — the rail smooth-scrolls that step to the
 * trigger line, then resumes observing. Anything exposing these closures
 * works; there is no bespoke handle type.
 *
 * @property read - Returns the active step index
 * @property write - Sets the active step index (navigation when external)
 * @property has - True when the underlying state key exists
 */
export const StoryActiveBindingType = StructType({
    read: FunctionType([], IntegerType),
    write: FunctionType([IntegerType], NullType),
    has: FunctionType([], BooleanType),
});

/**
 * Type representing the StoryActiveBinding structure.
 */
export type StoryActiveBindingType = typeof StoryActiveBindingType;

/**
 * The within-step scrub binding: Float read/write closures over progress
 * ∈ [0, 1] through the active step, the exact struct
 * `State.bind([FloatType], key, default)` produces.
 *
 * @remarks
 * Written by the scroll driver only; consumers read it (inside `Reactive`)
 * for scroll-locked effects and never write it. Scrub maps 1:1 to scroll —
 * no easing, no duration.
 *
 * @property read - Returns progress through the active step (0–1)
 * @property write - Sets the progress (scroll driver only)
 * @property has - True when the underlying state key exists
 */
export const StoryProgressBindingType = StructType({
    read: FunctionType([], FloatType),
    write: FunctionType([FloatType], NullType),
    has: FunctionType([], BooleanType),
});

/**
 * Type representing the StoryProgressBinding structure.
 */
export type StoryProgressBindingType = typeof StoryProgressBindingType;

// ============================================================================
// Story Style Type
// ============================================================================

/**
 * Visual-only style struct for Story. Content (`steps`), state (`active` /
 * `progress` / `activeStep`), and behaviour (`onStepEnter` / `onStepExit`)
 * live on the main `Story` variant (inline in `component.ts` because steps
 * are recursive `node` children).
 *
 * @property layout - Rail placement (rail-left / rail-right / stacked)
 * @property stageHeight - Stage height as a CSS length (default "420px") —
 *   fixed per story so keyframe tweens never reflow the page
 * @property stepLength - Step runway preset (compact / default / long)
 * @property height - Scrollport height as a CSS length. When set, the
 *   story owns an internal scroll container (the spec demo's `.story-demo`
 *   form) — use it for embeds whose ancestors break sticky (cards,
 *   overflow-clipped frames, showcases). When omitted the story rides the
 *   native page scroll, the default for report pages.
 */
export const StoryStyleType = StructType({
    layout: OptionType(StoryLayoutType),
    stageHeight: OptionType(StringType),
    stepLength: OptionType(StoryStepLengthType),
    height: OptionType(StringType),
});

/**
 * Type representing the Story visual-style structure.
 */
export type StoryStyleType = typeof StoryStyleType;

// ============================================================================
// Style Interfaces
// ============================================================================

/**
 * TypeScript options bag for Story's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`active` / `progress` / `activeStep`) and behaviour
 * (`onStepEnter` / `onStepExit`) live on the main options object passed to
 * `Story.Root`, not here.
 */
export interface StoryStyle {
    /** Rail placement (rail-left / rail-right / stacked) */
    layout?: SubtypeExprOrValue<StoryLayoutType> | StoryLayoutLiteral;
    /** Stage height as a CSS length ("420px", "50vh"); bare numbers are px */
    stageHeight?: SubtypeExprOrValue<StringType> | number;
    /** Step runway preset (compact / default / long) */
    stepLength?: SubtypeExprOrValue<StoryStepLengthType> | StoryStepLengthLiteral;
    /** Scrollport height as a CSS length ("520px", "70vh", "100%"); bare
     *  numbers are px. When set the story owns an internal scroll container
     *  (spec demo form); omit to ride the page scroll */
    height?: SubtypeExprOrValue<StringType> | number;
}

/**
 * TypeScript options bag for `Story.Progress`.
 *
 * @property count - Total number of steps shown by the dots / counter
 * @property active - Narrative-position binding (`State.bind` struct) shared
 *   with the Story it narrates
 * @property title - Eyebrow title at the left of the chrome row
 */
export interface StoryProgressOptions {
    /** Total number of steps shown by the dots / counter */
    count: SubtypeExprOrValue<IntegerType> | number;
    /** Narrative-position binding shared with the Story */
    active?: SubtypeExprOrValue<StoryActiveBindingType>;
    /** Eyebrow title at the left of the chrome row */
    title?: SubtypeExprOrValue<StringType>;
}
