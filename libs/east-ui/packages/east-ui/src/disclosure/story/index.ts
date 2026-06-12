/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    StoryLayoutType,
    StoryLayout,
    StoryStepLengthType,
    StoryActiveBindingType,
    StoryProgressBindingType,
    StoryStyleType,
    type StoryStyle,
    type StoryProgressOptions,
    type StoryLayoutLiteral,
    type StoryStepLengthLiteral,
} from "./types.js";

// Re-export types
export {
    StoryLayoutType,
    StoryLayout,
    StoryStepLengthType,
    StoryStepLength,
    StoryActiveBindingType,
    StoryProgressBindingType,
    StoryStyleType,
    type StoryLayoutLiteral,
    type StoryStepLengthLiteral,
    type StoryStyle,
    type StoryProgressOptions,
} from "./types.js";

// ============================================================================
// StoryStepType — standalone mirror of the inline `StoryStep` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `StoryStep` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @remarks
 * One narrative beat: spine node · eyebrow (`index / total · label`) ·
 * title · body. The body is the step's children — any east-ui subtree —
 * and fills the step's full scroll runway. The optional `stage` is the
 * keyframe shown in the sticky slot while this step is active; a step
 * without one holds the previous keyframe (the natural shape for two beats
 * narrating the same visual).
 *
 * @property id - Step identifier, used for deep links, snapshot names, and
 *   the `activeStep` static override
 * @property eyebrow - Short label after the `index / total` prefix
 * @property title - Step heading (DM Sans 17px/600)
 * @property stage - Keyframe rendered in the sticky stage while active
 * @property body - Rail content (the step's children)
 */
export const StoryStepType: StructType<{
    id: StringType,
    eyebrow: OptionType<StringType>,
    title: OptionType<StringType>,
    stage: OptionType<UIComponentType>,
    body: ArrayType<UIComponentType>,
}> = StructType({
    id: StringType,
    eyebrow: OptionType(StringType),
    title: OptionType(StringType),
    stage: OptionType(UIComponentType),
    body: ArrayType(UIComponentType),
});

/**
 * Type representing the StoryStep structure.
 */
export type StoryStepType = typeof StoryStepType;

// ============================================================================
// StoryType — standalone mirror of the inline `Story` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `Story` variant in `component.ts`.
 *
 * @property steps - Children; expected to be `StoryStep` values (soft
 *   contract, like ChipRail's chip-shaped children — the renderer skips
 *   non-step children with a dev warning)
 * @property active - Optional narrative-position binding (Integer
 *   read/write closures, the `State.bind` struct)
 * @property progress - Optional within-step scrub binding (Float 0–1)
 * @property activeStep - Static override: renders one deterministic
 *   keyframe by step id (snapshot pipeline / deep links)
 * @property title - When present, the one-row `Story.Progress` chrome is
 *   rendered sticky above the story with this eyebrow title
 * @property onStepEnter - Fired with the step id on activation (either
 *   scroll direction)
 * @property onStepExit - Fired with the step id on deactivation
 * @property style - Visual-presentation sub-struct
 */
export const StoryType: StructType<{
    steps: ArrayType<UIComponentType>,
    active: OptionType<StoryActiveBindingType>,
    progress: OptionType<StoryProgressBindingType>,
    activeStep: OptionType<StringType>,
    title: OptionType<StringType>,
    onStepEnter: OptionType<FunctionType<[StringType], NullType>>,
    onStepExit: OptionType<FunctionType<[StringType], NullType>>,
    style: OptionType<StoryStyleType>,
}> = StructType({
    steps: ArrayType(UIComponentType),
    active: OptionType(StoryActiveBindingType),
    progress: OptionType(StoryProgressBindingType),
    activeStep: OptionType(StringType),
    title: OptionType(StringType),
    onStepEnter: OptionType(FunctionType([StringType], NullType)),
    onStepExit: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(StoryStyleType),
});

/**
 * Type representing the Story structure.
 */
export type StoryType = typeof StoryType;

// ============================================================================
// StoryProgressType — standalone mirror of the inline `StoryProgress` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `StoryProgress` variant in
 * `component.ts`.
 *
 * @remarks
 * The one-row chrome strip: eyebrow title · per-step dots · counter ·
 * prev/next. Mounts standalone anywhere (a page header, a Drawer foot)
 * because it only talks to the `active` binding.
 *
 * @property count - Total number of steps
 * @property active - Optional narrative-position binding
 * @property title - Eyebrow title at the left of the row
 */
export const StoryProgressType: StructType<{
    count: IntegerType,
    active: OptionType<StoryActiveBindingType>,
    title: OptionType<StringType>,
}> = StructType({
    count: IntegerType,
    active: OptionType(StoryActiveBindingType),
    title: OptionType(StringType),
});

/**
 * Type representing the StoryProgress structure.
 */
export type StoryProgressType = typeof StoryProgressType;

// ============================================================================
// Options Interfaces (UIComponent-bearing — must live here, not types.ts)
// ============================================================================

/**
 * TypeScript options bag for `Story.Step`.
 *
 * @remarks
 * `stage` is a UIComponent prop (the established `Dialog.trigger` shape) —
 * any east-ui subtree, usually a `Chart`, equally a `Table` or composed
 * `Card`. The stage slot is unchromed; a keyframe that wants framing
 * composes it itself.
 *
 * @property id - Step identifier (deep links / snapshots / `activeStep`)
 * @property eyebrow - Short label after the `index / total` prefix
 * @property title - Step heading
 * @property stage - Keyframe shown in the sticky stage while this step is
 *   active; omit to hold the previous keyframe
 */
export interface StoryStepOptions {
    /** Step identifier (deep links / snapshots / `activeStep`) */
    id: SubtypeExprOrValue<StringType>;
    /** Short label after the `index / total` prefix */
    eyebrow?: SubtypeExprOrValue<StringType>;
    /** Step heading */
    title?: SubtypeExprOrValue<StringType>;
    /** Keyframe shown in the sticky stage while this step is active */
    stage?: SubtypeExprOrValue<UIComponentType>;
}

/**
 * TypeScript options bag for `Story.Root`.
 *
 * @remarks
 * State (`active` / `progress` / `activeStep`), behaviour (`onStepEnter` /
 * `onStepExit`), and the visual style fields (inherited from
 * {@link StoryStyle}) all sit in one flat bag; the factory composes the
 * nested IR style sub-struct. Omit `active` / `progress` and Story manages
 * its position internally — the component is fully usable with zero wiring.
 *
 * @property active - Narrative-position binding (`State.bind` struct)
 * @property progress - Within-step scrub binding (Float 0–1)
 * @property activeStep - Static override: render one deterministic keyframe
 * @property title - Render the `Story.Progress` chrome row with this title
 * @property onStepEnter - Fired with the step id on activation
 * @property onStepExit - Fired with the step id on deactivation
 */
export interface StoryOptions extends StoryStyle {
    /** Narrative-position binding (`State.bind([IntegerType], …)` struct) */
    active?: SubtypeExprOrValue<StoryActiveBindingType>;
    /** Within-step scrub binding (`State.bind([FloatType], …)` struct) */
    progress?: SubtypeExprOrValue<StoryProgressBindingType>;
    /** Static override: render one deterministic keyframe by step id */
    activeStep?: SubtypeExprOrValue<StringType>;
    /** Render the `Story.Progress` chrome row with this title */
    title?: SubtypeExprOrValue<StringType>;
    /** Fired with the step id on activation (either scroll direction) */
    onStepEnter?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Fired with the step id on deactivation */
    onStepExit?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

// ============================================================================
// Story Step Factory
// ============================================================================

/**
 * Creates a Story step — one narrative beat in the rail.
 *
 * @param body - Rail content (any east-ui subtree); fills the step's full
 *   scroll runway
 * @param options - `id` (required) plus `eyebrow` / `title` / `stage`
 * @returns An East expression representing the StoryStep component
 *
 * @remarks
 * Steps are real components (a `UIComponentType` variant arm), so a
 * conditional step (`cond.ifElse(stepA, stepB)`) is legal. One idea per
 * step: a body that needs a scrollbar is two steps.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Story, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const step = East.function([], UIComponentType, _$ =>
 *     Story.Step([
 *         Text.Root("Orders climbed from week 6 and never gave the gain back."),
 *     ], { id: "demand", eyebrow: "Demand", title: "Demand ran hot" }),
 * );
 * ```
 */
function createStoryStep(
    body: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options: StoryStepOptions,
): ExprType<UIComponentType> {
    // Cast at variant boundary — the inline `StoryStep` variant in
    // component.ts uses the recursive `node` for stage/body, structurally
    // identical to `UIComponentType` after unfolding but not provably
    // equal to TS.
    return East.value(variant("StoryStep", {
        id: options.id,
        eyebrow: options.eyebrow !== undefined ? some(options.eyebrow) : none,
        title: options.title !== undefined ? some(options.title) : none,
        stage: options.stage !== undefined ? some(options.stage as never) : none,
        body: body as never,
    }), UIComponentType);
}

// ============================================================================
// Story Root Factory
// ============================================================================

/**
 * Creates a Story — a scroll-driven narrative with a prose rail and a
 * sticky stage (design/story.html §2.7 Narrate).
 *
 * @param steps - The narrative beats, built with `Story.Step` (soft
 *   contract — non-step children are skipped with a dev warning)
 * @param options - State + behaviour + visual style fields
 * @returns An East expression representing the Story component
 *
 * @remarks
 * Scroll drives the active step; the active step drives the stage
 * keyframe. The component observes native scroll and never hijacks it;
 * the single sanctioned programmatic scroll is navigation (a step/dot
 * click or an external `active` write smooth-scrolls that step to the
 * trigger line). The position is one ordinary state binding — omit
 * `active` and Story keeps it internal.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Story, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const review = East.function([], UIComponentType, _$ =>
 *     Story.Root([
 *         Story.Step([Text.Root("Orders climbed steadily from week 6.")],
 *             { id: "demand", eyebrow: "Demand", title: "Demand ran hot",
 *               stage: Text.Root("kf 1") }),
 *         Story.Step([Text.Root("The committed forecast kept its old slope.")],
 *             { id: "forecast", eyebrow: "Forecast", title: "The plan missed the turn",
 *               stage: Text.Root("kf 2") }),
 *     ], { title: "Q4 demand review", stageHeight: 420, stepLength: "default" }),
 * );
 * ```
 */
function createStoryRoot(
    steps: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: StoryOptions,
): ExprType<UIComponentType> {
    const { active, progress, activeStep, title, onStepEnter, onStepExit, ...visual } = options ?? {};

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildStoryStyle(visual) : undefined;

    return East.value(variant("Story", {
        steps: steps as never,
        active: active !== undefined ? some(active) : none,
        progress: progress !== undefined ? some(progress) : none,
        activeStep: activeStep !== undefined ? some(activeStep) : none,
        title: title !== undefined ? some(title) : none,
        onStepEnter: onStepEnter ? some(onStepEnter) : none,
        onStepExit: onStepExit ? some(onStepExit) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildStoryStyle(style: StoryStyle): ExprType<StoryStyleType> {
    const layoutValue = style.layout
        ? (typeof style.layout === "string"
            ? East.value(variant(style.layout as StoryLayoutLiteral, null), StoryLayoutType)
            : style.layout)
        : undefined;

    const stepLengthValue = style.stepLength
        ? (typeof style.stepLength === "string"
            ? East.value(variant(style.stepLength as StoryStepLengthLiteral, null), StoryStepLengthType)
            : style.stepLength)
        : undefined;

    const stageHeightValue = style.stageHeight !== undefined
        ? (typeof style.stageHeight === "number"
            ? `${Math.round(style.stageHeight)}px`
            : style.stageHeight)
        : undefined;

    const heightValue = style.height !== undefined
        ? (typeof style.height === "number"
            ? `${Math.round(style.height)}px`
            : style.height)
        : undefined;

    return East.value({
        layout: layoutValue ? some(layoutValue) : none,
        stageHeight: stageHeightValue !== undefined ? some(stageHeightValue) : none,
        stepLength: stepLengthValue ? some(stepLengthValue) : none,
        height: heightValue !== undefined ? some(heightValue) : none,
    }, StoryStyleType);
}

// ============================================================================
// Story Progress Factory
// ============================================================================

/**
 * Creates the Story.Progress chrome strip: eyebrow title · per-step dots ·
 * counter · prev/next.
 *
 * @param options - `count` (required) plus the `active` binding and `title`
 * @returns An East expression representing the StoryProgress component
 *
 * @remarks
 * Mounts standalone anywhere because it shares nothing with the Story but
 * the binding: dots and prev/next simply write `active`, and the Story's
 * rail treats the write as navigation. Inside `Story.Root` the chrome is
 * rendered automatically when the story's `title` option is set.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Story, UIComponentType } from "@elaraai/east-ui";
 *
 * const chrome = East.function([], UIComponentType, _$ =>
 *     Story.Progress({ count: 4, title: "Q4 demand review" }),
 * );
 * ```
 */
function createStoryProgress(
    options: StoryProgressOptions,
): ExprType<UIComponentType> {
    const countValue = typeof options.count === "number"
        ? BigInt(Math.round(options.count))
        : options.count;

    return East.value(variant("StoryProgress", {
        count: countValue,
        active: options.active !== undefined ? some(options.active) : none,
        title: options.title !== undefined ? some(options.title) : none,
    }), UIComponentType);
}

// ============================================================================
// Story Compound Namespace
// ============================================================================

/**
 * Story compound primitive for scroll-driven narratives — one persistent
 * visual (the stage) evolving through keyframes while prose steps scroll
 * past in a rail beside it. The reader's scrollbar is the timeline.
 *
 * @remarks
 * Use `Story.Root(steps, options)` for the container, `Story.Step(body,
 * { id, … })` for each beat, and `Story.Progress(options)` for standalone
 * chrome. Reach for Story only when the *sequence* of readings carries the
 * argument; random-access beats are Tabs, equal-weight siblings with no
 * shared visual are a Carousel.
 */
export const Story = {
    /**
     * Creates a Story container.
     *
     * @param steps - The narrative beats, built with `Story.Step`
     * @param options - State + behaviour + visual style fields
     * @returns An East expression representing the Story component
     *
     * @remarks
     * See {@link createStoryRoot} for full semantics. `active` / `progress`
     * / `activeStep` (state) and `onStepEnter` / `onStepExit` (behaviour)
     * sit alongside the visual style fields in one flat bag.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Story, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Story.Root([
     *         Story.Step([Text.Root("Beat one.")], { id: "one", title: "One" }),
     *         Story.Step([Text.Root("Beat two.")], { id: "two", title: "Two" }),
     *     ], { stageHeight: 420 }),
     * );
     * ```
     */
    Root: createStoryRoot,
    /**
     * Creates a Story step.
     *
     * @param body - Rail content (any east-ui subtree)
     * @param options - `id` (required) plus `eyebrow` / `title` / `stage`
     * @returns An East expression representing the StoryStep component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Story, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Story.Step([Text.Root("Orders climbed steadily.")],
     *         { id: "demand", eyebrow: "Demand", title: "Demand ran hot" }),
     * );
     * ```
     */
    Step: createStoryStep,
    /**
     * Creates the standalone Story.Progress chrome strip.
     *
     * @param options - `count` (required) plus `active` binding and `title`
     * @returns An East expression representing the StoryProgress component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Story, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     Story.Progress({ count: 4, title: "Q4 demand review" }),
     * );
     * ```
     */
    Progress: createStoryProgress,
    /**
     * Helper for creating story layout values.
     *
     * @param v - The layout string
     * @returns An East expression representing the layout
     */
    Layout: StoryLayout,
    Types: {
        /**
         * The concrete East type for the Story container — mirrors the
         * inline `Story` variant in `component.ts`.
         */
        Story: StoryType,
        /**
         * The concrete East type for a Story step.
         */
        Step: StoryStepType,
        /**
         * The concrete East type for the Story.Progress chrome.
         */
        Progress: StoryProgressType,
        /**
         * Visual-only style struct for Story. See {@link StoryStyleType}.
         */
        Style: StoryStyleType,
        /**
         * Layout enum (rail-left / rail-right / stacked).
         */
        Layout: StoryLayoutType,
        /**
         * Step runway enum (compact / default / long).
         */
        StepLength: StoryStepLengthType,
        /**
         * Narrative-position binding struct (Integer read/write closures).
         */
        ActiveBinding: StoryActiveBindingType,
        /**
         * Within-step scrub binding struct (Float read/write closures).
         */
        ProgressBinding: StoryProgressBindingType,
    },
} as const;
