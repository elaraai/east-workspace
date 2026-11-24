/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Access platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * The tests open this package's own Access database (`access-actors.ts`): its
 * `actor` table's ten rows are what each query returns. They open it by its
 * path from this package's directory, where they run on Node and, exported, on
 * Python.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test as unitTest } from "node:test";
import { East, IntegerType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { SQL } from "@elaraai/east-node-io";
import * as ex from "./access.examples.js";
import { ACTORS, ACTORS_PATH, actorsDatabase } from "./access-actors.js";

// Define the expected row type for actor table (every Access column may be null)
const ActorRowType = StructType({
    actor_id: OptionType(IntegerType),
    first_name: OptionType(StringType),
    last_name: OptionType(StringType),
});

// The actor table's rows with two of its columns
const PartialActorType = StructType({
    actor_id: OptionType(IntegerType),
    first_name: OptionType(StringType),
});

/** The table's rows as a query reads them, in its order. */
const actors: ValueTypeOf<typeof ActorRowType>[] = ACTORS.map((actor) => ({
    actor_id: some(BigInt(actor.id)),
    first_name: some(actor.first),
    last_name: actor.last === null ? none : some(actor.last),
}));

await describeEast("Access platform functions", (test) => {
    Assert.examples(test, { accessOpen: ex.accessOpen, accessClose: ex.accessClose, accessTables: ex.accessTables, accessQuery: ex.accessQuery, accessCloseAll: ex.accessCloseAll });

    test("open database from file and list tables", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Its one table: the catalog, a system table, is not listed
        const result = $.let(SQL.Access.tables(handle));
        $(Assert.equal(result.tables, ["actor"]));

        $(SQL.Access.close(handle));
    });

    test("query actor table returns rows", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with typed row results, limit to 5 rows
        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: none,
            rowLimit: some(5n),
        });

        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));

        // The table's first 5 rows
        $(Assert.equal(rows, actors.slice(0, 5)));

        $(SQL.Access.close(handle));
    });

    test("query with column selection returns rows", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with specific columns only
        const options = $.let({
            table: "actor",
            columns: some(["actor_id", "first_name"]),
            rowOffset: none,
            rowLimit: some(3n),
        });

        const rows = $.let(SQL.Access.query([PartialActorType], handle, options));

        // The first 3 rows' two columns
        $(Assert.equal(rows, actors.slice(0, 3).map(({ actor_id, first_name }) => ({ actor_id, first_name }))));

        $(SQL.Access.close(handle));
    });

    test("query with pagination returns correct count", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with offset and limit
        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: some(5n),
            rowLimit: some(3n),
        });

        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));

        // The 3 rows after the first 5
        $(Assert.equal(rows, actors.slice(5, 8)));

        $(SQL.Access.close(handle));
    });

    test("query without limit returns every row, a missing value as none", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: none,
            rowLimit: none,
        });

        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));

        // All 10 rows: the last has no last_name
        $(Assert.equal(rows, actors));

        $(SQL.Access.close(handle));
    });

    // Error case tests

    test("query throws error when field type does not match column type", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Define row type with wrong type for 'actor_id' column (String instead of Integer)
        const WrongActorType = StructType({
            actor_id: StringType,  // Wrong! Column is integer
            first_name: StringType,
            last_name: StringType,
        });

        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: none,
            rowLimit: some(1n),
        });

        // Should throw error about type mismatch
        $(Assert.throws(
            SQL.Access.query([WrongActorType], handle, options),
            /Type mismatch.*actor_id/
        ));

        $(SQL.Access.close(handle));
    });

    test("query throws error when column not found", $ => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Define row type with non-existent column
        // Note: actor_id is nullable in this database, so use OptionType
        const BadActorType = StructType({
            actor_id: OptionType(IntegerType),
            nonexistent_column: StringType,  // This column doesn't exist
        });

        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: none,
            rowLimit: some(1n),
        });

        // Should throw error about column not found
        $(Assert.throws(
            SQL.Access.query([BadActorType], handle, options),
            /Column.*nonexistent_column.*not found/
        ));

        $(SQL.Access.close(handle));
    });
}, {
    platformFns: [...SQL.Access.Implementation, ...NodePlatform],
    afterEach: $ => {
        // Close all connections after each test
        $(SQL.Access.closeAll());
    }
});

describe("the Access test database", () => {
    unitTest("is what the writer writes from its actors", () => {
        assert.ok(
            readFileSync(ACTORS_PATH).equals(actorsDatabase()),
            `${ACTORS_PATH} is not what test/sql/access-writer.ts writes from test/sql/access-actors.ts: write it again with \`pnpm run test:fixtures\` in this package`,
        );
    });
});
