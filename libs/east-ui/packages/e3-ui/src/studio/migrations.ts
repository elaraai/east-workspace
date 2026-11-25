/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pages record's migrations (#1669, #1759) — the steps a solution lists
 * in its record's `migrations`, in order, so a deploy carries a workspace's
 * pages from the type an earlier release stored them as to the one this
 * release reads.
 *
 * ```ts
 * export const pages = e3.record("pages", Studio.Types.Pages, {
 *     initial: new Map(),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     migrations: (migration) => [
 *         migration.rows("cell_content", Studio.migrations.cellContent),
 *         migration.rows("entry_fields", Studio.migrations.entryFields),
 *     ],
 * });
 * ```
 *
 * A step's types are frozen as they were released: the type it takes and the
 * type it leaves never change, whatever the pages record's type becomes after
 * it. So each is spelled out here, a copy of what the Studio declared when the
 * step shipped, and none is read from the types the Studio declares now. A
 * release that changes the pages record's type adds a step that takes the type
 * the last one leaves, and spells out its own.
 *
 * Every type the Studio declares is copied, and the snap grid's alignment with
 * them. A date's resolution, a value's format and jq are east's and east-ui's
 * own wires, read here by name: a change of one changes every record
 * that holds it, and is those packages' to migrate.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    East,
    FloatType,
    IntegerType,
    JqType,
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
import { TimeResolutionType } from "@elaraai/east-ui";
import { ValueFormatType } from "@elaraai/east-ui/internal";

// ============================================================================
// The pages record's type as `cell_content` leaves it — frozen
// ============================================================================
//
// A copy, never edited: the pages record's type the release that shipped
// `cell_content` read, and the type `entry_fields` takes.

/** A page's key. */
const KeyV1 = StructType({ project: StringType, page: StringType });
/** Where a placement sits in a taller row. */
const AlignV1 = VariantType({ top: NullType, center: NullType, stretch: NullType });

/** One value of a visual. */
const ValueV1 = StructType({
    measure: VariantType({
        count: NullType,
        sum: StringType,
        mean: StringType,
        min: StringType,
        max: StringType,
        distinct: StringType,
        ratio: StructType({ of: StringType, per: StringType }),
    }),
    label: OptionType(StringType),
    period: VariantType({ current: NullType, previous: NullType, year_ago: NullType }),
    goal: OptionType(FloatType),
    better: VariantType({ higher: NullType, lower: NullType }),
    format: OptionType(ValueFormatType),
});
/** What a visual groups its rows by. */
const GroupV1 = StructType({
    field: StringType,
    bucket: OptionType(TimeResolutionType),
    sort: VariantType({ natural: NullType, high: NullType, low: NullType, label: NullType }),
    top: OptionType(IntegerType),
});
/** How a chart's series stack. */
const StackV1 = VariantType({ none: NullType, stacked: NullType, percent: NullType });
/** Whether a chart draws its legend. */
const LegendV1 = VariantType({ auto: NullType, hidden: NullType });
/** A chart of series along one axis. */
const SeriesV1 = StructType({ x: GroupV1, values: ArrayType(ValueV1), split: OptionType(StringType), stack: StackV1, legend: LegendV1 });
/** A combo chart's value, and the axis it reads against. */
const AxisValueV1 = StructType({ value: ValueV1, right: BooleanType });
/** What a visual draws. */
const ViewV1 = VariantType({
    kpi: StructType({ value: ValueV1, compare: OptionType(ValueV1), trend: OptionType(StringType) }),
    chart: VariantType({
        column: SeriesV1,
        bar: SeriesV1,
        line: SeriesV1,
        area: SeriesV1,
        combo: StructType({ x: GroupV1, columns: ArrayType(AxisValueV1), lines: ArrayType(AxisValueV1), stack: StackV1, legend: LegendV1 }),
        scatter: StructType({ point: StringType, x: ValueV1, y: ValueV1, split: OptionType(StringType), legend: LegendV1 }),
        pie: StructType({ slice: GroupV1, value: ValueV1, donut: BooleanType, legend: VariantType({ values: NullType, names: NullType, hidden: NullType }) }),
    }),
    table: VariantType({
        records: StructType({ columns: ArrayType(StringType), sort: OptionType(StringType), descending: BooleanType }),
        summary: StructType({ rows: ArrayType(GroupV1), values: ArrayType(ValueV1), total: BooleanType }),
        pivot: StructType({ rows: GroupV1, columns: GroupV1, value: ValueV1, heat: BooleanType }),
    }),
    list: StructType({ item: GroupV1, caption: OptionType(StringType), values: ArrayType(ValueV1), bar: BooleanType }),
});
/** What a placement holds: a component's key, a visual or a text block. */
const ContentV1 = VariantType({
    component: StringType,
    visual: StructType({
        source: StringType,
        where: OptionType(JqType),
        view: ViewV1,
        click: VariantType({ select: NullType, filter: NullType, open: KeyV1, none: NullType }),
        follow: OptionType(StructType({
            leader: StringType,
            from: StringType,
            to: StringType,
            empty: VariantType({ all: NullType, prompt: NullType }),
        })),
    }),
    text: StructType({ heading: OptionType(StringType), body: StringType }),
});
/** One of a page's starting filters. */
const PageFilterV1 = StructType({ key: StringType, source: StringType, where: JqType });
/** A page's layout: its title, its placements and its starting filters. */
const PageV1 = StructType({
    title: StringType,
    cells: ArrayType(StructType({
        key: StringType,
        row: StringType,
        span: IntegerType,
        height: OptionType(IntegerType),
        align: AlignV1,
        title: OptionType(StringType),
        content: ContentV1,
    })),
    filters: ArrayType(PageFilterV1),
});
/** A published version of a page. */
const LiveV1 = StructType({ version: IntegerType, page: PageV1 });

const EntryV1Impl = VariantType({
    page: StructType({ draft: PageV1, live: OptionType(LiveV1) }),
    template: PageV1,
});
type EntryV1Impl = typeof EntryV1Impl;

/**
 * Type representing one entry of the pages record as `cell_content` leaves it.
 *
 * @remarks
 * An interface, so the step's type refers to it by name in declaration output
 * rather than spelling it out, which is past the length TypeScript will
 * serialize (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioEntryV1Type extends EntryV1Impl {}

/**
 * One entry of the pages record as `cell_content` leaves it: the first type
 * whose placements hold content. Frozen — see the module docs.
 */
export const StudioEntryV1Type: StudioEntryV1Type = EntryV1Impl;

// ============================================================================
// cell_content — a placement's component key becomes its content
// ============================================================================

/** A placement as it was stored before a placement held content: a component's key. */
const CellBeforeContentType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: AlignV1,
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
 * page's draft, its live version and a template; each starts with no
 * starting filters; and nothing else changes.
 *
 * @remarks
 * A solution lists it as a rows step of its pages record:
 * `migration.rows("cell_content", Studio.migrations.cellContent)`. A workspace
 * applies it once, at the deploy that brings the release in. It leaves an
 * entry as {@link StudioEntryV1Type}, whatever the pages record's type is now:
 * the step after it, {@link entryFields}, takes it from there.
 */
export const cellContent = East.function(
    [KeyV1, EntryBeforeContentType],
    StudioEntryV1Type,
    ($, _key, entry) => {
        const carried = $.const(East.function([PageBeforeContentType], PageV1, (_$2, page) => ({
            title: page.title,
            cells: page.cells.map((_$3, cell) => ({
                key: cell.key,
                row: cell.row,
                span: cell.span,
                height: cell.height,
                align: cell.align,
                title: cell.title,
                content: East.value(variant("component", cell.component), ContentV1),
            })),
            filters: East.value([], ArrayType(PageFilterV1)),
        })));
        return entry.match({
            page: (_$2, held) => East.value(variant("page", {
                draft: carried(held.draft),
                live: held.live.match({
                    some: (_$3, live) => East.value(some({ version: live.version, page: carried(live.page) }), OptionType(LiveV1)),
                    none: (_$3) => East.value(none, OptionType(LiveV1)),
                }),
            }), StudioEntryV1Type),
            template: (_$2, layout) => East.value(variant("template", carried(layout)), StudioEntryV1Type),
        });
    },
);

// ============================================================================
// The pages record's type as `entry_fields` leaves it — frozen
// ============================================================================
//
// A copy, never edited once the step has shipped: the pages record's type the
// release that ships `entry_fields` reads. Until then it follows the Studio's
// types, held to them by `migrations.spec.ts`. A layout and a published
// version are as `cell_content` left them, and are read from its copy.

const EntryV2Impl = StructType({
    kind: VariantType({ page: NullType, template: NullType }),
    project: StringType,
    title: StringType,
    tags: SetType(StringType),
    draft: PageV1,
    live: OptionType(LiveV1),
});
type EntryV2Impl = typeof EntryV2Impl;

/**
 * Type representing one entry of the pages record as `entry_fields` leaves it.
 *
 * @remarks
 * An interface, for the reason {@link StudioEntryV1Type} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioEntryV2Type extends EntryV2Impl {}

/**
 * One entry of the pages record as `entry_fields` leaves it: the first type
 * whose entries hold what they are, their project, their title and their tags
 * as fields of their own. Frozen — see the module docs.
 */
export const StudioEntryV2Type: StudioEntryV2Type = EntryV2Impl;

// ============================================================================
// entry_fields — an entry holds its kind, project, title and tags
// ============================================================================

/**
 * Carries one entry of the pages record to the type whose entries hold their
 * fields (#1759): a page keeps its draft and its published version, and a
 * template's layout becomes its draft with no published version; each is
 * what it was — a page or a template — under its key's project and its
 * layout's title, with no tags; and nothing else changes.
 *
 * @remarks
 * A solution lists it as a rows step of its pages record, after
 * `cell_content`: `migration.rows("entry_fields", Studio.migrations.entryFields)`.
 * A workspace applies it once, at the deploy that brings the release in. It
 * takes an entry as {@link StudioEntryV1Type} and leaves it as
 * {@link StudioEntryV2Type}, whatever the pages record's type is now: while
 * that is the Studio's own, the step is the record's last; once the Studio's
 * type moves on, the release that moves it ships the step after.
 */
export const entryFields = East.function(
    [KeyV1, StudioEntryV1Type],
    StudioEntryV2Type,
    (_$, key, entry) => entry.match({
        page: (_$2, held) => East.value({
            kind: variant("page", null),
            project: key.project,
            title: held.draft.title,
            tags: new Set<string>(),
            draft: held.draft,
            live: held.live,
        }, StudioEntryV2Type),
        template: (_$2, layout) => East.value({
            kind: variant("template", null),
            project: key.project,
            title: layout.title,
            tags: new Set<string>(),
            draft: layout,
            live: none,
        }, StudioEntryV2Type),
    }),
);

/** The pages record's migration steps, on the `Studio` namespace. */
export interface StudioMigrationsNamespace {
    /** A placement's component key becomes its content ({@link cellContent}): `migration.rows("cell_content", Studio.migrations.cellContent)`. */
    cellContent: typeof cellContent;
    /** An entry holds what it is, its project, its title and its tags ({@link entryFields}): `migration.rows("entry_fields", Studio.migrations.entryFields)`, after `cell_content`. */
    entryFields: typeof entryFields;
}

/** The pages record's migration steps, in the order a record lists them. */
export const StudioMigrations: StudioMigrationsNamespace = { cellContent, entryFields };
