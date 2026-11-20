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
    FunctionType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    none,
    some,
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
import { StudioSourceType, studioSources, type StudioSourceDeclaration } from "./source.js";

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
 * @property sources - The sources its visuals read, in the order listed; none when the surface lists none
 * @property page - The page's key
 * @property version - Which of its layouts to draw
 * @property onOpen - Told the key of the page a click on one of its visuals opens; `none`, such a click opens nothing
 */
export const StudioPagePayloadType = StructType({
    pages: StudioPagesType,
    components: ArrayType(StudioComponentType),
    sources: ArrayType(StudioSourceType),
    page: StudioKeyType,
    version: StudioVersionType,
    onOpen: OptionType(FunctionType([StudioKeyType], NullType)),
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
 * @property sources - The sources its visuals read, by the names their queries read them by
 * @property page - The page's key
 * @property version - `"live"` (the default) or `"draft"`
 * @property onOpen - Told the key of the page a click on one of its visuals opens
 */
export interface StudioPageOptions {
    /** The pages record's value — `Data.bind(pages).read()`, or a bound record's `read()`. */
    pages: SubtypeExprOrValue<StudioPagesType>;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The sources its visuals read: each name to its `Studio.source(handle, meta)`, as its builder is given them. Omitted, the surface lists none, and a visual on the page says so. */
    sources?: Readonly<Record<string, StudioSourceDeclaration>>;
    /** The page's key. */
    page: SubtypeExprOrValue<StudioKeyType>;
    /** Which layout: the published one (`"live"`, the default), or the draft. */
    version?: StudioVersionLiteral | SubtypeExprOrValue<StudioVersionType>;
    /**
     * Told the key of the page a click on one of its visuals opens — a visual
     * whose click is `open`. The clicked group is already among the target
     * page's filters when it is told — its reader's, or its starting filters
     * where its reader holds none of it — so the host only shows the page: it
     * navigates, or writes the state its `page` reads. Omitted, such a click
     * opens nothing.
     */
    onOpen?: SubtypeExprOrValue<FunctionType<[StudioKeyType], NullType>>;
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
 * placeholder naming its key. A text block draws with no frame: its heading
 * over its paragraphs. A visual draws in a tile naming its view and its
 * source. A page the record does not hold, or a live
 * version not yet published, is a placeholder that says so. Under a narrow
 * container the tiles stack in row order. The page draws no border around
 * itself.
 *
 * Over its grid the page draws its reader's filters, when its visuals read a
 * source: each a chip, which narrows every visual of its source. A reader
 * starts with the page's starting filters — its layout's `filters` (#1673) —
 * as chips of their own to change or clear; filters they cleared stay
 * cleared. A click on a visual does what the visual says: it selects the
 * clicked group, which a visual that follows it narrows to; it adds the group
 * to the page's filters; or it opens another page narrowed to the group,
 * telling `onOpen` that page's key.
 *
 * @param options - The record's value, the listed components, the page and
 *   its version ({@link StudioPageOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When a source's key, rows or fields do not fit ({@link studioSources})
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
        sources: studioSources("Studio.Page", options.sources),
        page: options.page,
        version: typeof version === "string" ? variant(version, null) : version,
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
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
