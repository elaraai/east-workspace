/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pages record's migrations (#1669, #1759), which a solution's record
 * declares as rows steps, in order.
 *
 * - `Studio.migrations.cellContent` carries an entry whose placements hold a
 *   component's key to one whose placements hold content — in a page's draft,
 *   its live version and a template, nothing else changed.
 * - `Studio.migrations.entryFields` carries that entry to one that holds what
 *   it is, its project, its title and its tags as fields of its own — a
 *   page's draft and live version as they were, a template's layout its draft.
 *
 * The types each takes and leaves are frozen copies. The last step's is the
 * pages record's own today, which a test holds it to, and stays as it is when
 * the Studio's type moves on — so a later form is another type, which the
 * record is refused at without a step of its own. A deploy that runs the steps
 * on a runner is e3-ui-cli's `studio-migration.spec.ts`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, DictType, East, Expr, SortedSet, StringType, StructType, VariantType, compareFor, equalFor, isTypeEqual, none, printFor, printType,
    some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";

import { Studio } from "@elaraai/e3-ui";
import { Studio as StudioInternal } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Page = ValueTypeOf<typeof Studio.Types.Page>;

const carry = East.compile(Studio.migrations.cellContent, []);
const withFields = East.compile(Studio.migrations.entryFields, []);
const build = East.compile(StudioInternal.entry, []);
const sameEntry = equalFor(Studio.Types.Entry);
const printEntry = printFor(Studio.Types.Entry);
const KEY: Key = { project: "ops", page: "overview" };

/** No tags, as an entry holds them. */
const noTags = (): Entry["tags"] => new SortedSet<string>([], compareFor(StringType));

/** A placement as a record held it before a placement held content. */
const before = (key: string, component: string, span = 12n) =>
    ({ key, row: "r1", span, height: some(96n), align: variant("stretch", null), title: some("Headline"), component });
/** The same placement, carried. */
const after = (key: string, component: string, span = 12n) =>
    ({ key, row: "r1", span, height: some(96n), align: variant("stretch", null), title: some("Headline"), content: Studio.visual.component(component) });

/** The type a step takes its entries as, and the type it leaves them as. */
function stepTypes(step: EastType): { key: EastType; takes: EastType; leaves: EastType } {
    if (step.type !== "Function") assert.fail(`expected a function, got ${printType(step)}`);
    const [key, takes] = step.inputs as EastType[];
    return { key: key!, takes: takes!, leaves: step.output as EastType };
}

describe("Studio.migrations.cellContent (#1669)", () => {
    test("a page's draft and its live version are carried: each placement's component key is its content, its layout and title as they were", () => {
        const carried = carry(KEY, variant("page", {
            draft: { title: "Overview", cells: [before("c-kpi", "kpi_rail", 8n), before("c-trend", "revenue_trend", 4n)] },
            live: some({ version: 3n, page: { title: "Overview (v3)", cells: [before("c-kpi", "kpi_rail")] } }),
        }));
        // Each layout starts with no starting filters (#1673).
        assert.deepEqual(carried, variant("page", {
            draft: { title: "Overview", cells: [after("c-kpi", "kpi_rail", 8n), after("c-trend", "revenue_trend", 4n)], filters: [] },
            live: some({ version: 3n, page: { title: "Overview (v3)", cells: [after("c-kpi", "kpi_rail")], filters: [] } }),
        }));
    });

    test("a page never published keeps none live; a template and a page with no placements are carried", () => {
        assert.deepEqual(carry(KEY, variant("page", { draft: { title: "Blank", cells: [] }, live: none })),
            variant("page", { draft: { title: "Blank", cells: [], filters: [] }, live: none }));
        assert.deepEqual(carry(KEY, variant("template", { title: "Starter", cells: [before("t-kpi", "kpi_rail")] })),
            variant("template", { title: "Starter", cells: [after("t-kpi", "kpi_rail")], filters: [] }));
    });
});

describe("Studio.migrations.entryFields (#1759)", () => {
    const OVERVIEW: Page = { title: "Overview", cells: [after("c-kpi", "kpi_rail", 8n), after("c-trend", "revenue_trend", 4n)], filters: [] };
    const PUBLISHED: Page = { title: "Overview (v3)", cells: [after("c-kpi", "kpi_rail")], filters: [] };
    const STARTER: Page = { title: "Starter", cells: [after("t-kpi", "kpi_rail")], filters: [] };

    /** Holds a carried entry to the one expected, field for field. */
    const assertCarried = (carried: Entry, expected: Entry) =>
        assert.ok(sameEntry(carried, expected), `got ${printEntry(carried)}, expected ${printEntry(expected)}`);

    test("a page is carried under its key's project and its draft's title, with no tags: its draft and its live version as they were", () => {
        assertCarried(withFields(KEY, variant("page", { draft: OVERVIEW, live: some({ version: 3n, page: PUBLISHED }) })), {
            kind: variant("page", null), project: "ops", title: "Overview", tags: noTags(),
            draft: OVERVIEW, live: some({ version: 3n, page: PUBLISHED }),
        });
        assertCarried(withFields(KEY, variant("page", { draft: OVERVIEW, live: none })), {
            kind: variant("page", null), project: "ops", title: "Overview", tags: noTags(), draft: OVERVIEW, live: none,
        });
    });

    test("a template is carried under its key's project and its own title, with no tags: its layout its draft, and no published version", () => {
        assertCarried(withFields({ project: "retail", page: "tpl-starter" }, variant("template", STARTER)), {
            kind: variant("template", null), project: "retail", title: "Starter", tags: noTags(), draft: STARTER, live: none,
        });
    });

    test("it leaves an entry as every write of the record builds one, while the two types are one", () => {
        assertCarried(withFields(KEY, variant("page", { draft: OVERVIEW, live: some({ version: 3n, page: PUBLISHED }) })),
            build(KEY, variant("page", null), OVERVIEW, some({ version: 3n, page: PUBLISHED }), noTags()));
        assertCarried(withFields(KEY, variant("template", STARTER)), build(KEY, variant("template", null), STARTER, none, noTags()));
    });

    test("the two steps chain — a record held before a placement held content is carried through both", () => {
        const first = carry(KEY, variant("page", {
            draft: { title: "Overview", cells: [before("c-kpi", "kpi_rail", 8n), before("c-trend", "revenue_trend", 4n)] },
            live: some({ version: 3n, page: { title: "Overview (v3)", cells: [before("c-kpi", "kpi_rail")] } }),
        }));
        assertCarried(withFields(KEY, first), {
            kind: variant("page", null), project: "ops", title: "Overview", tags: noTags(),
            draft: OVERVIEW, live: some({ version: 3n, page: PUBLISHED }),
        });
    });
});

describe("the pages record's migration steps, as a record declares them (#1669, #1759)", () => {
    test("the two steps, in order, leave the record as the type the Studio reads, so a solution lists them as its pages record's rows steps", () => {
        const pages = e3.record("pages", Studio.Types.Pages, {
            initial: Studio.value([]),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [
                migration.rows("cell_content", Studio.migrations.cellContent),
                migration.rows("entry_fields", Studio.migrations.entryFields),
            ],
        });
        assert.ok(isTypeEqual(pages.type, Studio.Types.Pages));
    });

    test("a record that never listed the first step — one first declared once a placement held content — lists the second alone, which leaves the type the Studio reads", () => {
        const pages = e3.record("pages_one_step", Studio.Types.Pages, {
            initial: Studio.value([]),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
        });
        assert.ok(isTypeEqual(pages.type, Studio.Types.Pages));
    });

    test("a record that lists the first step alone is refused where it is declared: that step leaves the type the release before read", () => {
        assert.throws(() => e3.record("pages_first_step", Studio.Types.Pages, {
            initial: Studio.value([]),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)],
        }), /^Error: e3\.record 'pages_first_step' is declared as .+, but its last migration, 'cell_content', leaves it as /);
    });

    test("each step takes what the one before leaves, and the last leaves the pages record's entry today — when the Studio's types move on this fails: before the step ships, bring its copies up to them; after, leave them and ship the step that carries its type on", () => {
        const first = stepTypes(Expr.type(Studio.migrations.cellContent));
        const last = stepTypes(Expr.type(Studio.migrations.entryFields));
        assert.ok(isTypeEqual(first.key, Studio.Types.Key) && isTypeEqual(last.key, Studio.Types.Key), "the key each takes is the pages record's key");
        assert.ok(isTypeEqual(last.takes, first.leaves), "the second takes the entry the first leaves");
        assert.ok(isTypeEqual(last.leaves, Studio.Types.Entry), "the entry the last leaves is the pages record's entry");
    });

    test("a later form of an entry is another type: a record declared with it and these steps alone is refused where it is declared, so its release ships a step of its own", () => {
        // The pages record's type as a release that adds a kind of content would declare it: the last step still leaves
        // the type it shipped with, which is that type no longer.
        const WiderCell = StructType({ ...Studio.Types.Cell.fields, content: VariantType({ ...Studio.Types.Content.cases, embed: StringType }) });
        const WiderPage = StructType({ ...Studio.Types.Page.fields, cells: ArrayType(WiderCell) });
        const WiderEntry = StructType({ ...Studio.Types.Entry.fields, draft: WiderPage });
        assert.throws(() => e3.record("pages_wider", DictType(Studio.Types.Key, WiderEntry), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [
                migration.rows("cell_content", Studio.migrations.cellContent),
                migration.rows("entry_fields", Studio.migrations.entryFields),
            ],
        }), /^Error: e3\.record 'pages_wider' is declared as .+, but its last migration, 'entry_fields', leaves it as /);
    });
});
