/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MySQL platform functions for East Node IO.
 *
 * Provides MySQL database operations for East programs, including
 * connection pooling and parameterized query execution.
 *
 * @packageDocumentation
 */

import { ArrayType, BlobType, BooleanType, DateTimeType, East, FloatType, IntegerType, isTypeValueEqual, isValueOf, match, NullType, OptionType, SortedMap, StringType as EastStringType, toEastTypeValue, variant } from "@elaraai/east";
import type { EastType, StructTypeValue, ValueTypeOf } from "@elaraai/east";
import type { EastTypeValue, PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import mysql from 'mysql2/promise';
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import {
    MySqlConfigType,
    ConnectionHandleType,
    SqlParametersType,
    SqlResultType,
    StringType,
    SqlParameterType
} from './types.js';

/**
 * MySQL field type codes.
 *
 * MySQL uses numeric codes to identify column data types.
 * These are the most common type codes returned by the mysql2 driver.
 *
 * @see https://github.com/sidorares/node-mysql2/blob/master/lib/constants/types.js
 * @internal
 */
type MySqlFieldType =
    | 0   // DECIMAL
    | 1   // TINY (TINYINT)
    | 2   // SHORT (SMALLINT)
    | 3   // LONG (INT)
    | 4   // FLOAT
    | 5   // DOUBLE
    | 7   // TIMESTAMP
    | 8   // LONGLONG (BIGINT)
    | 9   // INT24 (MEDIUMINT)
    | 10  // DATE
    | 11  // TIME
    | 12  // DATETIME
    | 13  // YEAR
    | 16  // BIT
    | 246 // NEWDECIMAL
    | 252 // BLOB
    | 253 // VARCHAR
    | 254; // STRING (CHAR)

/**
 * Connects to a MySQL database.
 *
 * Creates a connection pool to a MySQL database and returns an
 * opaque handle for use in queries. The connection pool is managed
 * automatically and supports concurrent queries.
 *
 * This is a platform function for the East language, enabling MySQL database
 * operations in East programs running on Node.js.
 *
 * @param config - MySQL connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails due to:
 * - Network errors (location: "mysql_connect")
 * - Authentication failures (location: "mysql_connect")
 * - Invalid configuration (location: "mysql_connect")
 * - Database does not exist (location: "mysql_connect")
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const getUserById = East.function([IntegerType], NullType, ($, userId) => {
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
 * const compiled = East.compileAsync(getUserById.toIR(), SQL.MySQL.Implementation);
 * await compiled(42n);
 * ```
 *
 * @remarks
 * - Uses connection pooling for better performance
 * - Default pool size is 10 connections
 * - All queries are asynchronous
 * - Connections are automatically returned to the pool after queries
 */
export const mysql_connect = East.asyncPlatform("mysql_connect", [MySqlConfigType], ConnectionHandleType);

/**
 * Executes a SQL query with parameterized values.
 *
 * Runs a SQL query against a MySQL database with parameter binding for
 * safe, injection-free queries. Returns rows as dictionaries mapping column
 * names to typed values, along with metadata about affected rows.
 *
 * This is a platform function for the East language, enabling SQL database
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from mysql_connect()
 * @param sql - SQL query string with ? placeholders
 * @param params - Query parameters as SqlParameterType array
 * @returns Query results with rows and metadata
 *
 * @throws {EastError} When query fails due to:
 * - Invalid connection handle (location: "mysql_query")
 * - SQL syntax errors (location: "mysql_query")
 * - Connection timeout (location: "mysql_query")
 * - Parameter type mismatch (location: "mysql_query")
 * - Constraint violations (location: "mysql_query")
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const insertUser = East.function([IntegerType], NullType, ($, userId) => {
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
 *     const result = $.let(SQL.MySQL.query(
 *         conn,
 *         "INSERT INTO users (name, email) VALUES (?, ?)",
 *         [variant('String', "Alice"), variant('String', "alice@example.com")]
 *     ));
 *     $(SQL.MySQL.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(insertUser.toIR(), SQL.MySQL.Implementation);
 * await compiled(42n);
 * ```
 *
 * @remarks
 * - Uses ? for parameter placeholders (not $1, $2 like PostgreSQL)
 * - NULL values map to {tag: "null", value: {}}
 * - All queries are asynchronous
 * - Parameters prevent SQL injection attacks
 * - Returns lastInsertId for INSERT operations
 */
export const mysql_query = East.asyncPlatform("mysql_query", [ConnectionHandleType, StringType, SqlParametersType], SqlResultType);

/**
 * Executes a SELECT query with user-defined return type.
 *
 * Runs a SELECT query against a MySQL database with parameter binding and
 * returns results as an array of typed rows. The return type is generic,
 * allowing users to specify the expected row structure for type-safe access.
 *
 * This is a generic platform function for the East language, enabling type-safe
 * SELECT queries in East programs running on Node.js.
 *
 * @typeParam T - The expected row type for query results
 * @param handle - Connection handle from mysql_connect()
 * @param sql - SQL SELECT query string with ? placeholders
 * @param params - Query parameters as SqlParameterType array
 * @returns Array of rows matching the specified type T
 *
 * @throws {EastError} When query fails due to:
 * - Invalid connection handle (location: "mysql_select")
 * - SQL syntax errors (location: "mysql_select")
 * - Query is not a SELECT (location: "mysql_select")
 * - Type coercion failure (location: "mysql_select")
 *
 * @example
 * ```ts
 * import { East, NullType, StructType, StringType, IntegerType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * // Define the expected row type
 * const UserRowType = StructType({
 *     id: IntegerType,
 *     name: StringType,
 *     email: StringType,
 * });
 *
 * const queryUsers = East.function([], NullType, ($) => {
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
 *
 *     // Query with typed results - returns Array<UserRowType>
 *     const users = $.let(SQL.MySQL.select([UserRowType], conn,
 *         "SELECT id, name, email FROM users WHERE active = ?",
 *         [variant('Boolean', true)]
 *     ));
 *     // users is typed as Array<{ id: bigint, name: string, email: string }>
 *
 *     $(SQL.MySQL.close(conn));
 *     $.return(null);
 * });
 *
 * const compiled = East.compileAsync(queryUsers.toIR(), SQL.MySQL.Implementation);
 * await compiled();
 * ```
 *
 * @remarks
 * - Only SELECT queries are supported (use mysql_query for INSERT/UPDATE/DELETE)
 * - Uses ? for parameter placeholders
 * - Row type T should match the structure of selected columns
 * - All MySQL data types are mapped to appropriate East types
 * - NULL values are preserved in the result
 */
export const mysql_select = East.asyncGenericPlatform(
    "mysql_select",
    ["T"],
    [ConnectionHandleType, StringType, SqlParametersType],
    ArrayType("T")
);

/**
 * Closes a MySQL connection pool.
 *
 * Closes the connection pool and releases all resources.
 * All active connections are terminated gracefully.
 *
 * @param handle - Connection handle from mysql_connect()
 *
 * @throws {EastError} When handle is invalid (location: "mysql_close")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), SQL.MySQL.Implementation);
 * await compiled();
 * ```
 */
export const mysql_close = East.asyncPlatform("mysql_close", [ConnectionHandleType], NullType);

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
 * import { East, NullType } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
export const mysql_close_all = East.asyncPlatform("mysql_close_all", [], NullType);

/**
 * Converts East SQL parameter to native JavaScript value.
 *
 * @param param - East SQL parameter variant
 * @returns JavaScript value for MySQL binding
 * @internal
 */
function convertParamToNative(param: ValueTypeOf<typeof SqlParameterType>): any {
    return match(param, {
        String: (value) => value,
        Integer: (value) => Number(value),  // MySQL client handles numbers
        Float: (value) => value,
        Boolean: (value) => value,
        Null: (value) => value,
        Blob: (value) => Buffer.from(value),  // Convert Uint8Array to Buffer
        DateTime: (value) => value,  // Pass Date object directly to MySQL
    })
}

/**
 * Converts native JavaScript value to East SQL parameter variant.
 *
 * @param value - Native JavaScript value from MySQL
 * @param fieldType - MySQL field type code from field metadata
 * @returns East SQL parameter variant
 * @internal
 */
function convertNativeToParam(value: any, fieldType: MySqlFieldType | null): ValueTypeOf<typeof SqlParameterType> {
    if (isValueOf(value, NullType)) {
        return variant('Null', null);
    } else if (
        (
            (fieldType === null) &&
            isValueOf(value, BooleanType)
        ) || (
            (fieldType === 1 || fieldType === 16) &&  // TINY (as boolean), BIT
            (isValueOf(value, BooleanType) || isValueOf(value, FloatType))
        )
    ) {
        return variant('Boolean', value ? true : false);
    } else if (
        (
            (fieldType === null) &&
            isValueOf(value, IntegerType)
        ) || (
            (fieldType === 2 || fieldType === 3 || fieldType === 8 || fieldType === 9 || fieldType === 13) &&  // SHORT, LONG, LONGLONG, INT24, YEAR (not TINY=1)
            (isValueOf(value, IntegerType) || isValueOf(value, FloatType))
        )
    ) {
        return variant('Integer', BigInt(value));
    } else if (
        (fieldType === 0 || fieldType === 4 || fieldType === 5 || fieldType === 246 || fieldType === null) &&  // DECIMAL, FLOAT, DOUBLE, NEWDECIMAL
        isValueOf(value, FloatType)
    ) {
        return variant('Float', value);
    } else if (
        (fieldType === 253 || fieldType === 254 || fieldType === null) &&  // VARCHAR, STRING (CHAR)
        isValueOf(value, EastStringType)
    ) {
        return variant('String', value);
    } else if (
        (fieldType === 252 || fieldType === null) &&  // BLOB or TEXT (252 is used for both!)
        isValueOf(value, EastStringType)  // Check string first for TEXT columns
    ) {
        return variant('String', value);
    } else if (
        (
            (fieldType === null) &&
            isValueOf(value, DateTimeType)
        ) || (
            (fieldType === 7 || fieldType === 10 || fieldType === 11 || fieldType === 12) &&  // TIMESTAMP, DATE, TIME, DATETIME
            isValueOf(value, DateTimeType)
        )
    ) {
        return variant('DateTime', value);
    } else if (
        (fieldType === 252 || fieldType === null) &&  // BLOB or TEXT (check Blob after String)
        isValueOf(value, BlobType)
    ) {
        return variant('Blob', value);
    } else {
        return variant('Null', null);
    }
}

/**
 * Node.js implementation of MySQL platform functions.
 *
 * Provides the runtime implementations for MySQL operations.
 * Pass this to East.compileAsync() to enable MySQL functionality.
 */
export const MySqlImpl: PlatformFunction[] = [
    mysql_connect.implement(async (config: ValueTypeOf<typeof MySqlConfigType>) => {
        try {
            const poolConfig: mysql.PoolOptions = {
                host: config.host,
                port: Number(config.port),
                database: config.database,
                user: config.user,
                password: config.password,
            };

            // Handle optional SSL
            if (config.ssl?.type === 'some' && config.ssl.value) {
                poolConfig.ssl = {};
            }

            // Handle optional max connections
            if (config.maxConnections?.type === 'some') {
                poolConfig.connectionLimit = Number(config.maxConnections.value);
            }

            const pool = mysql.createPool(poolConfig);

            // Test the connection
            const connection = await pool.getConnection();
            connection.release();

            return createHandle(pool, async () => {
                await pool.end();
            });
        } catch (err: any) {
            throw new EastError(`MySQL connection failed: ${err.message}`, {
                location: [{ filename: "mysql_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mysql_query.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        sql: ValueTypeOf<typeof StringType>,
        params: ValueTypeOf<typeof SqlParametersType>
    ): Promise<ValueTypeOf<typeof SqlResultType>> => {
        try {
            const pool = getConnection<mysql.Pool>(handle);

            // Convert East parameters to native values
            const nativeParams = params.map(convertParamToNative);

            // Execute the query
            const [rows, fields] = await pool.query(sql, nativeParams);

            // For SELECT queries, fields will contain column metadata and rows will be an array
            // For DML queries (INSERT/UPDATE/DELETE), result will be ResultSetHeader
            // Check using the fields array: SELECT has fields, DML doesn't
            if (Array.isArray(rows) && fields.length > 0) {
                // Get column metadata for type information
                const fieldTypeMap = new SortedMap<string, MySqlFieldType | null>();
                for (const field of fields) {
                    fieldTypeMap.set(field.name, field.type as MySqlFieldType | null);
                }

                // SELECT query - rows is array of RowDataPacket
                const eastRows = rows.map((row: any) => {
                    const eastRow = new SortedMap<string, any>();
                    for (const [key, value] of Object.entries(row)) {
                        const fieldType = fieldTypeMap.get(key) || null;
                        eastRow.set(key, convertNativeToParam(value, fieldType));
                    }
                    return eastRow;
                });

                return variant('select', { rows: eastRows }) as any;
            } else if (!Array.isArray(rows) && typeof rows === 'object' && rows !== null) {
                // DML query - ResultSetHeader
                const result = rows as mysql.ResultSetHeader;

                // Validate ResultSetHeader structure
                if (typeof result.affectedRows !== 'number') {
                    throw new EastError('MySQL ResultSetHeader missing affectedRows', {
                        location: [{ filename: "mysql_query", line: 0n, column: 0n }]
                    });
                }

                // Determine query type from SQL
                const trimmedSql = sql.trim().toUpperCase();

                if (trimmedSql.startsWith('INSERT')) {
                    return variant('insert', {
                        rowsAffected: BigInt(result.affectedRows),
                        lastInsertId: result.insertId && result.insertId > 0
                            ? variant('some', BigInt(result.insertId))
                            : variant('none', null)
                    }) as any;
                } else if (trimmedSql.startsWith('UPDATE')) {
                    return variant('update', {
                        rowsAffected: BigInt(result.affectedRows)
                    }) as any;
                } else if (trimmedSql.startsWith('DELETE')) {
                    return variant('delete', {
                        rowsAffected: BigInt(result.affectedRows)
                    }) as any;
                } else {
                    // Other mutating queries (CREATE, DROP, ALTER, etc.) - treat as update
                    return variant('update', {
                        rowsAffected: BigInt(result.affectedRows)
                    }) as any;
                }
            } else {
                // Unexpected result type
                throw new EastError(`Unexpected result type from MySQL query: ${typeof rows}`, {
                    location: [{ filename: "mysql_query", line: 0n, column: 0n }]
                });
            }
        } catch (err: any) {
            throw new EastError(`MySQL query failed: ${err.message}`, {
                location: [{ filename: "mysql_query", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mysql_select.implement((T: EastTypeValue) => async (...args: unknown[]): Promise<unknown> => {
        const handle = args[0] as string;
        const sql = args[1] as string;
        const params = args[2] as ValueTypeOf<typeof SqlParametersType>;
        const rowType = T as EastType;

        try {
            const pool = getConnection<mysql.Pool>(handle);

            // Validate row type is a Struct
            if (rowType.type !== 'Struct') {
                throw new EastError(
                    `Expected row type must be a Struct, got ${rowType.type}`,
                    { location: [{ filename: "mysql_select", line: 0n, column: 0n }] }
                );
            }

            // Convert East parameters to native values
            const nativeParams = params.map(convertParamToNative);

            // Execute the query
            const [rawRows, fields] = await pool.query(sql, nativeParams);

            // Verify this is a SELECT query (SELECT has fields array with entries)
            if (!Array.isArray(rawRows) || fields.length === 0) {
                throw new EastError('mysql_select only supports SELECT queries. Use mysql_query for INSERT/UPDATE/DELETE.', {
                    location: [{ filename: "mysql_select", line: 0n, column: 0n }]
                });
            }

            // Get column metadata
            const columnMetaMap = new Map<string, { fieldType: MySqlFieldType | null }>();
            for (const field of fields) {
                columnMetaMap.set(field.name, { fieldType: field.type as MySqlFieldType | null });
            }

            // Validate field types and determine which are OptionTypes
            // Note: T is EastTypeValue (IR format), not EastType (runtime format)
            const structTypeValue = rowType as unknown as StructTypeValue;
            const fieldInfo = new Map<string, { isOption: boolean; expectedBaseType: EastType }>();

            for (const field of structTypeValue.value) {
                const fieldName = field.name;
                const fieldType = field.type;
                const colMeta = columnMetaMap.get(fieldName);
                if (!colMeta) {
                    throw new EastError(
                        `Column '${fieldName}' not found in query result`,
                        { location: [{ filename: "mysql_select", line: 0n, column: 0n }] }
                    );
                }

                // Determine expected base type from MySQL field type
                let expectedBaseType: EastType;
                const ft = colMeta.fieldType;
                if (ft === 1 || ft === 16) { // TINY (as boolean), BIT
                    expectedBaseType = BooleanType;
                } else if (ft === 2 || ft === 3 || ft === 8 || ft === 9 || ft === 13) { // SHORT, LONG, LONGLONG, INT24, YEAR
                    expectedBaseType = IntegerType;
                } else if (ft === 0 || ft === 4 || ft === 5 || ft === 246) { // DECIMAL, FLOAT, DOUBLE, NEWDECIMAL
                    expectedBaseType = FloatType;
                } else if (ft === 253 || ft === 254) { // VARCHAR, STRING (CHAR)
                    expectedBaseType = EastStringType;
                } else if (ft === 7 || ft === 10 || ft === 11 || ft === 12) { // TIMESTAMP, DATE, TIME, DATETIME
                    expectedBaseType = DateTimeType;
                } else if (ft === 252) { // BLOB or TEXT (both use 252!)
                    // Field type 252 is ambiguous - used for both TEXT and BLOB
                    // Check if user expects String (TEXT) or Blob
                    const isString = isTypeValueEqual(fieldType, toEastTypeValue(EastStringType));
                    const isStringOption = isTypeValueEqual(fieldType, toEastTypeValue(OptionType(EastStringType)));
                    const isBlob = isTypeValueEqual(fieldType, toEastTypeValue(BlobType));
                    const isBlobOption = isTypeValueEqual(fieldType, toEastTypeValue(OptionType(BlobType)));

                    if (isString || isStringOption) {
                        expectedBaseType = EastStringType;
                    } else if (isBlob || isBlobOption) {
                        expectedBaseType = BlobType;
                    } else {
                        throw new EastError(
                            `Type mismatch for column '${fieldName}': MySQL field type 252 (TEXT/BLOB), got ${fieldType.type} but expected String, Blob, OptionType(String), or OptionType(Blob)`,
                            { location: [{ filename: "mysql_select", line: 0n, column: 0n }] }
                        );
                    }
                    fieldInfo.set(fieldName, { isOption: isStringOption || isBlobOption, expectedBaseType });
                    continue;
                } else {
                    // Unknown field type - skip type validation, rely on isValueOf later
                    fieldInfo.set(fieldName, { isOption: false, expectedBaseType: IntegerType });
                    continue;
                }

                // Check if field type matches base type or OptionType(base type)
                const isBase = isTypeValueEqual(fieldType, toEastTypeValue(expectedBaseType));
                const isOption = isTypeValueEqual(fieldType, toEastTypeValue(OptionType(expectedBaseType)));

                if (!isBase && !isOption) {
                    throw new EastError(
                        `Type mismatch for column '${fieldName}': MySQL field type ${ft}, got ${fieldType.type} but expected ${expectedBaseType.type} or OptionType(${expectedBaseType.type})`,
                        { location: [{ filename: "mysql_select", line: 0n, column: 0n }] }
                    );
                }

                fieldInfo.set(fieldName, { isOption, expectedBaseType });
            }

            // Convert values based on column metadata and handle nulls
            const rows = rawRows.map((row: Record<string, any>, rowIndex: number) => {
                const converted: Record<string, any> = {};
                for (const [key, value] of Object.entries(row)) {
                    const info = fieldInfo.get(key);
                    const colMeta = columnMetaMap.get(key);
                    const ft = colMeta?.fieldType;

                    if (value === null) {
                        if (info?.isOption) {
                            converted[key] = variant('none', null);
                        } else {
                            throw new EastError(
                                `null value at row[${rowIndex}] for required field '${key}' - use OptionType(${info?.expectedBaseType.type ?? 'T'}) for nullable columns`,
                                { location: [{ filename: "mysql_select", line: 0n, column: 0n }] }
                            );
                        }
                    } else {
                        // Convert based on field type
                        let convertedValue: any;
                        if (ft === 2 || ft === 3 || ft === 8 || ft === 9 || ft === 13) { // SHORT, LONG, LONGLONG, INT24, YEAR
                            convertedValue = BigInt(value);
                        } else if (ft === 252 && Buffer.isBuffer(value)) { // BLOB
                            convertedValue = new Uint8Array(value);
                        } else {
                            convertedValue = value;
                        }

                        converted[key] = info?.isOption ? variant('some', convertedValue) : convertedValue;
                    }
                }
                return converted;
            });

            // Type validation is already done field-by-field above during column metadata validation
            return rows;
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`MySQL select failed: ${err.message}`, {
                location: [{ filename: "mysql_select", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mysql_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const pool = getConnection<mysql.Pool>(handle);
            await pool.end();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`MySQL close failed: ${err.message}`, {
                location: [{ filename: "mysql_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mysql_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
