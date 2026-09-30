/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Builder>` (#1000) — the builder as one component: the open page's
 * canvas under its one toolbar, the palette before it and the inspector after
 * it, and the publish preview, which Preview and Publish open in the canvas's
 * place.
 *
 * The builder is an interface — the pages record bound with its patch, the
 * listed components, the project, and the preview's words — which the
 * `StudioBuilder` renderer draws. Its parts are the renderer's: the palette
 * (#994), the canvas (#995), the inspector (#996) and the publish preview
 * (#998), each computed in East by this package and drawn in the browser.
 * `<Studio.Library>` opens pages in it, shared by `id`.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { StudioComponentType } from "./component.js";
import { StudioPagesHandleType, type StudioPagesHandle } from "./pages.js";

// ============================================================================
// The renderer's payload
// ============================================================================

/**
 * The `StudioBuilder` renderer's payload — the builder's interface.
 *
 * @property pages - The pages record, bound with its patch — what the builder reads, and saves and publishes through
 * @property components - The components the surface lists, in palette order
 * @property project - The project whose pages the builder opens
 * @property env - Where the publish preview publishes to — its Env pill, and "Publish vN to <env>"
 * @property audience - Who sees a published page — the preview's Audience row
 * @property rollout - When they see it — the preview's Rollout row
 * @property id - Names the builder, when a surface holds two — and the page library that opens its pages
 */
export const StudioBuilderPayloadType = StructType({
    pages: StudioPagesHandleType,
    components: ArrayType(StudioComponentType),
    project: StringType,
    env: OptionType(StringType),
    audience: OptionType(StringType),
    rollout: OptionType(StringType),
    id: OptionType(StringType),
});

/** Type representing the `StudioBuilder` renderer's payload. */
export type StudioBuilderPayloadType = typeof StudioBuilderPayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioBuilderComponent = EastUI.component("StudioBuilder", StudioBuilderPayloadType, { optional: true });

// ============================================================================
// <Studio.Builder>
// ============================================================================

/**
 * `<Studio.Builder>` options.
 *
 * @property pages - The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`
 * @property components - The components the surface lists, in palette order
 * @property project - The project whose pages the builder opens
 * @property env - Where the publish preview publishes to — its Env pill, and "Publish vN to <env>"
 * @property audience - Who sees a published page — the preview's Audience row
 * @property rollout - When they see it — the preview's Rollout row
 * @property id - Names the builder, when a surface holds two — and the page library that opens its pages
 */
export interface StudioBuilderOptions {
    /** The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`. */
    pages: StudioPagesHandle;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose pages the builder opens. */
    project: SubtypeExprOrValue<StringType>;
    /** Where the publish preview publishes to — its Env pill, and "Publish vN to <env>"; omitted, neither names one. */
    env?: SubtypeExprOrValue<StringType>;
    /** Who sees a published page — the preview's Audience row; omitted, no row. */
    audience?: SubtypeExprOrValue<StringType>;
    /** When they see it — the preview's Rollout row; omitted, no row. */
    rollout?: SubtypeExprOrValue<StringType>;
    /** Names the builder — needed only when one surface holds two builders, and then given to the page library that opens its pages. */
    id?: string;
}

/**
 * The builder: the open page's canvas, with the palette and the inspector
 * beside it, and the publish preview.
 *
 * @remarks
 * - **The canvas** is the open page's grid under the builder's one toolbar —
 *   the page's status, the grid chip, the zoom, the history item, Desktop ·
 *   Tablet, Save as template, Preview and Publish. Every gesture is a draft
 *   the history item undoes, and Apply saves the page as one patch commit.
 * - **The palette**, before the canvas, is its component library: the listed
 *   components by category, each naming what it reads, dragged onto the grid;
 *   and the project's pages, a click opening one.
 * - **The inspector**, after it, is the selected placement: its component,
 *   what it reads, its description, and its span, row, height and alignment.
 * - **Preview** and **Publish** open the publish preview in the canvas's
 *   place, full-bleed — the open page as it will publish, what changed since
 *   its live version, and Save as draft and Publish; **Exit** returns to the
 *   canvas, its drafts as they were.
 *
 * The builder fills its parent's height and draws no border around itself.
 * The page open in it is shared by `id` with a `<Studio.Library>`, which
 * opens pages in it.
 *
 * @param options - The bound record, the listed components, the project and the preview's words ({@link StudioBuilderOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * // The builder, for operators: it reads the pages and writes their patch.
 * export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const pages      = $.let(Record.bind(d.pages, [d.pagesPatch]));
 *         return <Studio.Builder pages={pages} components={components} project="Ops console"
 *             env="Staging" audience="Field ops · 24 users" rollout="Immediate" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createBuilder(options: StudioBuilderOptions): ExprType<UIComponentType> {
    return StudioBuilderComponent.Root({
        pages: { read: options.pages.read, history: options.pages.history, commit: { patch: options.pages.commit.patch } },
        components: options.components,
        project: options.project,
        env: options.env === undefined ? none : some(options.env),
        audience: options.audience === undefined ? none : some(options.audience),
        rollout: options.rollout === undefined ? none : some(options.rollout),
        id: options.id === undefined ? none : some(options.id),
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Builder>` — the builder as one component: the open page's canvas,
 * the palette and the inspector beside it, and the publish preview. See
 * {@link createBuilder}.
 */
export const StudioBuilder: JsxTag<OptionsProps<typeof createBuilder>> = optionsTag(createBuilder);
