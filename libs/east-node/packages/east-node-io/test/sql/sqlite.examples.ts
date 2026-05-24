/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, StringType, BooleanType, NullType, StructType, variant, example } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const memoryConfig = {
    path: ":memory:",
    readOnly: variant('none', null),
    memory: variant('some', true),
};

export const sqliteConnect = example({
    keywords: ["sqlite", "SQLite", "connect", "connection", "open"],
    description: "Connect to an in-memory SQLite database",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(memoryConfig);
        const handle = $.let(SQL.SQLite.connect(config));
        $(SQL.SQLite.close(handle));
    }),
    inputs: [],
});

export const sqliteClose = example({
    keywords: ["sqlite", "SQLite", "close", "disconnect"],
    description: "Close a SQLite database connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(memoryConfig);
        const handle = $.let(SQL.SQLite.connect(config));
        $(SQL.SQLite.close(handle));
    }),
    inputs: [],
});

export const sqliteQuery = example({
    keywords: ["sqlite", "SQLite", "query", "SQL", "execute", "insert", "parameterized"],
    description: "Execute parameterized SQL queries on SQLite",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(memoryConfig);
        const conn = $.let(SQL.SQLite.connect(config));
        $(SQL.SQLite.query(conn, "CREATE TABLE items (id INTEGER, name TEXT)", []));
        $(SQL.SQLite.query(conn, "INSERT INTO items (name) VALUES (?)", [variant("String", "Alice")]));
        $(SQL.SQLite.close(conn));
    }),
    inputs: [],
});

export const sqliteSelect = example({
    keywords: ["sqlite", "SQLite", "select", "typed", "row", "struct"],
    description: "Execute a typed SELECT query on SQLite returning structs",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(memoryConfig);
        const conn = $.let(SQL.SQLite.connect(config));
        $(SQL.SQLite.query(conn, "CREATE TABLE users (id INTEGER, name TEXT, active BOOLEAN)", []));
        $(SQL.SQLite.query(conn, "INSERT INTO users VALUES (1, 'Alice', 1)", []));
        $(SQL.SQLite.query(conn, "INSERT INTO users VALUES (2, 'Bob', 0)", []));
        const UserRowType = StructType({
            id: IntegerType,
            name: StringType,
            active: BooleanType,
        });
        const users = $.let(SQL.SQLite.select([UserRowType], conn, "SELECT id, name, active FROM users ORDER BY id", []));
        $(SQL.SQLite.close(conn));
        return users.size();
    }),
    inputs: [],
    returns: 2n,
});

export const sqliteCloseAll = example({
    keywords: ["sqlite", "SQLite", "closeAll", "cleanup", "connections"],
    description: "Close all open SQLite connections",
    fn: East.asyncFunction([], NullType, ($) => {
        $(SQL.SQLite.closeAll());
    }),
    inputs: [],
});
