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
 * The tests fetch a public Access database (Sakila sample) at runtime,
 * write it to a temp file, then open it using access_open.
 */
import { East, IntegerType, OptionType, StringType, StructType, variant } from "@elaraai/east";
import { describeEast, Assert, NodePlatform, Fetch, FileSystem } from "@elaraai/east-node-std";
import { SQL } from "@elaraai/east-node-io";
import * as ex from "./access.examples.js";

// Public test database: Sakila sample database (Access port)
// https://github.com/ozzymcduff/sakila-sample-database-ports
const TEST_DB_URL = "https://raw.githubusercontent.com/ozzymcduff/sakila-sample-database-ports/master/ms-access-sakila-db/access-sakila.mdb";
const TEST_DB_PATH = "/tmp/east-test-sakila.mdb";

// Define the expected row type for actor table (columns are nullable in Sakila)
const ActorRowType = StructType({
    actor_id: OptionType(IntegerType),
    first_name: OptionType(StringType),
    last_name: OptionType(StringType),
});

await describeEast("Access platform functions", (test) => {
    Assert.examples(test, { accessOpen: ex.accessOpen, accessClose: ex.accessClose, accessTables: ex.accessTables, accessQuery: ex.accessQuery, accessCloseAll: ex.accessCloseAll });

    test("open database from file and list tables", $ => {
        // Fetch database bytes from URL and write to temp file
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // List tables
        const result = $.let(SQL.Access.tables(handle));

        // Should have tables (Sakila has many tables)
        $(Assert.greater(result.tables.size(), East.value(0n)));

        $(SQL.Access.close(handle));
    });

    test("query actor table returns rows", $ => {
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with typed row results, limit to 5 rows
        const options = $.let({
            table: "actor",
            columns: variant('none', null),
            rowOffset: variant('none', null),
            rowLimit: variant('some', 5n),
        });

        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));

        // Should return between 1 and 5 rows
        $(Assert.greater(rows.size(), East.value(0n)));
        $(Assert.lessEqual(rows.size(), East.value(5n)));

        $(SQL.Access.close(handle));
    });

    test("query with column selection returns rows", $ => {
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with specific columns only (columns are nullable)
        const PartialActorType = StructType({
            actor_id: OptionType(IntegerType),
            first_name: OptionType(StringType),
        });

        const options = $.let({
            table: "actor",
            columns: variant('some', ["actor_id", "first_name"]),
            rowOffset: variant('none', null),
            rowLimit: variant('some', 3n),
        });

        const rows = $.let(SQL.Access.query([PartialActorType], handle, options));

        // Should return between 1 and 3 rows
        $(Assert.greater(rows.size(), East.value(0n)));
        $(Assert.lessEqual(rows.size(), East.value(3n)));

        $(SQL.Access.close(handle));
    });

    test("query with pagination returns correct count", $ => {
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
        }, SQL.Access.Types.Config);

        const handle = $.let(SQL.Access.open(config));

        // Query with offset and limit
        const options = $.let({
            table: "actor",
            columns: variant('none', null),
            rowOffset: variant('some', 5n),
            rowLimit: variant('some', 3n),
        });

        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));

        // Should return at most 3 rows
        $(Assert.lessEqual(rows.size(), East.value(3n)));

        $(SQL.Access.close(handle));
    });

    // Error case tests

    test("query throws error when field type does not match column type", $ => {
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
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
            columns: variant('none', null),
            rowOffset: variant('none', null),
            rowLimit: variant('some', 1n),
        });

        // Should throw error about type mismatch
        $(Assert.throws(
            SQL.Access.query([WrongActorType], handle, options),
            /Type mismatch.*actor_id/
        ));

        $(SQL.Access.close(handle));
    });

    test("query throws error when column not found", $ => {
        const bytes = $.let(Fetch.getBytes(TEST_DB_URL));
        $(FileSystem.writeFileBytes(TEST_DB_PATH, bytes));

        const config = $.let({
            path: TEST_DB_PATH,
            password: variant('none', null),
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
            columns: variant('none', null),
            rowOffset: variant('none', null),
            rowLimit: variant('some', 1n),
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
