/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * PostgreSQL platform functions for East Node IO.
 *
 * Provides PostgreSQL database operations for East programs, including
 * connection pooling and parameterized query execution.
 *
 * @packageDocumentation
 */

import { ArrayType, BlobType, BooleanType, DateTimeType, East, FloatType, IntegerType, isTypeValueEqual, isValueOf, match, NullType, OptionType, SortedMap, StringType as EastStringType, toEastTypeValue, variant } from "@elaraai/east";
import type { EastType, StructTypeValue, ValueTypeOf } from "@elaraai/east";
import type { EastTypeValue, PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import pg from 'pg';
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import {
    PostgresConfigType,
    ConnectionHandleType,
    SqlParametersType,
    SqlResultType,
    StringType,
    SqlParameterType
} from './types.js';

/**
 * PostgreSQL data type OIDs.
 *
 * PostgreSQL uses numeric OIDs to identify column data types.
 * These are the most common OIDs returned by the pg driver.
 *
 * @see https://github.com/postgres/postgres/blob/master/src/include/catalog/pg_type.dat
 * @internal
 */
type PostgresOid =
    | 16   // bool
    | 17   // bytea (blob)
    | 20   // int8 (bigint)
    | 21   // int2 (smallint)
    | 23   // int4 (integer)
    | 25   // text
    | 700  // float4
    | 701  // float8 (double precision)
    | 1042 // bpchar (char)
    | 1043 // varchar
    | 1082 // date
    | 1083 // time
    | 1114 // timestamp
    | 1184 // timestamptz
    | 1700; // numeric/decimal

/**
 * Connects to a PostgreSQL database.
 *
 * Creates a connection pool to a PostgreSQL database and returns an
 * opaque handle for use in queries. The connection pool is managed
 * automatically and supports concurrent queries.
 *
 * This is a platform function for the East language, enabling PostgreSQL database
 * operations in East programs running on Node.js.
 *
 * @param config - PostgreSQL connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails due to:
 * - Network errors (location: "postgres_connect")
 * - Authentication failures (location: "postgres_connect")
 * - Invalid configuration (location: "postgres_connect")
 * - Database does not exist (location: "postgres_connect")
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const getUserById = East.function([IntegerType], NullType, ($, userId) => {
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
 * const compiled = East.compileAsync(getUserById.toIR(), SQL.Postgres.Implementation);
 * await compiled(42n);
 * ```
 *
 * @remarks
 * - Uses connection pooling for better performance
 * - Default pool size is 10 connections
 * - All queries are asynchronous
 * - Connections are automatically returned to the pool after queries
 */
export const postgres_connect = East.asyncPlatform("postgres_connect", [PostgresConfigType], ConnectionHandleType);

/**
 * Executes a SQL query with parameterized values.
 *
 * Runs a SQL query against a PostgreSQL database with parameter binding for
 * safe, injection-free queries. Returns rows as dictionaries mapping column
 * names to typed values, along with metadata about affected rows.
 *
 * This is a platform function for the East language, enabling SQL database
 * operations in East programs running on Node.js.
 *
 * @param handle - Connection handle from postgres_connect()
 * @param sql - SQL query string with $1, $2, etc. placeholders
 * @param params - Query parameters as SqlParameterType array
 * @returns Query results with rows and metadata
 *
 * @throws {EastError} When query fails due to:
 * - Invalid connection handle (location: "postgres_query")
 * - SQL syntax errors (location: "postgres_query")
 * - Connection timeout (location: "postgres_query")
 * - Parameter type mismatch (location: "postgres_query")
 * - Constraint violations (location: "postgres_query")
 *
 * @example
 * ```ts
 * import { East, IntegerType, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const insertUser = East.function([IntegerType], NullType, ($, userId) => {
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
 *     const result = $.let(SQL.Postgres.query(
 *         conn,
 *         "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
 *         [variant('String', "Alice"), variant('String', "alice@example.com")]
 *     ));
 *     $(SQL.Postgres.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(insertUser.toIR(), SQL.Postgres.Implementation);
 * await compiled(42n);
 * ```
 *
 * @remarks
 * - Uses $1, $2, $3, etc. for parameter placeholders
 * - NULL values map to {tag: "null", value: {}}
 * - All queries are asynchronous
 * - Parameters prevent SQL injection attacks
 */
export const postgres_query = East.asyncPlatform("postgres_query", [ConnectionHandleType, StringType, SqlParametersType], SqlResultType);

/**
 * Executes a SELECT query with user-defined return type.
 *
 * Runs a SELECT query against a PostgreSQL database with parameter binding and
 * returns results as an array of typed rows. The return type is generic,
 * allowing users to specify the expected row structure for type-safe access.
 *
 * This is a generic platform function for the East language, enabling type-safe
 * SELECT queries in East programs running on Node.js.
 *
 * @typeParam T - The expected row type for query results
 * @param handle - Connection handle from postgres_connect()
 * @param sql - SQL SELECT query string with $1, $2, etc. placeholders
 * @param params - Query parameters as SqlParameterType array
 * @returns Array of rows matching the specified type T
 *
 * @throws {EastError} When query fails due to:
 * - Invalid connection handle (location: "postgres_select")
 * - SQL syntax errors (location: "postgres_select")
 * - Query is not a SELECT (location: "postgres_select")
 * - Type coercion failure (location: "postgres_select")
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
 *         port: 5432n,
 *         database: "myapp",
 *         user: "postgres",
 *         password: "secret",
 *         ssl: variant('none', null),
 *         maxConnections: variant('none', null),
 *     });
 *
 *     const conn = $.let(SQL.Postgres.connect(config));
 *
 *     // Query with typed results - returns Array<UserRowType>
 *     const users = $.let(SQL.Postgres.select([UserRowType], conn,
 *         "SELECT id, name, email FROM users WHERE active = $1",
 *         [variant('Boolean', true)]
 *     ));
 *     // users is typed as Array<{ id: bigint, name: string, email: string }>
 *
 *     $(SQL.Postgres.close(conn));
 *     $.return(null);
 * });
 *
 * const compiled = East.compileAsync(queryUsers.toIR(), SQL.Postgres.Implementation);
 * await compiled();
 * ```
 *
 * @remarks
 * - Only SELECT queries are supported (use postgres_query for INSERT/UPDATE/DELETE)
 * - Uses $1, $2, $3, etc. for parameter placeholders
 * - Row type T should match the structure of selected columns
 * - All PostgreSQL data types are mapped to appropriate East types
 * - NULL values are preserved in the result
 */
export const postgres_select = East.asyncGenericPlatform(
    "postgres_select",
    ["T"],
    [ConnectionHandleType, StringType, SqlParametersType],
    ArrayType("T")
);

/**
 * Closes a PostgreSQL connection pool.
 *
 * Closes the connection pool and releases all resources.
 * All active connections are terminated gracefully.
 *
 * @param handle - Connection handle from postgres_connect()
 *
 * @throws {EastError} When handle is invalid (location: "postgres_close")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), SQL.Postgres.Implementation);
 * await compiled();
 * ```
 */
export const postgres_close = East.asyncPlatform("postgres_close", [ConnectionHandleType], NullType);

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
 * import { East, NullType } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
export const postgres_close_all = East.asyncPlatform("postgres_close_all", [], NullType);

/**
 * Converts East SQL parameter to native JavaScript value.
 *
 * @param param - East SQL parameter variant
 * @returns JavaScript value for PostgreSQL binding
 * @internal
 */
function convertParamToNative(param: ValueTypeOf<typeof SqlParameterType>): any {
    return match(param, {
        String: (value) => value,
        Integer: (value) => Number(value),  // PostgreSQL client handles numbers
        Float: (value) => value,
        Boolean: (value) => value,
        Null: (value) => value,
        Blob: (value) => Buffer.from(value),  // Convert Uint8Array to Buffer
        DateTime: (value) => value,  // Pass Date object directly to PostgreSQL
    })
}

/**
 * Converts native JavaScript value to East SQL parameter variant.
 *
 * @param value - Native JavaScript value from PostgreSQL
 * @param columnOid - PostgreSQL column OID from field metadata
 * @returns East SQL parameter variant
 * @internal
 */
function convertNativeToParam(value: any, columnOid: PostgresOid | null): ValueTypeOf<typeof SqlParameterType> {
    if (isValueOf(value, NullType)) {
        return variant('Null', null);
    } else if (
        (
            (columnOid === null) &&
            isValueOf(value, BooleanType)
        ) || (
            (columnOid === 16) &&  // bool
            isValueOf(value, BooleanType)
        )
    ) {
        return variant('Boolean', value);
    } else if (
        (
            (columnOid === null) &&
            isValueOf(value, IntegerType)
        ) || (
            (columnOid === 20 || columnOid === 21 || columnOid === 23) &&  // int8, int2, int4
            (isValueOf(value, IntegerType) || isValueOf(value, FloatType))
        )
    ) {
        return variant('Integer', BigInt(value));
    } else if (
        (columnOid === 700 || columnOid === 701 || columnOid === 1700 || columnOid === null) &&  // float4, float8, numeric
        isValueOf(value, FloatType)
    ) {
        return variant('Float', value);
    } else if (
        (columnOid === 25 || columnOid === 1042 || columnOid === 1043 || columnOid === null) &&  // text, bpchar, varchar
        isValueOf(value, EastStringType)
    ) {
        return variant('String', value);
    } else if (
        (
            (columnOid === null) &&
            isValueOf(value, DateTimeType)
        ) || (
            (columnOid === 1082 || columnOid === 1083 || columnOid === 1114 || columnOid === 1184) &&  // date, time, timestamp, timestamptz
            isValueOf(value, DateTimeType)
        )
    ) {
        return variant('DateTime', value);
    } else if (
        (columnOid === 17 || columnOid === null) &&  // bytea
        isValueOf(value, BlobType)
    ) {
        return variant('Blob', value);
    } else {
        return variant('Null', null);
    }
}

/**
 * Node.js implementation of PostgreSQL platform functions.
 *
 * Provides the runtime implementations for PostgreSQL operations.
 * Pass this to East.compileAsync() to enable PostgreSQL functionality.
 */
export const PostgresImpl: PlatformFunction[] = [
    postgres_connect.implement(async (config: ValueTypeOf<typeof PostgresConfigType>) => {
        try {
            const poolConfig: pg.PoolConfig = {
                host: config.host,
                port: Number(config.port),
                database: config.database,
                user: config.user,
                password: config.password,
            };

            // Handle optional SSL
            if (config.ssl?.type === 'some' && config.ssl.value) {
                poolConfig.ssl = { rejectUnauthorized: false };
            }

            // Handle optional max connections
            if (config.maxConnections?.type === 'some') {
                poolConfig.max = Number(config.maxConnections.value);
            }

            const pool = new pg.Pool(poolConfig);

            // Test the connection
            const client = await pool.connect();
            client.release();

            return createHandle(pool, async () => {
                await pool.end();
            });
        } catch (err: any) {
            throw new EastError(`PostgreSQL connection failed: ${err.message}`, {
                location: [{ filename: "postgres_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    postgres_query.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        sql: ValueTypeOf<typeof StringType>,
        params: ValueTypeOf<typeof SqlParametersType>
    ): Promise<ValueTypeOf<typeof SqlResultType>> => {
        try {
            const pool = getConnection<pg.Pool>(handle);

            // Convert East parameters to native values
            const nativeParams = params.map(convertParamToNative);

            // Execute the query
            const result = await pool.query(sql, nativeParams);

            // Validate result structure
            if (!result || typeof result !== 'object') {
                throw new EastError('Invalid result from PostgreSQL query', {
                    location: [{ filename: "postgres_query", line: 0n, column: 0n }]
                });
            }

            if (!Array.isArray(result.rows)) {
                throw new EastError('PostgreSQL query result missing rows array', {
                    location: [{ filename: "postgres_query", line: 0n, column: 0n }]
                });
            }

            // PostgreSQL provides a `command` field indicating query type
            const command = result.command?.toUpperCase();

            if (command === 'SELECT') {
                // Get column metadata for type information
                const columnOidMap = new SortedMap<string, PostgresOid | null>();
                if (result.fields) {
                    for (const field of result.fields) {
                        columnOidMap.set(field.name, field.dataTypeID as PostgresOid | null);
                    }
                }

                // Convert rows to East format (SortedMap objects)
                const eastRows = result.rows.map((row: any) => {
                    const eastRow = new SortedMap<string, any>();
                    for (const [key, value] of Object.entries(row)) {
                        const columnOid = columnOidMap.get(key) || null;
                        eastRow.set(key, convertNativeToParam(value, columnOid));
                    }
                    return eastRow;
                });

                return variant('select', { rows: eastRows }) as any;
            } else if (command === 'INSERT') {
                return variant('insert', {
                    rowsAffected: BigInt(result.rowCount ?? 0),
                    lastInsertId: variant('none', null)  // PostgreSQL doesn't provide lastInsertId automatically
                }) as any;
            } else if (command === 'UPDATE') {
                return variant('update', {
                    rowsAffected: BigInt(result.rowCount ?? 0)
                }) as any;
            } else if (command === 'DELETE') {
                return variant('delete', {
                    rowsAffected: BigInt(result.rowCount ?? 0)
                }) as any;
            } else {
                // For other commands (CREATE, DROP, ALTER, etc.), return as select with empty rows
                // This maintains compatibility with DDL statements
                return variant('select', { rows: [] }) as any;
            }
        } catch (err: any) {
            throw new EastError(`PostgreSQL query failed: ${err.message}`, {
                location: [{ filename: "postgres_query", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    postgres_select.implement((T: EastTypeValue) => async (...args: unknown[]): Promise<unknown> => {
        const handle = args[0] as string;
        const sql = args[1] as string;
        const params = args[2] as ValueTypeOf<typeof SqlParametersType>;
        const rowType = T as EastType;

        try {
            const pool = getConnection<pg.Pool>(handle);

            // Validate row type is a Struct
            if (rowType.type !== 'Struct') {
                throw new EastError(
                    `Expected row type must be a Struct, got ${rowType.type}`,
                    { location: [{ filename: "postgres_select", line: 0n, column: 0n }] }
                );
            }

            // Convert East parameters to native values
            const nativeParams = params.map(convertParamToNative);

            // Execute the query
            const result = await pool.query(sql, nativeParams);

            // Verify this is a SELECT query
            const command = result.command?.toUpperCase();
            if (command !== 'SELECT') {
                throw new EastError('postgres_select only supports SELECT queries. Use postgres_query for INSERT/UPDATE/DELETE.', {
                    location: [{ filename: "postgres_select", line: 0n, column: 0n }]
                });
            }

            if (!Array.isArray(result.rows)) {
                throw new EastError('PostgreSQL query result missing rows array', {
                    location: [{ filename: "postgres_select", line: 0n, column: 0n }]
                });
            }

            // Get column metadata
            const columnMetaMap = new Map<string, { oid: PostgresOid | null }>();
            if (result.fields) {
                for (const field of result.fields) {
                    columnMetaMap.set(field.name, { oid: field.dataTypeID as PostgresOid | null });
                }
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
                        { location: [{ filename: "postgres_select", line: 0n, column: 0n }] }
                    );
                }

                // Determine expected base type from PostgreSQL OID
                let expectedBaseType: EastType;
                const oid = colMeta.oid;
                if (oid === 16) { // bool
                    expectedBaseType = BooleanType;
                } else if (oid === 20 || oid === 21 || oid === 23) { // int8, int2, int4
                    expectedBaseType = IntegerType;
                } else if (oid === 700 || oid === 701 || oid === 1700) { // float4, float8, numeric
                    expectedBaseType = FloatType;
                } else if (oid === 25 || oid === 1042 || oid === 1043) { // text, bpchar, varchar
                    expectedBaseType = EastStringType;
                } else if (oid === 1082 || oid === 1083 || oid === 1114 || oid === 1184) { // date, time, timestamp, timestamptz
                    expectedBaseType = DateTimeType;
                } else if (oid === 17) { // bytea
                    expectedBaseType = BlobType;
                } else {
                    // Unknown OID - skip type validation, rely on isValueOf later
                    fieldInfo.set(fieldName, { isOption: false, expectedBaseType: IntegerType });
                    continue;
                }

                // Check if field type matches base type or OptionType(base type)
                const isBase = isTypeValueEqual(fieldType, toEastTypeValue(expectedBaseType));
                const isOption = isTypeValueEqual(fieldType, toEastTypeValue(OptionType(expectedBaseType)));

                if (!isBase && !isOption) {
                    throw new EastError(
                        `Type mismatch for column '${fieldName}': PostgreSQL column OID ${oid}, got ${fieldType.type} but expected ${expectedBaseType.type} or OptionType(${expectedBaseType.type})`,
                        { location: [{ filename: "postgres_select", line: 0n, column: 0n }] }
                    );
                }

                fieldInfo.set(fieldName, { isOption, expectedBaseType });
            }

            // Convert values based on column metadata and handle nulls
            const rows = result.rows.map((row: Record<string, any>, rowIndex: number) => {
                const converted: Record<string, any> = {};
                for (const [key, value] of Object.entries(row)) {
                    const info = fieldInfo.get(key);
                    const colMeta = columnMetaMap.get(key);
                    const oid = colMeta?.oid;

                    if (value === null) {
                        if (info?.isOption) {
                            converted[key] = variant('none', null);
                        } else {
                            throw new EastError(
                                `null value at row[${rowIndex}] for required field '${key}' - use OptionType(${info?.expectedBaseType.type ?? 'T'}) for nullable columns`,
                                { location: [{ filename: "postgres_select", line: 0n, column: 0n }] }
                            );
                        }
                    } else {
                        // Convert based on column OID
                        let convertedValue: any;
                        if (oid === 20 || oid === 21 || oid === 23) { // int8, int2, int4
                            convertedValue = BigInt(value);
                        } else if (oid === 17 && Buffer.isBuffer(value)) { // bytea
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
            throw new EastError(`PostgreSQL select failed: ${err.message}`, {
                location: [{ filename: "postgres_select", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    postgres_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const pool = getConnection<pg.Pool>(handle);
            await pool.end();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`PostgreSQL close failed: ${err.message}`, {
                location: [{ filename: "postgres_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    postgres_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
