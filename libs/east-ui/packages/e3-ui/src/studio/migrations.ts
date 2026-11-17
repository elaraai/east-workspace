/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pages record's migrations (#1669) — the steps a solution lists in its
 * record's `migrations`, so a deploy carries a workspace's pages from the type
 * an earlier release stored them as to the one this release reads.
 *
 * ```ts
 * export const pages = e3.record("pages", Studio.Types.Pages, {
 *     initial: new Map(),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)],
 * });
 * ```
 *
 * A step's types are frozen as they were released: the type it takes never
 * changes, whatever the pages record's type becomes after it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    East,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
} from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { StudioContentType } from "./content.js";
import { StudioKeyType } from "./key.js";
import { StudioEntryType, StudioLiveType, StudioPageType } from "./pages.js";

// ============================================================================
// cell_content — a placement's component key becomes its content
// ============================================================================

/** A placement as it was stored before a placement held content: a component's key. */
const CellBeforeContentType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: SnapGrid.Types.Align,
    title: OptionType(StringType),
    component: StringType,
});

/** A page's layout, of such placements. */
const PageBeforeContentType = StructType({ title: StringType, cells: ArrayType(CellBeforeContentType) });

/** One entry of the pages record, of such layouts. */
const EntryBeforeContentType = VariantType({
    page: StructType({
        draft: PageBeforeContentType,
        live: OptionType(StructType({ version: IntegerType, page: PageBeforeContentType })),
    }),
    template: PageBeforeContentType,
});

/**
 * Carries one entry of the pages record to the type whose placements hold
 * content: every placement's component key becomes `component(key)`, in a
 * page's draft, its live version and a template, and nothing else changes.
 *
 * @remarks
 * A solution lists it as a rows step of its pages record:
 * `migration.rows("cell_content", Studio.migrations.cellContent)`. A workspace
 * applies it once, at the deploy that brings the release in.
 */
export const cellContent = East.function(
    [StudioKeyType, EntryBeforeContentType],
    StudioEntryType,
    ($, _key, entry) => {
        const carried = $.const(East.function([PageBeforeContentType], StudioPageType, (_$2, page) => ({
            title: page.title,
            cells: page.cells.map((_$3, cell) => ({
                key: cell.key,
                row: cell.row,
                span: cell.span,
                height: cell.height,
                align: cell.align,
                title: cell.title,
                content: East.value(variant("component", cell.component), StudioContentType),
            })),
        })));
        return entry.match({
            page: (_$2, held) => East.value(variant("page", {
                draft: carried(held.draft),
                live: held.live.match({
                    some: (_$3, live) => East.value(some({ version: live.version, page: carried(live.page) }), OptionType(StudioLiveType)),
                    none: (_$3) => East.value(none, OptionType(StudioLiveType)),
                }),
            }), StudioEntryType),
            template: (_$2, layout) => East.value(variant("template", carried(layout)), StudioEntryType),
        });
    },
);

/** The pages record's migration steps, on the `Studio` namespace. */
export interface StudioMigrationsNamespace {
    /** A placement's component key becomes its content ({@link cellContent}): `migration.rows("cell_content", Studio.migrations.cellContent)`. */
    cellContent: typeof cellContent;
}

/** The pages record's migration steps. */
export const StudioMigrations: StudioMigrationsNamespace = { cellContent };
