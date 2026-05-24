/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MySQL platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Requires Docker MySQL service running on localhost:3306
 */
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { East, IntegerType, StringType, FloatType, BooleanType, StructType, OptionType, variant, type ValueTypeOf } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";
import * as ex from "./mysql.examples.js";

await describeEast("MySQL platform functions", (test) => {
    Assert.examples(test, { mysqlConnect: ex.mysqlConnect, mysqlClose: ex.mysqlClose, mysqlQuery: ex.mysqlQuery, mysqlSelect: ex.mysqlSelect, mysqlCloseAll: ex.mysqlCloseAll });

    test("connect and close to MySQL server", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const handle = $.let(SQL.MySQL.connect(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Close returns void, use $()
        $(SQL.MySQL.close(handle));
    });

    test("query SELECT 1 returns result", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Execute a simple query
        const result = $.let(SQL.MySQL.query(
            conn,
            "SELECT 1 AS value",
            []
        ));

        // Verify result is select variant using $.match
        $.match(result, {
            select: ($, selectResult) => {
                const expectedRow = $.let(new Map<string, ValueTypeOf<typeof SQL.MySQL.Types.Parameter>>([
                    ["value", variant('Integer', 1n)],  // MySQL LONG returns Integer with column metadata
                ]), SQL.MySQL.Types.Row);
                $(Assert.equal(selectResult.rows, East.value([expectedRow])));
            },
            insert: ($, _) => $(Assert.fail("Expected select, got insert")),
            update: ($, _) => $(Assert.fail("Expected select, got update")),
            delete: ($, _) => $(Assert.fail("Expected select, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    test("INSERT query returns insert variant with lastInsertId", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_users (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT)",
            []
        ));

        // Insert a row
        const result = $.let(SQL.MySQL.query(
            conn,
            "INSERT INTO test_users (name) VALUES (?)",
            [variant("String", "Alice")]
        ));

        // Verify result is insert variant using $.match
        $.match(result, {
            select: ($, _) => $(Assert.fail("Expected insert, got select")),
            insert: ($, insertResult) => {
                // Verify rowsAffected
                $(Assert.equal(insertResult.rowsAffected, East.value(1n)));

                // Verify lastInsertId is Some
                $.match(insertResult.lastInsertId, {
                    some: ($, id) => $(Assert.equal(id, East.value(1n))),
                    none: ($) => $(Assert.fail("Expected lastInsertId to be Some")),
                });
            },
            update: ($, _) => $(Assert.fail("Expected insert, got update")),
            delete: ($, _) => $(Assert.fail("Expected insert, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    test("UPDATE query returns update variant with rowsAffected", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and insert row
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_users (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT)",
            []
        ));

        $(SQL.MySQL.query(
            conn,
            "INSERT INTO test_users (name) VALUES (?)",
            [variant("String", "Alice")]
        ));

        // Update the row
        const result = $.let(SQL.MySQL.query(
            conn,
            "UPDATE test_users SET name = ? WHERE name = ?",
            [variant("String", "Bob"), variant("String", "Alice")]
        ));

        // Verify result is update variant using $.match
        $.match(result, {
            select: ($, _) => $(Assert.fail("Expected update, got select")),
            insert: ($, _) => $(Assert.fail("Expected update, got insert")),
            update: ($, updateResult) => {
                $(Assert.equal(updateResult.rowsAffected, East.value(1n)));
            },
            delete: ($, _) => $(Assert.fail("Expected update, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    test("DELETE query returns delete variant with rowsAffected", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and insert row
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_users (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT)",
            []
        ));

        $(SQL.MySQL.query(
            conn,
            "INSERT INTO test_users (name) VALUES (?)",
            [variant("String", "Alice")]
        ));

        // Delete the row
        const result = $.let(SQL.MySQL.query(
            conn,
            "DELETE FROM test_users WHERE name = ?",
            [variant("String", "Alice")]
        ));

        // Verify result is delete variant using $.match
        $.match(result, {
            select: ($, _) => $(Assert.fail("Expected delete, got select")),
            insert: ($, _) => $(Assert.fail("Expected delete, got insert")),
            update: ($, _) => $(Assert.fail("Expected delete, got update")),
            delete: ($, deleteResult) => {
                $(Assert.equal(deleteResult.rowsAffected, East.value(1n)));
            },
        });

        $(SQL.MySQL.close(conn));
    });

    test("query with parameters uses ? placeholders", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_params (id INT, name TEXT)",
            []
        ));

        // Insert with parameters
        $(SQL.MySQL.query(
            conn,
            "INSERT INTO test_params (id, name) VALUES (?, ?)",
            [variant("Integer", 42n), variant("String", "test")]
        ));

        // Query back with parameter
        const result = $.let(SQL.MySQL.query(
            conn,
            "SELECT * FROM test_params WHERE id = ?",
            [variant("Integer", 42n)]
        ));

        // Verify we got the row back using $.match
        $.match(result, {
            select: ($, selectResult) => {
                const expectedRow = $.let(new Map<string, ValueTypeOf<typeof SQL.MySQL.Types.Parameter>>([
                    ["id", variant("Integer", 42n)],  // MySQL INT returns Integer with column metadata
                    ["name", variant("String", "test")],
                ]), SQL.MySQL.Types.Row);
                $(Assert.equal(selectResult.rows, East.value([expectedRow])));
            },
            insert: ($, _) => $(Assert.fail("Expected select, got insert")),
            update: ($, _) => $(Assert.fail("Expected select, got update")),
            delete: ($, _) => $(Assert.fail("Expected select, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    test("query with DateTime parameter and result", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table with timestamp column
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_datetime (id INT, created_at DATETIME)",
            []
        ));

        const testDate = $.let(new Date("2025-01-15T10:30:00Z"));

        // Insert with datetime parameter
        $(SQL.MySQL.query(
            conn,
            "INSERT INTO test_datetime (id, created_at) VALUES (?, ?)",
            [variant("Integer", 1n), variant("DateTime", testDate)]
        ));

        // Query back with datetime
        const result = $.let(SQL.MySQL.query(
            conn,
            "SELECT * FROM test_datetime WHERE id = ?",
            [variant("Integer", 1n)]
        ));

        // Verify we got the datetime back
        $.match(result, {
            select: ($, selectResult) => {
                const expectedRow = $.let(new Map<string, ValueTypeOf<typeof SQL.MySQL.Types.Parameter>>([
                    ["id", variant("Integer", 1n)],  // MySQL INT returns Integer with column metadata
                    ["created_at", variant("DateTime", new Date("2025-01-15T10:30:00Z"))],
                ]), SQL.MySQL.Types.Row);
                $(Assert.equal(selectResult.rows, East.value([expectedRow])));
            },
            insert: ($, _) => $(Assert.fail("Expected select, got insert")),
            update: ($, _) => $(Assert.fail("Expected select, got update")),
            delete: ($, _) => $(Assert.fail("Expected select, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    test("query with parameters handles all MySQL types", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table with all data types
        $(SQL.MySQL.query(
            conn,
            "CREATE TEMPORARY TABLE test_types (id INT, str TEXT, num INT, flt DOUBLE, bool BOOLEAN, nul TEXT, `blob` BLOB, dt DATETIME)",
            []
        ));

        const testDate = $.let(new Date("2025-01-15T10:30:00Z"));

        // Insert with all types
        $(SQL.MySQL.query(
            conn,
            "INSERT INTO test_types (id, str, num, flt, bool, nul, `blob`, dt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                variant("Integer", 1n),
                variant("String", "test"),
                variant("Integer", 42n),
                variant("Float", 3.14),
                variant("Boolean", true),
                variant("Null", null),
                variant("Blob", new Uint8Array([1, 2, 3])),
                variant("DateTime", testDate),
            ]
        ));

        // Query back the values
        const result = $.let(SQL.MySQL.query(
            conn,
            "SELECT * FROM test_types WHERE id = ?",
            [variant("Integer", 1n)]
        ));

        // Verify we got the row back using $.match
        $.match(result, {
            select: ($, selectResult) => {
                // Column types: id=INT(3), str=TEXT(252), num=INT(3), flt=DOUBLE(5), bool=TINYINT(1), nul=TEXT(252), blob=BLOB(252), dt=DATETIME(12)
                const expectedRow = $.let(new Map<string, ValueTypeOf<typeof SQL.MySQL.Types.Parameter>>([
                    ["id", variant("Integer", 1n)],
                    ["str", variant("String", "test")],
                    ["num", variant("Integer", 42n)],
                    ["flt", variant("Float", 3.14)],
                    ["bool", variant("Boolean", true)],
                    ["nul", variant("Null", null)],
                    ["blob", variant("Blob", new Uint8Array([1, 2, 3]))],
                    ["dt", variant("DateTime", new Date("2025-01-15T10:30:00Z"))],
                ]), SQL.MySQL.Types.Row);
                $(Assert.equal(selectResult.rows, East.value([expectedRow])));
            },
            insert: ($, _) => $(Assert.fail("Expected select, got insert")),
            update: ($, _) => $(Assert.fail("Expected select, got update")),
            delete: ($, _) => $(Assert.fail("Expected select, got delete")),
        });

        $(SQL.MySQL.close(conn));
    });

    // Tests for mysql_select (generic platform function)

    test("select with typed row returns correct structure", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and populate
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_select_users (id INT, name TEXT, active BOOLEAN)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_users VALUES (1, 'Alice', true)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_users VALUES (2, 'Bob', false)", []));

        // Define expected row type
        const UserRowType = StructType({
            id: IntegerType,
            name: StringType,
            active: BooleanType,
        });

        // Query with typed results
        const users = $.let(SQL.MySQL.select([UserRowType], conn, "SELECT id, name, active FROM test_select_users ORDER BY id", []));

        // Verify row count
        $(Assert.equal(users.size(), East.value(2n)));

        $(SQL.MySQL.close(conn));
    });

    test("select with partial columns", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and populate
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_select_products (id INT, name TEXT, price DOUBLE, stock INT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_products VALUES (1, 'Widget', 9.99, 100)", []));

        // Define partial row type (only some columns)
        const PartialProductType = StructType({
            name: StringType,
            price: FloatType,
        });

        // Query with only selected columns
        const products = $.let(SQL.MySQL.select([PartialProductType], conn, "SELECT name, price FROM test_select_products", []));

        // Verify we got results
        $(Assert.equal(products.size(), East.value(1n)));

        $(SQL.MySQL.close(conn));
    });

    test("select with parameters", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and populate
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_select_orders (id INT, customer TEXT, total DOUBLE)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_orders VALUES (1, 'Alice', 50.00)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_orders VALUES (2, 'Bob', 75.50)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_orders VALUES (3, 'Alice', 25.00)", []));

        const OrderType = StructType({
            id: IntegerType,
            customer: StringType,
            total: FloatType,
        });

        // Query with parameter (MySQL uses ? placeholders)
        const aliceOrders = $.let(SQL.MySQL.select([OrderType], conn,
            "SELECT id, customer, total FROM test_select_orders WHERE customer = ?",
            [variant("String", "Alice")]
        ));

        // Alice has 2 orders
        $(Assert.equal(aliceOrders.size(), East.value(2n)));

        $(SQL.MySQL.close(conn));
    });

    test("select with LIMIT returns correct count", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table with many rows
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_select_items (id INT, value TEXT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_select_items VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'e')", []));

        const ItemType = StructType({
            id: IntegerType,
            value: StringType,
        });

        // Query with LIMIT
        const items = $.let(SQL.MySQL.select([ItemType], conn, "SELECT id, value FROM test_select_items LIMIT 3", []));

        // Should return exactly 3 rows
        $(Assert.equal(items.size(), East.value(3n)));

        $(SQL.MySQL.close(conn));
    });

    test("select empty result returns empty array", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create empty temporary table
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_select_empty (id INT, name TEXT)", []));

        const RowType = StructType({
            id: IntegerType,
            name: StringType,
        });

        // Query empty table
        const rows = $.let(SQL.MySQL.select([RowType], conn, "SELECT id, name FROM test_select_empty", []));

        // Should return empty array
        $(Assert.equal(rows.size(), East.value(0n)));

        $(SQL.MySQL.close(conn));
    });

    // Error case tests

    test("select throws error when null value encountered for non-optional field", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and insert row with NULL value
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_null_error (id INT, name TEXT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_null_error VALUES (1, NULL)", []));

        // Define row type WITHOUT OptionType for nullable column
        const RowType = StructType({
            id: IntegerType,
            name: StringType,  // Not optional, but column has NULL
        });

        // Should throw error about null value for required field
        $(Assert.throws(
            SQL.MySQL.select([RowType], conn, "SELECT id, name FROM test_null_error", []),
            /null value.*required field.*name.*OptionType/
        ));

        $(SQL.MySQL.close(conn));
    });

    test("select succeeds when null value encountered for optional field", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table and insert row with NULL value
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_null_ok (id INT, name TEXT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_null_ok VALUES (1, NULL)", []));

        // Define row type WITH OptionType for nullable column
        const RowType = StructType({
            id: IntegerType,
            name: OptionType(StringType),  // Optional - can handle NULL
        });

        // Should succeed
        const rows = $.let(SQL.MySQL.select([RowType], conn, "SELECT id, name FROM test_null_ok", []));
        $(Assert.equal(rows.size(), East.value(1n)));

        $(SQL.MySQL.close(conn));
    });

    test("select throws error when field type does not match column type", $ => {
        const config = $.let({
            host: "localhost",
            port: 3306n,
            database: "testdb",
            user: "testuser",
            password: "testpass",
            ssl: variant('none', null),
            maxConnections: variant('none', null),
        });

        const conn = $.let(SQL.MySQL.connect(config));

        // Create temporary table with INT column
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_type_error (id INT, count INT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_type_error VALUES (1, 42)", []));

        // Define row type with wrong type for 'count' column (String instead of Integer)
        const WrongRowType = StructType({
            id: IntegerType,
            count: StringType,  // Wrong! Column is INT
        });

        // Should throw error about type mismatch
        $(Assert.throws(
            SQL.MySQL.select([WrongRowType], conn, "SELECT id, count FROM test_type_error", []),
            /Type mismatch.*count/
        ));

        $(SQL.MySQL.close(conn));
    });
}, {
    platformFns: [...SQL.MySQL.Implementation, ...NodePlatform],
    afterEach: $ => {
        // Close all connections after each test (even on failure)
        $(SQL.MySQL.closeAll());
    }
});
    