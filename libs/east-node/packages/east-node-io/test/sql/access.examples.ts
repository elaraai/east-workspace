/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";
import { ACTORS_PATH } from "./access-actors.js";

export const accessOpen = example({
    keywords: ["access", "Access", "open", "connection", "mdb"],
    description: "Open a Microsoft Access database file",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);
        const handle = $.let(SQL.Access.open(config));
        $(SQL.Access.close(handle));
    }),
    inputs: [],
});

export const accessClose = example({
    keywords: ["access", "Access", "close", "disconnect"],
    description: "Close a Microsoft Access database connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);
        const handle = $.let(SQL.Access.open(config));
        $(SQL.Access.close(handle));
    }),
    inputs: [],
});

export const accessTables = example({
    keywords: ["access", "Access", "tables", "list", "schema"],
    description: "List tables in a Microsoft Access database",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);
        const handle = $.let(SQL.Access.open(config));
        const result = $.let(SQL.Access.tables(handle));
        $(SQL.Access.close(handle));
        return result.tables.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const accessQuery = example({
    keywords: ["access", "Access", "query", "select", "typed", "row"],
    description: "Query typed rows from a Microsoft Access table",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const config = $.let({
            path: ACTORS_PATH,
            password: none,
        }, SQL.Access.Types.Config);
        const handle = $.let(SQL.Access.open(config));
        const ActorRowType = StructType({
            actor_id: OptionType(IntegerType),
            first_name: OptionType(StringType),
            last_name: OptionType(StringType),
        });
        const options = $.let({
            table: "actor",
            columns: none,
            rowOffset: none,
            rowLimit: some(5n),
        });
        const rows = $.let(SQL.Access.query([ActorRowType], handle, options));
        $(SQL.Access.close(handle));
        return rows.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const accessCloseAll = example({
    keywords: ["access", "Access", "closeAll", "cleanup"],
    description: "Close all open Access database connections",
    fn: East.asyncFunction([], NullType, ($) => {
        $(SQL.Access.closeAll());
    }),
    inputs: [],
});
