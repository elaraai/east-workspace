/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Page>` (#993) — a page as operators see it. It reads the pages
 * record's value and never writes it.
 *
 * The page is an interface — the record's value, the listed components, the
 * page's key and which of its layouts to draw — and the `StudioPage` renderer
 * draws it: the layout's placements on the snap grid, each its component's own
 * UI, so a surface's `ui()` task holds every listed component's reads. A
 * solution places it where it wants, in a layout of its own.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    NullType,
    StructType,
    VariantType,
    variant,
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
import { StudioKeyType, StudioPagesType } from "./pages.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Which layout of a page to draw.
 *
 * @property live - The published version — what a published page shows
 * @property draft - The layout as last saved — what the builder edits
 */
export const StudioVersionType = VariantType({
    live: NullType,
    draft: NullType,
});

/** Type representing which layout of a page to draw. */
export type StudioVersionType = typeof StudioVersionType;

/** Literal shorthand for {@link StudioVersionType}. */
export type StudioVersionLiteral = "live" | "draft";

/**
 * The `StudioPage` renderer's payload — one page, to draw.
 *
 * @property pages - The pages record's value
 * @property components - The components the surface lists
 * @property page - The page's key
 * @property version - Which of its layouts to draw
 */
export const StudioPagePayloadType = StructType({
    pages: StudioPagesType,
    components: ArrayType(StudioComponentType),
    page: StudioKeyType,
    version: StudioVersionType,
});

/** Type representing the `StudioPage` renderer's payload. */
export type StudioPagePayloadType = typeof StudioPagePayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioPageComponent = EastUI.component("StudioPage", StudioPagePayloadType, { optional: true });

// ============================================================================
// <Studio.Page>
// ============================================================================

/**
 * `<Studio.Page>` options.
 *
 * @property pages - The pages record's value — `Data.bind(pages).read()`
 * @property components - The components the surface lists
 * @property page - The page's key
 * @property version - `"live"` (the default) or `"draft"`
 */
export interface StudioPageOptions {
    /** The pages record's value — `Data.bind(pages).read()`, or a bound record's `read()`. */
    pages: SubtypeExprOrValue<StudioPagesType>;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The page's key. */
    page: SubtypeExprOrValue<StudioKeyType>;
    /** Which layout: the published one (`"live"`, the default), or the draft. */
    version?: StudioVersionLiteral | SubtypeExprOrValue<StudioVersionType>;
}

/**
 * Draws one page with no chrome: its live or draft layout on the snap grid,
 * each placement its component's own UI.
 *
 * @remarks
 * A component renders the same way here and in the builder: a frameless one
 * (`frame: "none"`) is bare, and a tile's label is its title or its
 * component's name. Two placements of one component share its State and Slice
 * keys. A placement whose component the surface does not list is a
 * placeholder naming its key. A page the record does not hold, or a live
 * version not yet published, is a placeholder that says so. Under a narrow
 * container the tiles stack in row order. The page draws no border around
 * itself.
 *
 * @param options - The record's value, the listed components, the page and
 *   its version ({@link StudioPageOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Studio, ui } from "@elaraai/e3-ui";
 *
 * // The published Overview page, for everyone else: it only reads the pages.
 * export const opsConsole = ui("ops_console", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const all        = $.let(Data.bind(pages));
 *         return <Studio.Page pages={all.read()} components={components}
 *             page={{ project: "Ops console", page: "Overview" }} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createPage(options: StudioPageOptions): ExprType<UIComponentType> {
    const version = options.version ?? "live";
    return StudioPageComponent.Root({
        pages: options.pages,
        components: options.components,
        page: options.page,
        version: typeof version === "string" ? variant(version, null) : version,
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Page>` — one page with no chrome, its live or draft layout on the
 * snap grid. See {@link createPage}.
 */
export const StudioPage: JsxTag<OptionsProps<typeof createPage>> = optionsTag(createPage);
