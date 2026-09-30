/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's publish preview (#998) — the open page as it will publish,
 * what changed since its live version, and the actions that publish it,
 * computed in East for the `StudioBuilder` renderer, which draws the preview
 * in the canvas's place: its bar — "● Preview", the device widths, the
 * environment and Exit — the page at the device's width, and the aside: what
 * changed since the live version, whether the components' code changed since,
 * who sees it and when, and Save as draft and Publish. The page it shows is
 * the one that publishes, the canvas's unsaved drafts in place, and it has the
 * canvas apply them before it publishes, so the canvas stays the only writer
 * of its drafts.
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
} from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { StudioComponentType } from "./component.js";
import {
    StudioCellType,
    StudioChangeType,
    StudioLiveType,
    StudioPageType,
    pageChanges,
} from "./pages.js";

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
 * The publish preview, as the `StudioBuilder` renderer draws it — beside the
 * page as it will publish, which the builder draws.
 *
 * @property project - The project — the page's eyebrow
 * @property title - The page's title
 * @property summary - Where it stands and what changed ({@link PublishSummaryType})
 * @property env - Where it publishes to — the Env pill, and the Publish button's words
 * @property audience - Who sees it — the Audience row
 * @property rollout - When they see it — the Rollout row
 * @property apply - The Apply the preview asked of the canvas, and the canvas's answer
 * @property onApply - Asks the canvas to apply its drafts, under an id the answer names
 * @property onPublish - Publishes the page, one commit; `none` when it committed, else what refused it
 * @property onExit - Returns to the canvas; `none` when there is none to return to
 */
export const StudioPublishPayloadType = StructType({
    project: StringType,
    title: StringType,
    summary: PublishSummaryType,
    env: OptionType(StringType),
    audience: OptionType(StringType),
    rollout: OptionType(StringType),
    apply: SnapGrid.Types.ApplyState,
    onApply: FunctionType([StringType], NullType),
    onPublish: AsyncFunctionType([], OptionType(StringType)),
    onExit: OptionType(FunctionType([], NullType)),
});

/** Type representing the publish preview, as the builder draws it. */
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
