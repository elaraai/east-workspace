/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, StringType, BooleanType, NullType, StructType, variant, example } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const pgConfig = {
    host: "localhost",
    port: 5432n,
    database: "testdb",
    user: "testuser",
    password: "testpass",
    ssl: variant('none', null),
    maxConnections: variant('none', null),
};

export const postgresConnect = example({
    keywords: ["postgres", "Postgres", "PostgreSQL", "connect", "connection"],
    description: "Connect to a PostgreSQL database",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(pgConfig);
        const handle = $.let(SQL.Postgres.connect(config));
        $(SQL.Postgres.close(handle));
    }),
    inputs: [],
});

export const postgresClose = example({
    keywords: ["postgres", "Postgres", "PostgreSQL", "close", "disconnect"],
    description: "Close a PostgreSQL database connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(pgConfig);
        const handle = $.let(SQL.Postgres.connect(config));
        $(SQL.Postgres.close(handle));
    }),
    inputs: [],
});

export const postgresQuery = example({
    keywords: ["postgres", "Postgres", "PostgreSQL", "query", "SQL", "execute", "parameterized"],
    description: "Execute parameterized SQL queries on PostgreSQL",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(pgConfig);
        const conn = $.let(SQL.Postgres.connect(config));
        $(SQL.Postgres.query(conn, "CREATE TEMPORARY TABLE test_ex (id INTEGER, name TEXT)", []));
        $(SQL.Postgres.query(conn, "INSERT INTO test_ex (id, name) VALUES ($1, $2)", [variant("Integer", 1n), variant("String", "Alice")]));
        $(SQL.Postgres.close(conn));
    }),
    inputs: [],
});

export const postgresSelect = example({
    keywords: ["postgres", "Postgres", "PostgreSQL", "select", "typed", "row", "struct"],
    description: "Execute a typed SELECT query on PostgreSQL returning structs",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(pgConfig);
        const conn = $.let(SQL.Postgres.connect(config));
        $(SQL.Postgres.query(conn, "CREATE TEMPORARY TABLE test_sel (id INTEGER, name TEXT, active BOOLEAN)", []));
        $(SQL.Postgres.query(conn, "INSERT INTO test_sel VALUES (1, 'Alice', true)", []));
        const UserRowType = StructType({
            id: IntegerType,
            name: StringType,
            active: BooleanType,
        });
        const users = $.let(SQL.Postgres.select([UserRowType], conn, "SELECT id, name, active FROM test_sel", []));
        $(SQL.Postgres.close(conn));
        return users.size();
    }),
    inputs: [],
    returns: 1n,
});

export const postgresCloseAll = example({
    keywords: ["postgres", "Postgres", "PostgreSQL", "closeAll", "cleanup"],
    description: "Close all open PostgreSQL connections",
    fn: East.asyncFunction([], NullType, ($) => {
        $(SQL.Postgres.closeAll());
    }),
    inputs: [],
});
