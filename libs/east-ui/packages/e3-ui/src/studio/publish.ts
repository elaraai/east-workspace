/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Publish>` (#998) — the publish preview: the open page as it will
 * publish, what changed since its live version, and the actions that publish
 * it.
 *
 * The preview is a screen of the builder, headerless, drawn by the
 * `StudioPublish` renderer: its bar — "● Preview", the device widths, the
 * environment and Exit — the page at the device's width, and the aside: what
 * changed since the live version, whether the components' code changed since,
 * who sees it and when, and Save as draft and Publish. It reads the builder's
 * shared State ({@link builderKeys}) — the open page, and its placements as
 * the canvas draws them — so the page it shows is the one that publishes,
 * unsaved drafts in place; and it asks the canvas to apply them through the
 * same State before it publishes, so the canvas stays the only writer of its
 * drafts.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    East,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
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
    EastUI,
    EmptyState,
    Reactive,
    SnapGrid,
    State,
    Text,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { StudioComponentType } from "./component.js";
import {
    StudioCellType,
    StudioChangeType,
    StudioKeyType,
    StudioLiveType,
    StudioPageType,
    StudioPages,
    StudioPagesType,
    pageChanges,
    type StudioPagesPatchType,
} from "./pages.js";
import { BuilderCellsType, builderKeys } from "./palette.js";
import { StudioVersionType, renderPage } from "./surfaces.js";

// ============================================================================
// Types
// ============================================================================

/**
 * One row of the preview's change list: the change, and the name of the
 * placement it changed.
 *
 * @property change - The change, as `Studio.changes` lists it
 * @property name - The placement's title, else its component's name, else its component's key
 */
export const PublishChangeType = StructType({
    change: StudioChangeType,
    name: StringType,
});

/** Type representing one row of the preview's change list. */
export type PublishChangeType = typeof PublishChangeType;

/**
 * Where the open entry stands, as the preview's aside says it.
 *
 * @property ready - Something to publish: a page never published, or one whose layout or components' code changed since its live version
 * @property current - Up to date: published, its layout and its components' code as they went live
 * @property template - A template, which is not published
 */
export const PublishStandingType = VariantType({
    ready: NullType,
    current: NullType,
    template: NullType,
});

/** Type representing where the open entry stands. */
export type PublishStandingType = typeof PublishStandingType;

/**
 * What the preview shows of the open entry, as East computes it.
 *
 * @property standing - Where it stands ({@link PublishStandingType})
 * @property live - Its live version's number; `none` until it is first published, and for a template
 * @property changes - The changes from its live version — from nothing, the first time — to the layout that publishes; none for a template
 * @property changed - The components it places whose code changed since its live version, by name, in the order they are placed
 * @property unsaved - The canvas draws drafts the page has not saved
 */
export const PublishSummaryType = StructType({
    standing: PublishStandingType,
    live: OptionType(IntegerType),
    changes: ArrayType(PublishChangeType),
    changed: ArrayType(StringType),
    unsaved: BooleanType,
});

/** Type representing what the preview shows of the open entry. */
export type PublishSummaryType = typeof PublishSummaryType;

/**
 * The `StudioPublish` renderer's payload.
 *
 * @property project - The project — the page's eyebrow
 * @property title - The page's title
 * @property summary - Where it stands and what changed ({@link PublishSummaryType})
 * @property env - Where it publishes to — the Env pill, and the Publish button's words
 * @property audience - Who sees it — the Audience row
 * @property rollout - When they see it — the Rollout row
 * @property page - Draws the page as it will publish
 * @property apply - The Apply the preview asked of the canvas, and the canvas's answer
 * @property onApply - Asks the canvas to apply its drafts, under an id the answer names
 * @property onPublish - Publishes the page, one commit; `none` when it committed, else what refused it
 * @property onExit - Returns to the builder; `none` when there is none to return to
 */
export const StudioPublishPayloadType = StructType({
    project: StringType,
    title: StringType,
    summary: PublishSummaryType,
    env: OptionType(StringType),
    audience: OptionType(StringType),
    rollout: OptionType(StringType),
    page: FunctionType([], UIComponentType),
    apply: SnapGrid.Types.ApplyState,
    onApply: FunctionType([StringType], NullType),
    onPublish: AsyncFunctionType([], OptionType(StringType)),
    onExit: OptionType(FunctionType([], NullType)),
});

/** Type representing the `StudioPublish` renderer's payload. */
export type StudioPublishPayloadType = typeof StudioPublishPayloadType;

// ============================================================================
// What the preview shows
// ============================================================================

/**
 * What the preview shows of the open entry: where it stands, the change list,
 * the components whose code changed, and whether the canvas has drafts.
 *
 * @remarks
 * `layout` is the layout that publishes — the page's cells as the canvas
 * draws them, its unsaved drafts in place — and `saved` its draft as last
 * saved. A page never published is ready, its changes those from nothing:
 * every placement added. A published one is ready while its layout differs
 * from its live version's, or a component it places has code other than the
 * fingerprint the live version stored for it; otherwise it is current. A
 * change names its placement by its title, else its component's name, else
 * its component's key; a component the surface does not list is never
 * counted as changed.
 */
export const publishSummary = East.function(
    [ArrayType(StudioComponentType), OptionType(StudioLiveType), StudioPageType, ArrayType(StudioCellType), BooleanType],
    PublishSummaryType,
    ($, components, live, layout, saved, template) => {
        const unsaved = $.let(East.notEqual(layout.cells, saved));
        $.if(template, ($2) => {
            $2.return(East.value({
                standing: variant("template", null),
                live: none,
                changes: [],
                changed: [],
                unsaved,
            }, PublishSummaryType));
        });
        const listed = $.let(components.toDict(
            (_$2, component) => component.key,
            (_$2, component) => component,
            (_$2, first) => first,
        ), DictType(StringType, StudioComponentType));
        const before = $.let(live.match({
            some: (_$2, version) => version.page,
            none: (_$2) => East.value({ title: layout.title, cells: [] }, StudioPageType),
        }), StudioPageType);

        // Each placement's name, the later layout's where both hold it.
        const names = $.let(new Map(), DictType(StringType, StringType));
        $.for(before.cells.concat(layout.cells), ($2, cell) => {
            const name = $2.let(cell.title.match({
                some: (_$3, title) => title,
                none: (_$3) => listed.tryGet(cell.component).match({
                    some: (_$4, component) => component.name,
                    none: (_$4) => cell.component,
                }),
            }));
            $2(names.insertOrUpdate(cell.key, name, (_$3, _old) => name));
        });
        const changes = $.let(pageChanges(before, layout).map((_$2, change) => ({
            change,
            name: names.get(change.match({
                added: (_$3, c) => c.cell,
                removed: (_$3, c) => c.cell,
                moved: (_$3, c) => c.cell,
                resized: (_$3, c) => c.cell,
                height: (_$3, c) => c.cell,
                aligned: (_$3, c) => c.cell,
                retitled: (_$3, c) => c.cell,
            })),
        })), ArrayType(PublishChangeType));

        // The components whose code is not the code the live version stored
        // for them, among those the layout places.
        const stale = $.let(new Set<string>(), SetType(StringType));
        $.for(before.cells, ($2, cell) => {
            $2.match(listed.tryGet(cell.component), {
                some: ($3, component) => {
                    $3.if(component.fingerprint.notEqual(cell.fingerprint), ($4) => {
                        $4(stale.tryInsert(cell.component));
                    });
                },
            });
        });
        const named = $.let(new Set<string>(), SetType(StringType));
        const changed = $.let([], ArrayType(StringType));
        $.for(layout.cells, ($2, cell) => {
            $2.if(stale.has(cell.component).and(() => named.has(cell.component).not()), ($3) => {
                $3(named.insert(cell.component));
                $3(changed.pushLast(listed.get(cell.component).name));
            });
        });

        const ready = $.let(live.hasTag("none").or(() => changes.size().greater(0n)).or(() => changed.size().greater(0n)));
        return {
            standing: ready.ifElse(
                () => East.value(variant("ready", null), PublishStandingType),
                () => East.value(variant("current", null), PublishStandingType),
            ),
            live: live.match({
                some: (_$2, version) => some(version.version),
                none: (_$2) => East.value(none, OptionType(IntegerType)),
            }),
            changes,
            changed,
            unsaved,
        };
    },
);

/**
 * What refused a publish, or `none` when it committed. A publish another
 * write overtook is a conflict: the page moved since the preview drew it.
 */
export const publishRefusal = East.function(
    [RecordOutcomeType],
    OptionType(StringType),
    ($, outcome) => {
        const refused = $.let(none, OptionType(StringType));
        $.match(outcome, {
            conflict: ($2) => { $2.assign(refused, some("Another write changed this page first — review it and publish again")); },
            invalid: ($2, refusal) => { $2.assign(refused, some(refusal.message)); },
            failed: ($2, refusal) => { $2.assign(refused, some(East.str`The write failed: ${refusal.stderr}`)); },
            timed_out: ($2) => { $2.assign(refused, some("The write ran out of time and wrote nothing")); },
            transport: ($2, lost) => { $2.assign(refused, some(East.str`The write got no answer, so it may have been made — ${lost.message}`)); },
        });
        return refused;
    },
);

// ============================================================================
// The renderer's carrier
// ============================================================================

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioPublishComponent = EastUI.component("StudioPublish", StudioPublishPayloadType, { optional: true });

// ============================================================================
// <Studio.Publish>
// ============================================================================

/** The pages record, bound with its patch mutation — what the preview reads and a publish commits through. */
type StudioPagesHandle = ExprType<StructType<{
    read: FunctionType<[], StudioPagesType>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, StudioPagesPatchType], RecordOutcomeType> }>;
}>>;

/**
 * `<Studio.Publish>` options.
 *
 * @property pages - The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`
 * @property components - The components the surface lists — what the page draws, and whose code a publish stamps
 * @property project - The project whose pages the builder opens
 * @property env - Where it publishes to — the Env pill, and "Publish vN to <env>"
 * @property audience - Who sees the page — the Audience row
 * @property rollout - When they see it — the Rollout row
 * @property id - Names the builder whose open page, drafted placements and Apply it shares, when a surface holds two
 * @property onExit - Returns to the builder — Exit; omitted, Exit is disabled
 */
export interface StudioPublishOptions {
    /** The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`. */
    pages: StudioPagesHandle;
    /** The components the surface lists — what the page draws, and whose code a publish stamps. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose pages the builder opens. */
    project: SubtypeExprOrValue<StringType>;
    /** Where it publishes to — the Env pill, and "Publish vN to <env>"; omitted, neither names one. */
    env?: SubtypeExprOrValue<StringType>;
    /** Who sees the page — the Audience row; omitted, no row. */
    audience?: SubtypeExprOrValue<StringType>;
    /** When they see it — the Rollout row; omitted, no row. */
    rollout?: SubtypeExprOrValue<StringType>;
    /** Names the builder whose open page, drafted placements and Apply it shares — needed only when one surface holds two builders. */
    id?: string;
    /** Returns to the builder — Exit; omitted, Exit is disabled. */
    onExit?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

/**
 * The publish preview: the open page as it will publish, what changed since
 * its live version, and the actions that publish it.
 *
 * @remarks
 * - **The bar**, headerless: "● Preview"; Desktop · Tablet · Mobile, which
 *   draw the page 1440, 1024 or 390 px wide at most; the Env pill; and Exit.
 * - **The page**: its project, its title and its layout as it will publish —
 *   its placements as the canvas draws them, unsaved drafts in place — drawn
 *   as `<Studio.Page version="draft">` draws it.
 * - **The aside**: "Ready to publish", the version it replaces and the one it
 *   becomes, and the changes since — each placement added, removed, moved or
 *   resized; the banner, which says the components' code is as it went live
 *   and the page is safe to publish, or names the components whose code
 *   changed since; the Audience and Rollout rows; and the footer. A page
 *   never published is its first version, every placement added; one whose
 *   layout and code are as they went live is up to date; a template is not
 *   published.
 * - **The footer**: Save as draft is the canvas's Apply. Publish applies the
 *   canvas's drafts first, when it has any, then commits the publish — one
 *   patch that makes the draft live as the next version, each placement
 *   stamped with the code it goes live with (`Studio.publish`). What refused
 *   either shows above the footer.
 *
 * The open page and the placements the canvas draws are State the builder's
 * screens share by `id`, and so is the Apply the preview asks for: the canvas
 * — mounted, with the same `id` — applies its drafts and answers. With no
 * canvas to answer, a publish with drafts waits.
 *
 * @param options - The bound record, the listed components, the project, the words the aside shows and Exit ({@link StudioPublishOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * export const preview = ui("preview", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const record     = $.let(Record.bind(pages, [pagesPatch]));
 *         return <Studio.Publish pages={record} components={components} project="Ops console"
 *             env="Staging" audience="Field ops · 24 users" rollout="Immediate" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createPublish(options: StudioPublishOptions): ExprType<UIComponentType> {
    const keys = builderKeys(options.id);
    const env = options.env === undefined ? none : some(options.env);
    const audience = options.audience === undefined ? none : some(options.audience);
    const rollout = options.rollout === undefined ? none : some(options.rollout);
    const onExit = options.onExit === undefined ? none : some(options.onExit);
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const record = $.let(options.pages);
        const pages = $.let(record.read());
        const components = $.let(options.components, ArrayType(StudioComponentType));
        const project = $.let(options.project, StringType);

        // The open page, as every screen of the builder binds it — the
        // project's first to begin with — its placements as the canvas draws
        // them, and the Apply asked of the canvas.
        const first = $.let({ project, page: "" }, StudioKeyType);
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project).and(() => first.page.equal("")).and(() => entry.hasTag("page")), ($3) => {
                $3.assign(first, key);
            });
        });
        const open = $.let(State.bind([StudioKeyType], keys.page, first));
        const openKey = $.let(open.read());
        const drafted = $.let(State.bind([OptionType(BuilderCellsType)], keys.cells, none));
        const applying = $.let(State.bind([SnapGrid.Types.ApplyState], keys.apply, East.value(variant("idle", null), SnapGrid.Types.ApplyState)));

        $.if(pages.has(openKey).not(), ($2) => {
            $2.return(EmptyState.Root({
                title: Text.Root("No page open"),
                description: Text.Root(East.str`${project} has no page ${openKey.page}. Open a page from the palette's Pages tab, or start one from the page library.`),
                icon: { prefix: "fas", name: "file-circle-question" },
            }));
        });
        const entry = $.let(pages.get(openKey));
        const saved = $.let(entry.match({
            page: (_$2, page) => page.draft,
            template: (_$2, layout) => layout,
        }), StudioPageType);
        const live = $.let(entry.match({
            page: (_$2, page) => page.live,
            template: (_$2) => East.value(none, OptionType(StudioLiveType)),
        }), OptionType(StudioLiveType));
        // The layout that publishes: the cells the canvas draws while they are
        // this page's, its unsaved drafts in place; else its draft as saved.
        const layout = $.let({
            title: saved.title,
            cells: drafted.read().match({
                some: (_$2, drawn) => East.equal(drawn.page, openKey).ifElse(() => drawn.cells, () => saved.cells),
                none: (_$2) => saved.cells,
            }),
        }, StudioPageType);
        const summary = $.let(publishSummary(components, live, layout, saved.cells, entry.hasTag("template")));

        // The page as it will publish, drawn as <Studio.Page version="draft"> draws it.
        const page = $.const(East.function([], UIComponentType, ($2) => {
            const one = $2.let(new Map(), StudioPagesType);
            $2(one.insert(openKey, variant("page", { draft: layout, live: none })));
            return renderPage(one, components, openKey, East.value(variant("draft", null), StudioVersionType));
        }));
        // The canvas applies its drafts, and answers under the id.
        const onApply = $.const(East.function([StringType], NullType, ($2, id) => {
            $2(applying.write(variant("asked", id)));
        }));
        // The publish, from the record as it stands when it commits — what an
        // Apply just before it left.
        const onPublish = $.const(East.asyncFunction([], OptionType(StringType), ($2) => {
            const now = $2.let(record.read());
            const outcome = $2.let(record.commit.patch("", StudioPages.publish(now, openKey, components)));
            return publishRefusal(outcome);
        }));

        return StudioPublishComponent.Root({
            project,
            title: saved.title,
            summary,
            env,
            audience,
            rollout,
            page,
            apply: applying.read(),
            onApply,
            onPublish,
            onExit,
        });
    }));
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Publish>` — the publish preview: the open page as it will publish,
 * what changed since its live version, and the actions that publish it. See
 * {@link createPublish}.
 */
export const StudioPublish: JsxTag<OptionsProps<typeof createPublish>> = optionsTag(createPublish);
