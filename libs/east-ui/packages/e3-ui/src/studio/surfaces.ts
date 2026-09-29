/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's read surfaces (#993) — a page as operators see it, and a
 * project's published site. Both read the pages record's value and never
 * write it.
 *
 * `<Studio.Page>` draws one page's layout on the SnapGrid, each placement its
 * component's own UI ({@link dispatchComponent}), so a surface's `ui()` task
 * holds every listed component's reads. `<Studio.Site>` is a project's
 * published app: an `<App>` whose rail lists the project's live pages in key
 * order, with the open page as its body.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    App,
    Breadcrumb,
    EmptyState,
    NavList,
    Navigation,
    Reactive,
    SnapGrid,
    Text,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import { StudioComponentType, dispatchComponent } from "./component.js";
import { StudioKeyType, StudioPageType, StudioPagesType } from "./pages.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Which layout of a page to draw.
 *
 * @property live - The published version — what the site shows
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

/** A live page of a project, as the site's rail lists it. */
const LivePageType = StructType({ key: StudioKeyType, title: StringType });

/** A listed component, as a tile draws it: framed or bare, and its name. */
const TileMetaType = StructType({ frame: StudioComponentType.fields.frame, name: StringType });

// ============================================================================
// <Studio.Page>
// ============================================================================

/**
 * One page's layout, drawn: its cells on the SnapGrid, each placement its
 * component's UI. A page the record does not hold, or a live version not yet
 * published, is a placeholder that says so.
 */
const renderPage = East.function(
    [StudioPagesType, ArrayType(StudioComponentType), StudioKeyType, StudioVersionType],
    UIComponentType,
    ($, pages, components, key, version) => {
        const layout = $.let(none, OptionType(StudioPageType));
        const published = $.let(true);
        $.match(pages.tryGet(key), {
            some: ($2, entry) => {
                $2.match(entry, {
                    page: ($3, page) => {
                        $3.match(version, {
                            draft: ($4) => { $4.assign(layout, some(page.draft)); },
                            live: ($4) => {
                                $4.match(page.live, {
                                    some: ($5, live) => { $5.assign(layout, some(live.page)); },
                                    none: ($5) => { $5.assign(published, false); },
                                });
                            },
                        });
                    },
                    template: ($3, template) => { $3.assign(layout, some(template)); },
                });
            },
        });
        $.if(published.not(), ($2) => {
            $2.return(EmptyState.Root({
                title: Text.Root(East.str`${key.page} is not published yet`),
                description: "Publish it to show it here.",
                icon: { prefix: "fas", name: "file-circle-question" },
            }));
        });
        $.if(layout.hasTag("none"), ($2) => {
            $2.return(EmptyState.Root({
                title: Text.Root(East.str`No page ${key.page}`),
                description: Text.Root(East.str`The project ${key.project} has no page by this name.`),
                icon: { prefix: "fas", name: "file-circle-question" },
            }));
        });
        const cells = $.let(layout.unwrap("some").cells);
        const tiles = $.let(components.toDict(
            (_$2, component) => component.key,
            (_$2, component) => ({ frame: component.frame, name: component.name }),
            (_$2, first) => first,
        ), DictType(StringType, TileMetaType));
        return SnapGrid.Root(cells, {
            cell: (cell) => SnapGrid.cell({
                key: cell.key,
                row: cell.row,
                span: cell.span,
                height: cell.height,
                align: cell.align,
                // A frameless component renders bare; one the surface does not
                // list is its placeholder, in a tile.
                frame: tiles.tryGet(cell.component).match({
                    some: (_$2, tile) => tile.frame.hasTag("card"),
                    none: (_$2) => East.value(true),
                }),
                label: cell.title.match({
                    some: (_$2, title) => some(title),
                    none: (_$2) => tiles.tryGet(cell.component).match({
                        some: (_$3, tile) => some(tile.name),
                        none: (_$3) => East.value(none, OptionType(StringType)),
                    }),
                }),
                content: dispatchComponent(components, cell.component),
            }),
        });
    },
);

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
 * Draws one page with no chrome: its live or draft layout on the SnapGrid,
 * each placement its component's own UI.
 *
 * @remarks
 * A component renders the same way here and in the builder: a frameless one
 * (`frame: "none"`) is bare, and a tile's label is its title or its
 * component's name. Two placements of one component share its State and Slice
 * keys. Under a narrow container the tiles stack in row order.
 *
 * @param options - The record's value, the listed components, the page and
 *   its version ({@link StudioPageOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East, UIComponentType } from "@elaraai/east";
 * import { Reactive } from "@elaraai/east-ui";
 * import { Data, Studio } from "@elaraai/e3-ui";
 *
 * <Reactive>{$ => {
 *     const components = $.let([kpiRail, revenueTrend]);
 *     const all        = $.let(Data.bind(pages));
 *     return <Studio.Page pages={all.read()} components={components}
 *         page={{ project: "ops", page: "overview" }} version="draft" />;
 * }}</Reactive>
 * ```
 */
function createPage(options: StudioPageOptions): ExprType<UIComponentType> {
    const version = options.version ?? "live";
    return renderPage(
        East.value(options.pages, StudioPagesType),
        East.value(options.components, ArrayType(StudioComponentType)),
        East.value(options.page, StudioKeyType),
        typeof version === "string" ? East.value(variant(version, null), StudioVersionType) : East.value(version, StudioVersionType),
    );
}

// ============================================================================
// <Studio.Site>
// ============================================================================

/**
 * `<Studio.Site>` options.
 *
 * @property pages - The pages record's value — `Data.bind(pages).read()`
 * @property components - The components the surface lists
 * @property project - The project whose live pages the site shows
 * @property title - The app bar's title; the project when omitted
 * @property id - Names the site's navigation state, when a surface holds two sites
 */
export interface StudioSiteOptions {
    /** The pages record's value — `Data.bind(pages).read()`. */
    pages: SubtypeExprOrValue<StudioPagesType>;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose live pages the site shows. */
    project: SubtypeExprOrValue<StringType>;
    /** The app bar's title; the project when omitted. */
    title?: SubtypeExprOrValue<StringType>;
    /** Names the site's navigation state — needed only when one surface holds two sites. */
    id?: string;
}

/**
 * A project's published site: an `<App>` whose rail lists the project's live
 * pages in key order, with the open page's live version as its body.
 *
 * @remarks
 * A page with no live version, and every template, is not in the rail. The
 * breadcrumb names the open page. The site reads the record and never writes
 * it, so its surface's manifest holds the record's path and no write.
 *
 * @param options - The record's value, the listed components and the project
 *   ({@link StudioSiteOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East, UIComponentType } from "@elaraai/east";
 * import { Reactive } from "@elaraai/east-ui";
 * import { Data, Studio, ui } from "@elaraai/e3-ui";
 *
 * export const opsConsole = ui("ops_console", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const all        = $.let(Data.bind(pages));
 *         return <Studio.Site pages={all.read()} components={components} project="ops" title="Ops console" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createSite(options: StudioSiteOptions): ExprType<UIComponentType> {
    const routes = Navigation.config({ page: { value: StudioKeyType, label: "Page" } });
    const navKey = options.id === undefined ? "studio.site" : `studio.site.${options.id}`;
    const pagesValue = East.value(options.pages, StudioPagesType);
    const componentsValue = East.value(options.components, ArrayType(StudioComponentType));
    const projectValue = East.value(options.project, StringType);
    const titleValue = options.title === undefined ? projectValue : East.value(options.title, StringType);
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const pages = $.let(pagesValue);
        const components = $.let(componentsValue);
        const project = $.let(projectValue);
        // The project's live pages, in key order.
        const live = $.let([], ArrayType(LivePageType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project), ($3) => {
                $3.match(entry, {
                    page: ($4, page) => {
                        $4.match(page.live, {
                            some: ($5, version) => { $5(live.pushLast({ key, title: version.page.title })); },
                        });
                    },
                });
            });
        });
        const first = $.let(live.size().equal(0n).ifElse(
            () => East.value({ project, page: "" }, StudioKeyType),
            () => live.get(0n).key,
        ));
        const nav = $.let(Navigation.bind(routes, navKey, [variant("page", first)]));
        const open = $.let(nav.current().match({ page: (_$2, key) => key }));
        const select = $.const(East.function([StringType], NullType, ($2, name) => {
            $2(nav.navigateTo([variant("page", { project, page: name })]));
        }));
        const sections = $.let([{
            label: none,
            items: live.map((_$2, page) => East.value({
                key: page.key.page,
                label: page.title,
                icon: none,
                badge: none,
                active: some(East.equal(page.key, open)),
            }, NavList.Types.Item)),
        }], ArrayType(NavList.Types.Section));
        const crumbs = $.let(live
            .filter((_$2, page) => East.equal(page.key, open))
            .map((_$2, page) => East.value({ label: page.title, current: some(true), onClick: none }, Breadcrumb.Types.Item)));
        return App.Root({
            nav,
            config: routes,
            title: titleValue,
            rail: NavList.Root(sections, { surface: "shell", onSelect: select }),
            breadcrumb: Breadcrumb.Root(crumbs, { leadingSeparator: true }),
            pages: {
                page: (_$2, key) => key.page.equal("").ifElse(
                    () => EmptyState.Root({
                        title: Text.Root("Nothing is published yet"),
                        description: Text.Root(East.str`Publish a page of ${project} to show it here.`),
                        icon: { prefix: "fas", name: "file-circle-question" },
                    }),
                    () => createPage({ pages, components, page: key, version: "live" }),
                ),
            },
        });
    }));
}

// ============================================================================
// Tags
// ============================================================================

/**
 * `<Studio.Page>` — one page with no chrome, its live or draft layout on the
 * SnapGrid. See {@link createPage}.
 */
export const StudioPage: JsxTag<OptionsProps<typeof createPage>> = optionsTag(createPage);

/**
 * `<Studio.Site>` — a project's published site: an `<App>` over its live
 * pages. See {@link createSite}.
 */
export const StudioSite: JsxTag<OptionsProps<typeof createSite>> = optionsTag(createSite);
