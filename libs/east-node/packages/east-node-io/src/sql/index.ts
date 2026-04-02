/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SQL database platform functions.
 *
 * Provides type-safe SQL database operations for East programs, supporting
 * SQLite, PostgreSQL, and MySQL with connection pooling and parameterized queries.
 *
 * @packageDocumentation
 */

// Export individual modules
export * from "./sqlite.js";
export * from "./postgres.js";
export * from "./mysql.js";
export * from "./access.js";
export * from "./types.js";

// Import for grouped exports
import {
    sqlite_connect,
    sqlite_query,
    sqlite_select,
    sqlite_close,
    sqlite_close_all,
    SqliteImpl
} from "./sqlite.js";
import {
    postgres_connect,
    postgres_query,
    postgres_select,
    postgres_close,
    postgres_close_all,
    PostgresImpl
} from "./postgres.js";
import {
    mysql_connect,
    mysql_query,
    mysql_select,
    mysql_close,
    mysql_close_all,
    MySqlImpl
} from "./mysql.js";
import {
    access_open,
    access_tables,
    access_query,
    access_close,
    access_close_all,
    AccessImpl
} from "./access.js";
import {
    SqliteConfigType,
    PostgresConfigType,
    MySqlConfigType,
    AccessConfigType,
    AccessQueryOptionsType,
    AccessTablesResultType,
    SqlParameterType,
    SqlParametersType,
    SqlRowType,
    SqlResultType
} from "./types.js";

/**
 * SQL database platform functions.
 *
 * Provides type-safe SQL database operations for East programs, supporting
 * SQLite, PostgreSQL, and MySQL with connection pooling and parameterized queries.
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const getUserName = East.function([IntegerType], NullType, ($, userId) => {
 *     const config = $.let({
 *         host: "localhost",
 *         port: 5432n,
 *         database: "myapp",
 *         user: "postgres",
 *         password: "secret",
 *         ssl: variant('none', null),
 *         maxConnections: variant('none', null),
 *     });
 *
 *     const conn = $.let(SQL.Postgres.connect(config));
 *     $(SQL.Postgres.query(
 *         conn,
 *         "SELECT name FROM users WHERE id = $1",
 *         [variant('Integer', userId)]
 *     ));
 *     $(SQL.Postgres.close(conn));
 *     $.return(null);
 * });
 *
 * // All SQL operations are async
 * const compiled = East.compileAsync(getUserName.toIR(), SQL.Postgres.Implementation);
 * await compiled(42n);
 * ```
 */
export const SQL = {
    /**
     * SQLite database operations.
     *
     * Provides platform functions for SQLite, a serverless embedded SQL database.
     */
    SQLite: {
        /**
         * Opens a SQLite database connection.
         *
         * Creates a connection to a SQLite database file or in-memory database
         * and returns an opaque handle for use in queries.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         path: "./mydb.sqlite",
         *         readOnly: variant('none', null),
         *         memory: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.SQLite.connect(config));
         *     $(SQL.SQLite.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = ?",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.SQLite.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.SQLite.Implementation);
         * await compiled(42n);
         * ```
         */
        connect: sqlite_connect,

        /**
         * Executes a SQL query with parameters.
         *
         * Runs a SQL query with parameter binding using ? placeholders.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         path: "./mydb.sqlite",
         *         readOnly: variant('none', null),
         *         memory: variant('none', null),
         *     });
         *     const conn = $.let(SQL.SQLite.connect(config));
         *     $(SQL.SQLite.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = ?",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.SQLite.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.SQLite.Implementation);
         * await compiled(42n);
         * ```
         */
        query: sqlite_query,

        /**
         * Executes a SELECT query with user-defined return type.
         *
         * Runs a SELECT query and returns typed rows. The return type is generic,
         * allowing users to specify the expected row structure for type-safe access.
         *
         * @example
         * ```ts
         * const UserRowType = StructType({
         *     id: IntegerType,
         *     name: StringType,
         * });
         *
         * const getUsers = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         path: ":memory:",
         *         readOnly: variant('none', null),
         *         memory: variant('some', true),
         *     });
         *     const conn = $.let(SQL.SQLite.connect(config));
         *
         *     // Create table and insert data
         *     $(SQL.SQLite.query(conn, "CREATE TABLE users (id INTEGER, name TEXT)", []));
         *     $(SQL.SQLite.query(conn, "INSERT INTO users VALUES (1, 'Alice')", []));
         *
         *     // Query with typed results
         *     const users = $.let(SQL.SQLite.select([UserRowType], conn,
         *         "SELECT id, name FROM users",
         *         []
         *     ));
         *     // users is typed as Array<{ id: bigint, name: string }>
         *
         *     $(SQL.SQLite.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUsers.toIR(), SQL.SQLite.Implementation);
         * await compiled();
         * ```
         */
        select: sqlite_select,

        /**
         * Closes the SQLite database connection.
         *
         * Releases all resources associated with the connection.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         path: "./mydb.sqlite",
         *         readOnly: variant('none', null),
         *         memory: variant('none', null),
         *     });
         *     const conn = $.let(SQL.SQLite.connect(config));
         *     // ... do work ...
         *     $(SQL.SQLite.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), SQL.SQLite.Implementation);
         * await compiled();
         * ```
         */
        close: sqlite_close,

        /**
         * Closes all SQLite connections.
         *
         * Closes all active SQLite connections and releases all resources.
         * Useful for test cleanup to ensure all connections are closed.
         *
         * @returns Null on success
         *
         * @example
         * ```ts
         * const cleanupAll = East.function([], NullType, $ => {
         *     // ... test code that may have left connections open ...
         *     $(SQL.SQLite.closeAll());
         *     return $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanupAll.toIR(), SQL.SQLite.Implementation);
         * await compiled();
         * ```
         *
         * @internal
         */
        closeAll: sqlite_close_all,

        /**
         * Node.js implementation of SQLite platform functions.
         *
         * Pass this to East.compileAsync() to enable SQLite operations.
         */
        Implementation: SqliteImpl,

        /**
         * Type definitions for SQLite operations.
         */
        Types: {
            /**
             * SQLite connection configuration type.
             */
            Config: SqliteConfigType,

            /**
             * SQL query parameter value type.
             */
            Parameter: SqlParameterType,

            /**
             * Array of SQL query parameters.
             */
            Parameters: SqlParametersType,

            /**
             * SQL query result row type.
             */
            Row: SqlRowType,

            /**
             * SQL query execution result type.
             */
            Result: SqlResultType,
        },
    },

    /**
     * PostgreSQL database operations.
     *
     * Provides platform functions for PostgreSQL with connection pooling.
     */
    Postgres: {
        /**
         * Connects to a PostgreSQL database.
         *
         * Creates a connection pool to a PostgreSQL database and returns an
         * opaque handle for use in queries.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 5432n,
         *         database: "myapp",
         *         user: "postgres",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.Postgres.connect(config));
         *     $(SQL.Postgres.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = $1",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.Postgres.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.Postgres.Implementation);
         * await compiled(42n);
         * ```
         */
        connect: postgres_connect,

        /**
         * Executes a SQL query with parameters.
         *
         * Runs a SQL query with parameter binding using $1, $2, etc. placeholders.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 5432n,
         *         database: "myapp",
         *         user: "postgres",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.Postgres.connect(config));
         *     $(SQL.Postgres.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = $1",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.Postgres.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.Postgres.Implementation);
         * await compiled(42n);
         * ```
         */
        query: postgres_query,

        /**
         * Executes a SELECT query with user-defined return type.
         *
         * Runs a SELECT query and returns typed rows. The return type is generic,
         * allowing users to specify the expected row structure for type-safe access.
         *
         * @example
         * ```ts
         * const UserRowType = StructType({
         *     id: IntegerType,
         *     name: StringType,
         * });
         *
         * const getUsers = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 5432n,
         *         database: "myapp",
         *         user: "postgres",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.Postgres.connect(config));
         *
         *     // Query with typed results
         *     const users = $.let(SQL.Postgres.select([UserRowType], conn,
         *         "SELECT id, name FROM users",
         *         []
         *     ));
         *     // users is typed as Array<{ id: bigint, name: string }>
         *
         *     $(SQL.Postgres.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUsers.toIR(), SQL.Postgres.Implementation);
         * await compiled();
         * ```
         */
        select: postgres_select,

        /**
         * Closes the PostgreSQL connection pool.
         *
         * Terminates all connections and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 5432n,
         *         database: "myapp",
         *         user: "postgres",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.Postgres.connect(config));
         *     // ... do work ...
         *     $(SQL.Postgres.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), SQL.Postgres.Implementation);
         * await compiled();
         * ```
         */
        close: postgres_close,

        /**
         * Closes all PostgreSQL connections.
         *
         * Closes all active PostgreSQL connection pools and releases all resources.
         * Useful for test cleanup to ensure all connections are closed.
         *
         * @returns Null on success
         *
         * @example
         * ```ts
         * const cleanupAll = East.function([], NullType, $ => {
         *     // ... test code that may have left connections open ...
         *     $(SQL.Postgres.closeAll());
         *     return $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanupAll.toIR(), SQL.Postgres.Implementation);
         * await compiled();
         * ```
         *
         * @internal
         */
        closeAll: postgres_close_all,

        /**
         * Node.js implementation of PostgreSQL platform functions.
         *
         * Pass this to East.compileAsync() to enable PostgreSQL operations.
         */
        Implementation: PostgresImpl,

        /**
         * Type definitions for PostgreSQL operations.
         */
        Types: {
            /**
             * PostgreSQL connection configuration type.
             */
            Config: PostgresConfigType,

            /**
             * SQL query parameter value type.
             */
            Parameter: SqlParameterType,

            /**
             * Array of SQL query parameters.
             */
            Parameters: SqlParametersType,

            /**
             * SQL query result row type.
             */
            Row: SqlRowType,

            /**
             * SQL query execution result type.
             */
            Result: SqlResultType,
        },
    },

    /**
     * MySQL database operations.
     *
     * Provides platform functions for MySQL with connection pooling.
     */
    MySQL: {
        /**
         * Connects to a MySQL database.
         *
         * Creates a connection pool to a MySQL database and returns an
         * opaque handle for use in queries.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 3306n,
         *         database: "myapp",
         *         user: "root",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.MySQL.connect(config));
         *     $(SQL.MySQL.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = ?",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.MySQL.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.MySQL.Implementation);
         * await compiled(42n);
         * ```
         */
        connect: mysql_connect,

        /**
         * Executes a SQL query with parameters.
         *
         * Runs a SQL query with parameter binding using ? placeholders.
         *
         * @example
         * ```ts
         * const getUser = East.function([IntegerType], NullType, ($, userId) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 3306n,
         *         database: "myapp",
         *         user: "root",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.MySQL.connect(config));
         *     $(SQL.MySQL.query(
         *         conn,
         *         "SELECT name FROM users WHERE id = ?",
         *         [variant('Integer', userId)]
         *     ));
         *     $(SQL.MySQL.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUser.toIR(), SQL.MySQL.Implementation);
         * await compiled(42n);
         * ```
         */
        query: mysql_query,

        /**
         * Executes a SELECT query with user-defined return type.
         *
         * Runs a SELECT query and returns typed rows. The return type is generic,
         * allowing users to specify the expected row structure for type-safe access.
         *
         * @example
         * ```ts
         * const UserRowType = StructType({
         *     id: IntegerType,
         *     name: StringType,
         * });
         *
         * const getUsers = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 3306n,
         *         database: "myapp",
         *         user: "root",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.MySQL.connect(config));
         *
         *     // Query with typed results
         *     const users = $.let(SQL.MySQL.select([UserRowType], conn,
         *         "SELECT id, name FROM users",
         *         []
         *     ));
         *     // users is typed as Array<{ id: bigint, name: string }>
         *
         *     $(SQL.MySQL.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(getUsers.toIR(), SQL.MySQL.Implementation);
         * await compiled();
         * ```
         */
        select: mysql_select,

        /**
         * Closes the MySQL connection pool.
         *
         * Terminates all connections and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 3306n,
         *         database: "myapp",
         *         user: "root",
         *         password: "secret",
         *         ssl: variant('none', null),
         *         maxConnections: variant('none', null),
         *     });
         *     const conn = $.let(SQL.MySQL.connect(config));
         *     // ... do work ...
         *     $(SQL.MySQL.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), SQL.MySQL.Implementation);
         * await compiled();
         * ```
         */
        close: mysql_close,

        /**
         * Closes all MySQL connections.
         *
         * Closes all active MySQL connection pools and releases all resources.
         * Useful for test cleanup to ensure all connections are closed.
         *
         * @returns Null on success
         *
         * @example
         * ```ts
         * const cleanupAll = East.function([], NullType, $ => {
         *     // ... test code that may have left connections open ...
         *     $(SQL.MySQL.closeAll());
         *     return $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanupAll.toIR(), SQL.MySQL.Implementation);
         * await compiled();
         * ```
         *
         * @internal
         */
        closeAll: mysql_close_all,

        /**
         * Node.js implementation of MySQL platform functions.
         *
         * Pass this to East.compileAsync() to enable MySQL operations.
         */
        Implementation: MySqlImpl,

        /**
         * Type definitions for MySQL operations.
         */
        Types: {
            /**
             * MySQL connection configuration type.
             */
            Config: MySqlConfigType,

            /**
             * SQL query parameter value type.
             */
            Parameter: SqlParameterType,

            /**
             * Array of SQL query parameters.
             */
            Parameters: SqlParametersType,

            /**
             * SQL query result row type.
             */
            Row: SqlRowType,

            /**
             * SQL query execution result type.
             */
            Result: SqlResultType,
        },
    },

    /**
     * Microsoft Access database operations.
     *
     * Provides read-only platform functions for Access databases (.mdb, .accdb).
     * Supports Access 97 through Access 2019, including encrypted databases.
     */
    Access: {
        /**
         * Opens a Microsoft Access database file.
         *
         * Opens an Access database file and returns an opaque handle for use in queries.
         *
         * @example
         * ```ts
         * const listTables = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         path: "./database.mdb",
         *         password: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.Access.open(config));
         *     const tables = $.let(SQL.Access.tables(conn));
         *     $(SQL.Access.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(listTables.toIR(), SQL.Access.Implementation);
         * await compiled();
         * ```
         */
        open: access_open,

        /**
         * Lists all table names in an Access database.
         *
         * Returns an array of normal table names (not system or linked tables).
         *
         * @example
         * ```ts
         * const showTables = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         path: "./database.mdb",
         *         password: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.Access.open(config));
         *     const result = $.let(SQL.Access.tables(conn));
         *     // result.tables contains ['Table1', 'Table2', ...]
         *     $(SQL.Access.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(showTables.toIR(), SQL.Access.Implementation);
         * await compiled();
         * ```
         */
        tables: access_tables,

        /**
         * Queries data from an Access database table with a user-defined return type.
         *
         * Reads rows from a specified table with optional column selection and pagination.
         * The return type is generic, allowing users to specify the expected row structure.
         *
         * @typeParam T - The expected row type for query results
         *
         * @example
         * ```ts
         * // Define the expected row type
         * const UserRowType = StructType({
         *     id: IntegerType,
         *     name: StringType,
         *     email: StringType,
         * });
         *
         * const queryUsers = East.function([], NullType, ($) => {
         *     const config = $.let({
         *         path: "./database.mdb",
         *         password: variant('none', null),
         *     });
         *
         *     const conn = $.let(SQL.Access.open(config));
         *     // Query with typed results - returns Array<UserRowType>
         *     const users = $.let(SQL.Access.query([UserRowType], conn, {
         *         table: "Users",
         *         columns: variant('some', ["id", "name", "email"]),
         *         rowOffset: variant('none', null),
         *         rowLimit: variant('some', 100n),
         *     }));
         *     // users is typed as Array<{ id: bigint, name: string, email: string }>
         *     $(SQL.Access.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(queryUsers.toIR(), SQL.Access.Implementation);
         * await compiled();
         * ```
         */
        query: access_query,

        /**
         * Closes an Access database connection.
         *
         * Releases all resources associated with the connection.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         path: "./database.mdb",
         *         password: variant('none', null),
         *     });
         *     const conn = $.let(SQL.Access.open(config));
         *     // ... do work ...
         *     $(SQL.Access.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), SQL.Access.Implementation);
         * await compiled();
         * ```
         */
        close: access_close,

        /**
         * Closes all Access database connections.
         *
         * Closes all active Access connections and releases all resources.
         * Useful for test cleanup to ensure all connections are closed.
         *
         * @returns Null on success
         *
         * @example
         * ```ts
         * const cleanupAll = East.function([], NullType, $ => {
         *     // ... test code that may have left connections open ...
         *     $(SQL.Access.closeAll());
         *     return $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanupAll.toIR(), SQL.Access.Implementation);
         * await compiled();
         * ```
         *
         * @internal
         */
        closeAll: access_close_all,

        /**
         * Node.js implementation of Access platform functions.
         *
         * Pass this to East.compileAsync() to enable Access operations.
         */
        Implementation: AccessImpl,

        /**
         * Type definitions for Access operations.
         */
        Types: {
            /**
             * Access connection configuration type.
             */
            Config: AccessConfigType,

            /**
             * Access query options type.
             */
            QueryOptions: AccessQueryOptionsType,

            /**
             * Access tables list result type.
             */
            TablesResult: AccessTablesResultType,
        },
    },
} as const;