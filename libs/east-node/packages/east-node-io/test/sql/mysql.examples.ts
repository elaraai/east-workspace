/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, StringType, BooleanType, NullType, StructType, variant, example } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const mysqlConfig = {
    host: "localhost",
    port: 3306n,
    database: "testdb",
    user: "testuser",
    password: "testpass",
    ssl: variant('none', null),
    maxConnections: variant('none', null),
};

export const mysqlConnect = example({
    keywords: ["mysql", "MySQL", "connect", "connection"],
    description: "Connect to a MySQL database",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(mysqlConfig);
        const handle = $.let(SQL.MySQL.connect(config));
        $(SQL.MySQL.close(handle));
    }),
    inputs: [],
});

export const mysqlClose = example({
    keywords: ["mysql", "MySQL", "close", "disconnect"],
    description: "Close a MySQL database connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(mysqlConfig);
        const handle = $.let(SQL.MySQL.connect(config));
        $(SQL.MySQL.close(handle));
    }),
    inputs: [],
});

export const mysqlQuery = example({
    keywords: ["mysql", "MySQL", "query", "SQL", "execute", "parameterized"],
    description: "Execute parameterized SQL queries on MySQL",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(mysqlConfig);
        const conn = $.let(SQL.MySQL.connect(config));
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_ex (id INT, name TEXT)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_ex (id, name) VALUES (?, ?)", [variant("Integer", 1n), variant("String", "Alice")]));
        $(SQL.MySQL.close(conn));
    }),
    inputs: [],
});

export const mysqlSelect = example({
    keywords: ["mysql", "MySQL", "select", "typed", "row", "struct"],
    description: "Execute a typed SELECT query on MySQL returning structs",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(mysqlConfig);
        const conn = $.let(SQL.MySQL.connect(config));
        $(SQL.MySQL.query(conn, "CREATE TEMPORARY TABLE test_sel (id INT, name TEXT, active BOOLEAN)", []));
        $(SQL.MySQL.query(conn, "INSERT INTO test_sel VALUES (1, 'Alice', true)", []));
        const UserRowType = StructType({
            id: IntegerType,
            name: StringType,
            active: BooleanType,
        });
        const users = $.let(SQL.MySQL.select([UserRowType], conn, "SELECT id, name, active FROM test_sel", []));
        $(SQL.MySQL.close(conn));
        return users.size();
    }),
    inputs: [],
    returns: 1n,
});

export const mysqlCloseAll = example({
    keywords: ["mysql", "MySQL", "closeAll", "cleanup"],
    description: "Close all open MySQL connections",
    fn: East.asyncFunction([], NullType, ($) => {
        $(SQL.MySQL.closeAll());
    }),
    inputs: [],
});
