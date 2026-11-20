/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pages record's migrations (#1669): `Studio.migrations.cellContent`
 * carries an entry whose placements hold a component's key to one whose
 * placements hold content — in a page's draft, its live version and a
 * template, nothing else changed — and a solution's record declares it as a
 * rows step. The types it takes and leaves are frozen copies: the type it
 * leaves is the pages record's own today, which a test holds it to, and stays
 * as it is when the Studio's type moves on — so a later kind of content is
 * another type, which the record is refused at without a step of its own. A
 * deploy that runs the step on a runner is e3-ui-cli's
 * `studio-migration.spec.ts`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, DictType, East, Expr, IntegerType, OptionType, SortedMap, StringType, StructType, VariantType, compareFor, isTypeEqual, none, printType, some,
    variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";

import { Studio } from "@elaraai/e3-ui";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const carry = East.compile(Studio.migrations.cellContent, []);
const KEY: Key = { project: "ops", page: "overview" };

/** A placement as a record held it before a placement held content. */
const before = (key: string, component: string, span = 12n) =>
    ({ key, row: "r1", span, height: some(96n), align: variant("stretch", null), title: some("Headline"), component });
/** The same placement, carried. */
const after = (key: string, component: string, span = 12n) =>
    ({ key, row: "r1", span, height: some(96n), align: variant("stretch", null), title: some("Headline"), content: Studio.visual.component(component) });

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

    test("it leaves the record as the type the Studio reads, so a solution lists it as its pages record's rows step", () => {
        const initial = new SortedMap<Key, Entry>([], compareFor(Studio.Types.Key));
        const pages = e3.record("pages", Studio.Types.Pages, {
            initial,
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)],
        });
        assert.ok(isTypeEqual(pages.type, Studio.Types.Pages));
    });

    test("the types it takes and leaves, spelled out in migrations.ts, are the pages record's today — when the Studio's types move on this fails: before the step ships, bring the copies up to them; after, leave them and ship the step that carries its type on", () => {
        const step: EastType = Expr.type(Studio.migrations.cellContent);
        if (step.type !== "Function") assert.fail(`expected a function, got ${printType(step)}`);
        const [key] = step.inputs as EastType[];
        assert.ok(isTypeEqual(key!, Studio.Types.Key), "the key it takes is the pages record's key");
        assert.ok(isTypeEqual(step.output as EastType, Studio.Types.Entry), "the entry it leaves is the pages record's entry");
    });

    test("a later kind of content is another type: a record declared with it and this step alone is refused where it is declared, so its release ships a step of its own", () => {
        // The pages record's type as a release that adds a kind of content would declare it: this step still leaves the
        // type it shipped with, which is that type no longer.
        const WiderCell = StructType({ ...Studio.Types.Cell.fields, content: VariantType({ ...Studio.Types.Content.cases, embed: StringType }) });
        const WiderPage = StructType({ ...Studio.Types.Page.fields, cells: ArrayType(WiderCell) });
        const WiderEntry = VariantType({
            page: StructType({ draft: WiderPage, live: OptionType(StructType({ version: IntegerType, page: WiderPage })) }),
            template: WiderPage,
        });
        assert.throws(() => e3.record("pages", DictType(Studio.Types.Key, WiderEntry), {
            initial: new SortedMap<Key, ValueTypeOf<typeof WiderEntry>>([], compareFor(Studio.Types.Key)),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)],
        }), /^Error: e3\.record 'pages' is declared as .+, but its last migration, 'cell_content', leaves it as /);
    });
});
