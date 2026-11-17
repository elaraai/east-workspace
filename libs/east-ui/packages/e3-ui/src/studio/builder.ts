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
 * listed components, the project, the page it shows, and the preview's words
 * — which the `StudioBuilder` renderer draws. Its parts are the renderer's:
 * the palette (#994), the canvas (#995), the inspector (#996) and the publish
 * preview (#998), each computed in East by this package and drawn in the
 * browser. Its host says which page it shows (`page`) and is told when its
 * palette asks for another (`onOpen`): nothing opens a page in it through a
 * store entry shared by `id` (#1668).
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
import { StudioKeyType, StudioPagesHandleType, type StudioPagesHandle } from "./pages.js";

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
 * @property id - Names the builder, when a surface holds two: its palette's drag sources
 * @property page - The page it shows; `none`, the builder holds its own open page, the project's first to begin with
 * @property onOpen - Told when its palette's Pages tab asks for another page, with its key
 */
export const StudioBuilderPayloadType = StructType({
    pages: StudioPagesHandleType,
    components: ArrayType(StudioComponentType),
    project: StringType,
    env: OptionType(StringType),
    audience: OptionType(StringType),
    rollout: OptionType(StringType),
    id: OptionType(StringType),
    page: OptionType(StudioKeyType),
    onOpen: OptionType(FunctionType([StudioKeyType], NullType)),
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
 * @property pages - The pages record, bound with its patch mutation — `Record.bind(pages)`
 * @property components - The components the surface lists, in palette order
 * @property project - The project whose pages the builder opens
 * @property env - Where the publish preview publishes to — its Env pill, and "Publish vN to <env>"
 * @property audience - Who sees a published page — the preview's Audience row
 * @property rollout - When they see it — the preview's Rollout row
 * @property id - Names the builder, when a surface holds two: its palette's drag sources
 * @property page - The page it shows — a route's params, or the surface's own state
 * @property onOpen - Told when its palette's Pages tab asks for another page, with its key
 */
export interface StudioBuilderOptions {
    /** The pages record, bound with its patch mutation — `Record.bind(pages)`. */
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
    /** Names the builder — needed only when one surface holds two builders, whose palettes' drag sources it tells apart. */
    id?: string;
    /**
     * The page it shows: a route's params, or the surface's own state. Given,
     * the builder shows this page until its host changes it, so `onOpen` is
     * given with it. Omitted, the builder holds its own open page — the
     * project's first to begin with — and its palette's Pages tab opens
     * another in it.
     */
    page?: SubtypeExprOrValue<StudioKeyType>;
    /**
     * Told when its palette's Pages tab asks for another page, with its key.
     * A host that gives `page` changes it here — to navigate, or to write its
     * own state; one that gives none hears of the page the builder opened.
     */
    onOpen?: SubtypeExprOrValue<FunctionType<[StudioKeyType], NullType>>;
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
 * Its host says which page it shows and is told when its palette asks for
 * another, so a `<Studio.Library>` opens a page in it through the host: the
 * library's `onOpen` and the builder's `page` are the host's to join, on one
 * surface or across routes.
 *
 * @param options - The bound record, the listed components, the project, the page it shows and the preview's words ({@link StudioBuilderOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `page` is given without `onOpen`: its palette's Pages tab could open nothing
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, State, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * // The builder, for operators: it reads the pages and writes their patch.
 * // The surface holds the open page, which a page library beside it shares.
 * export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const pages      = $.let(Record.bind(d.pages));
 *         const open       = $.let(State.bind([Studio.Types.Key], "studio.open", { project: "Ops console", page: "Overview" }));
 *         const go         = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
 *         return <Studio.Builder pages={pages} components={components} project="Ops console"
 *             page={open.read()} onOpen={go}
 *             env="Staging" audience="Field ops · 24 users" rollout="Immediate" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createBuilder(options: StudioBuilderOptions): ExprType<UIComponentType> {
    if (options.page !== undefined && options.onOpen === undefined) {
        throw new Error("Studio.Builder: `page` is given, so its host holds the open page — give `onOpen` too, which is told the page its palette's Pages tab asks for; or omit `page`, and the builder holds its own");
    }
    return StudioBuilderComponent.Root({
        pages: { read: options.pages.read, history: options.pages.history, commit: { patch: options.pages.commit.patch } },
        components: options.components,
        project: options.project,
        env: options.env === undefined ? none : some(options.env),
        audience: options.audience === undefined ? none : some(options.audience),
        rollout: options.rollout === undefined ? none : some(options.rollout),
        id: options.id === undefined ? none : some(options.id),
        page: options.page === undefined ? none : some(options.page),
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
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
