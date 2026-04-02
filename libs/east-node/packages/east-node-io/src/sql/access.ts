/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Microsoft Access platform functions for East Node IO.
 *
 * Provides read-only Access database operations for East programs, including
 * opening databases, listing tables, and querying table data with user-defined
 * return types.
 *
 * Uses the mdb-reader library which supports Access 97 through Access 2019,
 * including encrypted databases.
 *
 * **Important**: This module is read-only. The mdb-reader library cannot create
 * or modify Access databases.
 *
 * Supported formats:
 * - `.mdb` - Access 97, 2000, 2002/2003
 * - `.accdb` - Access 2007, 2010, 2013, 2016, 2019
 *
 * @packageDocumentation
 */

import { ArrayType, BlobType, BooleanType, DateTimeType, East, FloatType, IntegerType, isTypeValueEqual, NullType, OptionType, StringType, toEastTypeValue, variant } from "@elaraai/east";
import type { EastType, StructTypeValue, ValueTypeOf } from "@elaraai/east";
import type { EastTypeValue, PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import MDBReader from 'mdb-reader';
import { readFileSync } from 'fs';
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import {
    AccessConfigType,
    AccessQueryOptionsType,
    AccessTablesResultType,
    ConnectionHandleType,
} from './types.js';

/**
 * Opens a Microsoft Access database file.
 *
 * Opens an Access database file (.mdb or .accdb) and returns an opaque handle
 * for use in queries. Supports Access 97 through Access 2019, including
 * encrypted databases.
 *
 * This is a platform function for the East language, enabling Access database
 * read operations in East programs running on Node.js.
 *
 * @param config - Access connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails due to:
 * - Invalid file path (location: "access_open")
 * - File not found (location: "access_open")
 * - Invalid password for encrypted database (location: "access_open")
 * - Unsupported database format (location: "access_open")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
 *
 * @remarks
 * - Access databases are read-only (mdb-reader does not support writes)
 * - Supports encrypted databases with password option
 * - Database file is read entirely into memory on open
 */
export const access_open = East.asyncPlatform("access_open", [AccessConfigType], ConnectionHandleType);

/**
 * Lists all table names in an Access database.
 *
 * Returns an array of table names available in the database.
 * Only returns normal tables (not system or linked tables).
 *
 * @param handle - Connection handle from access_open()
 * @returns Object containing array of table names
 *
 * @throws {EastError} When operation fails due to:
 * - Invalid connection handle (location: "access_tables")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
export const access_tables = East.asyncPlatform("access_tables", [ConnectionHandleType], AccessTablesResultType);

/**
 * Queries data from an Access database table with a user-defined return type.
 *
 * Reads rows from a specified table with optional column selection and pagination.
 * The return type is generic, allowing users to specify the expected row structure
 * for type-safe access to query results.
 *
 * This is a generic platform function for the East language, enabling type-safe
 * Access database read operations in East programs running on Node.js.
 *
 * @typeParam T - The expected row type for query results
 * @param handle - Connection handle from access_open()
 * @param options - Query options including table name, columns, offset, and limit
 * @returns Array of rows matching the specified type T
 *
 * @throws {EastError} When query fails due to:
 * - Invalid connection handle (location: "access_query")
 * - Table not found (location: "access_query")
 * - Column not found (location: "access_query")
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
 *
 * @remarks
 * - Table names are case-sensitive
 * - The row type T should match the structure of the queried columns
 * - All Access data types are mapped to appropriate East types
 * - NULL values are preserved in the result
 */
export const access_query = East.asyncGenericPlatform(
    "access_query",
    ["T"],
    [ConnectionHandleType, AccessQueryOptionsType],
    ArrayType("T")
);

/**
 * Closes an Access database connection.
 *
 * Closes the database connection and releases all resources.
 * The handle becomes invalid after this operation.
 *
 * @param handle - Connection handle from access_open()
 *
 * @throws {EastError} When handle is invalid (location: "access_close")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
 * const cleanup = East.function([], NullType, $ => {
 *     const config = $.let({
 *         path: "./database.mdb",
 *         password: variant('none', null),
 *     });
 *     const conn = $.let(SQL.Access.open(config));
 *     // ... do work ...
 *     $(SQL.Access.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), SQL.Access.Implementation);
 * await compiled();
 * ```
 */
export const access_close = East.asyncPlatform("access_close", [ConnectionHandleType], NullType);

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
 * import { East, NullType } from "@elaraai/east";
 * import { SQL } from "@elaraai/east-node-io";
 *
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
export const access_close_all = East.asyncPlatform("access_close_all", [], NullType);

/**
 * Node.js implementation of Access platform functions.
 *
 * Provides the runtime implementations for Access database operations.
 * Pass this to East.compileAsync() to enable Access functionality.
 */
export const AccessImpl: PlatformFunction[] = [
    access_open.implement(async (config: ValueTypeOf<typeof AccessConfigType>): Promise<string> => {
        try {
            const path = config.path;
            const password = config.password?.type === 'some' ? config.password.value : undefined;

            // Read the database file into a buffer
            const buffer = readFileSync(path);

            // Create the MDB reader with optional password
            const readerOptions = password ? { password } : undefined;
            const reader = new MDBReader(buffer, readerOptions);

            return await Promise.resolve(createHandle(reader, async () => {
                // mdb-reader doesn't have a close method, but we clean up the handle
                await Promise.resolve();
            }));
        } catch (err: any) {
            throw new EastError(`Access database open failed: ${err.message}`, {
                location: [{ filename: "access_open", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    access_tables.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>): Promise<ValueTypeOf<typeof AccessTablesResultType>> => {
        try {
            const reader = await Promise.resolve(getConnection<MDBReader>(handle));

            // Get only normal tables (not system or linked tables)
            const tables = reader.getTableNames({
                normalTables: true,
                systemTables: false,
                linkedTables: false
            });

            return { tables };
        } catch (err: any) {
            throw new EastError(`Access tables list failed: ${err.message}`, {
                location: [{ filename: "access_tables", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    access_query.implement((T: EastTypeValue) => async (...args: unknown[]): Promise<unknown> => {
        const handle = args[0] as string;
        const options = args[1] as ValueTypeOf<typeof AccessQueryOptionsType>;
        const rowType = T as EastType;

        try {
            const reader = await Promise.resolve(getConnection<MDBReader>(handle));

            const tableName = options.table;
            const columns = options.columns?.type === 'some' ? options.columns.value : undefined;
            const rowOffset = options.rowOffset?.type === 'some' ? Number(options.rowOffset.value) : undefined;
            const rowLimit = options.rowLimit?.type === 'some' ? Number(options.rowLimit.value) : undefined;

            // Get the table
            const table = reader.getTable(tableName);

            // Get column metadata for type validation and conversion
            const columnDefs = table.getColumns();
            const columnMetaMap = new Map<string, { type: string; nullable: boolean }>();
            for (const col of columnDefs) {
                columnMetaMap.set(col.name, { type: col.type, nullable: col.nullable });
            }

            // Validate that the expected row type matches the Access column metadata
            if (rowType.type !== 'Struct') {
                throw new EastError(
                    `Expected row type must be a Struct, got ${rowType.type}`,
                    { location: [{ filename: "access_query", line: 0n, column: 0n }] }
                );
            }

            // Note: T is EastTypeValue (IR format), not EastType (runtime format)
            const structTypeValue = rowType as unknown as StructTypeValue;
            for (const field of structTypeValue.value) {
                const fieldName = field.name;
                const fieldType = field.type;
                const colMeta = columnMetaMap.get(fieldName);
                if (!colMeta) {
                    throw new EastError(
                        `Column '${fieldName}' not found in table '${tableName}'`,
                        { location: [{ filename: "access_query", line: 0n, column: 0n }] }
                    );
                }

                // Determine expected East type based on Access column type
                let expectedBaseType: EastType;
                switch (colMeta.type) {
                    case 'boolean':
                        expectedBaseType = BooleanType;
                        break;
                    case 'byte':
                    case 'integer':
                    case 'long':
                    case 'bigint':
                        expectedBaseType = IntegerType;
                        break;
                    case 'float':
                    case 'double':
                        expectedBaseType = FloatType;
                        break;
                    case 'text':
                    case 'memo':
                    case 'currency':
                    case 'numeric':
                    case 'repid':
                    case 'datetimeextended':
                        expectedBaseType = StringType;
                        break;
                    case 'datetime':
                        expectedBaseType = DateTimeType;
                        break;
                    case 'binary':
                    case 'ole':
                        expectedBaseType = BlobType;
                        break;
                    default:
                        throw new EastError(
                            `Unsupported Access column type '${colMeta.type}' for column '${fieldName}'`,
                            { location: [{ filename: "access_query", line: 0n, column: 0n }] }
                        );
                }

                // Check type matches, accounting for nullable columns
                const expectedType = colMeta.nullable ? OptionType(expectedBaseType) : expectedBaseType;
                if (!isTypeValueEqual(fieldType, toEastTypeValue(expectedType))) {
                    const expectedTypeName = colMeta.nullable
                        ? `OptionType(${expectedBaseType.type})`
                        : expectedBaseType.type;
                    throw new EastError(
                        `Type mismatch for column '${fieldName}': Access column is ${colMeta.type}${colMeta.nullable ? ' (nullable)' : ''}, got ${fieldType.type} but expected East type ${expectedTypeName}`,
                        { location: [{ filename: "access_query", line: 0n, column: 0n }] }
                    );
                }
            }

            // Get data with options
            const dataOptions: { columns?: string[]; rowOffset?: number; rowLimit?: number } = {};
            if (columns) dataOptions.columns = columns;
            if (rowOffset !== undefined) dataOptions.rowOffset = rowOffset;
            if (rowLimit !== undefined) dataOptions.rowLimit = rowLimit;

            const rawData = table.getData(dataOptions);

            // Convert mdb-reader types to East types based on column metadata
            // mdb-reader returns: integer/long/byte → number, binary/ole → Buffer
            // East expects: IntegerType → bigint, BlobType → Uint8Array
            const data = rawData.map((row: Record<string, any>) => {
                const converted: Record<string, any> = {};
                for (const [key, value] of Object.entries(row)) {
                    const colMeta = columnMetaMap.get(key);
                    if (value === null) {
                        // For nullable columns, wrap null in the 'none' variant
                        converted[key] = colMeta?.nullable ? variant('none', null) : null;
                    } else {
                        let convertedValue: any;
                        switch (colMeta?.type) {
                            case 'integer':
                            case 'long':
                            case 'byte':
                                // Convert number to bigint for East IntegerType
                                convertedValue = BigInt(value as number);
                                break;
                            case 'binary':
                            case 'ole':
                                // Convert Buffer to Uint8Array for East BlobType
                                convertedValue = new Uint8Array(value as Buffer);
                                break;
                            default:
                                // datetime → Date, boolean → boolean, float/double → number,
                                // text/memo → string, bigint → bigint (already correct)
                                convertedValue = value;
                        }
                        // For nullable columns, wrap value in the 'some' variant
                        converted[key] = colMeta?.nullable ? variant('some', convertedValue) : convertedValue;
                    }
                }
                return converted;
            });

            // Type validation is already done field-by-field above during column metadata validation
            return data;
        } catch (err: any) {
            if (err instanceof EastError) {
                throw err;
            }
            throw new EastError(`Access query failed: ${err.message}`, {
                location: [{ filename: "access_query", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    access_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            // Verify handle exists (mdb-reader doesn't need explicit close)
            await Promise.resolve(getConnection<MDBReader>(handle));
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`Access close failed: ${err.message}`, {
                location: [{ filename: "access_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    access_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
