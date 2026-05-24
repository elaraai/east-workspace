/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared SQL type definitions for East Node IO.
 *
 * Provides East type definitions for SQL database operations including
 * connection configurations, query parameters, and result types.
 *
 * @packageDocumentation
 */

import {
    StructType,
    VariantType,
    OptionType,
    ArrayType,
    DictType,
    StringType,
    IntegerType,
    BooleanType,
    BlobType,
} from "@elaraai/east";
import { LiteralValueType } from "@elaraai/east/internal";

// Re-export StringType for use in other SQL modules
export { StringType } from "@elaraai/east";

/**
 * SQLite database connection configuration.
 *
 * Configures a connection to a SQLite database file or in-memory database.
 */
export const SqliteConfigType = StructType({
    /**
     * Path to the SQLite database file.
     * Use ":memory:" for in-memory database.
     */
    path: StringType,

    /**
     * Open database in read-only mode.
     * Optional, defaults to false (read-write).
     */
    readOnly: OptionType(BooleanType),

    /**
     * Use in-memory database.
     * Optional, defaults to false.
     */
    memory: OptionType(BooleanType),
});

/**
 * PostgreSQL database connection configuration.
 *
 * Configures a connection pool to a PostgreSQL database server.
 */
export const PostgresConfigType = StructType({
    /** PostgreSQL server hostname or IP address */
    host: StringType,

    /** PostgreSQL server port (typically 5432) */
    port: IntegerType,

    /** Database name to connect to */
    database: StringType,

    /** Username for authentication */
    user: StringType,

    /** Password for authentication */
    password: StringType,

    /**
     * Enable SSL/TLS connection.
     * Optional, defaults to false.
     */
    ssl: OptionType(BooleanType),

    /**
     * Maximum number of connections in the pool.
     * Optional, defaults to 10.
     */
    maxConnections: OptionType(IntegerType),
});

/**
 * MySQL database connection configuration.
 *
 * Configures a connection pool to a MySQL database server.
 */
export const MySqlConfigType = StructType({
    /** MySQL server hostname or IP address */
    host: StringType,

    /** MySQL server port (typically 3306) */
    port: IntegerType,

    /** Database name to connect to */
    database: StringType,

    /** Username for authentication */
    user: StringType,

    /** Password for authentication */
    password: StringType,

    /**
     * Enable SSL/TLS connection.
     * Optional, defaults to false.
     */
    ssl: OptionType(BooleanType),

    /**
     * Maximum number of connections in the pool.
     * Optional, defaults to 10.
     */
    maxConnections: OptionType(IntegerType),
});

/**
 * SQL query parameter value type.
 *
 * Represents a typed value that can be used as a parameter in SQL queries.
 * Supports all common SQL types with proper type safety.
 *
 * @remarks
 * Use East.variant() to create parameter values:
 * - `East.variant("string", "text")`
 * - `East.variant("int", 42n)`
 * - `East.variant("float", 3.14)`
 * - `East.variant("bool", true)`
 * - `East.variant("null", {})`
 * - `East.variant("blob", new Uint8Array([1, 2, 3]))`
 */
export const SqlParameterType = LiteralValueType;

/**
 * Array of SQL query parameters.
 *
 * Used to pass parameters to parameterized SQL queries.
 */
export const SqlParametersType = ArrayType(SqlParameterType);

/**
 * SQL query result row.
 *
 * Represents a single row from a query result as a dictionary mapping
 * column names to typed values.
 */
export const SqlRowType = DictType(StringType, SqlParameterType);

/**
 * SQL query execution result.
 *
 * A variant type representing different query result types:
 * - `select`: Results from SELECT queries with rows
 * - `insert`: Results from INSERT with affected rows and optional last insert ID
 * - `update`: Results from UPDATE with affected rows
 * - `delete`: Results from DELETE with affected rows
 *
 * @remarks
 * Using variants allows type-safe handling of different query types.
 */
export const SqlResultType = VariantType({
    /**
     * SELECT query result with rows.
     */
    select: StructType({
        /** Array of rows returned by the query */
        rows: ArrayType(SqlRowType),
    }),

    /**
     * INSERT query result with metadata.
     */
    insert: StructType({
        /** Number of rows inserted */
        rowsAffected: IntegerType,
        /** Last inserted row ID (database-specific, may be None) */
        lastInsertId: OptionType(IntegerType),
    }),

    /**
     * UPDATE query result with metadata.
     */
    update: StructType({
        /** Number of rows updated */
        rowsAffected: IntegerType,
    }),

    /**
     * DELETE query result with metadata.
     */
    delete: StructType({
        /** Number of rows deleted */
        rowsAffected: IntegerType,
    }),
});

/**
 * Opaque connection handle type.
 *
 * Represents an active database connection.
 * Handles are created by connect() functions and used in query operations.
 *
 * @internal
 */
export const ConnectionHandleType = StringType;

/**
 * Microsoft Access database connection configuration.
 *
 * Configures a connection to a Microsoft Access database file (.mdb or .accdb).
 */
export const AccessConfigType = StructType({
    /**
     * Path to the Access database file (.mdb or .accdb).
     */
    path: StringType,

    /**
     * Password for encrypted databases.
     * Optional, only required for password-protected databases.
     */
    password: OptionType(StringType),
});

/**
 * Microsoft Access database blob configuration.
 *
 * Configures opening a Microsoft Access database from binary data (Blob).
 * Useful for opening databases fetched from URLs without writing to disk.
 */
export const AccessBlobConfigType = StructType({
    /**
     * Binary data containing the Access database (.mdb or .accdb).
     */
    data: BlobType,

    /**
     * Password for encrypted databases.
     * Optional, only required for password-protected databases.
     */
    password: OptionType(StringType),
});

/**
 * Access query options for filtering and pagination.
 */
export const AccessQueryOptionsType = StructType({
    /**
     * Table name to query (case-sensitive).
     */
    table: StringType,

    /**
     * Specific columns to retrieve.
     * Optional, defaults to all columns.
     */
    columns: OptionType(ArrayType(StringType)),

    /**
     * Number of rows to skip.
     * Optional, defaults to 0.
     */
    rowOffset: OptionType(IntegerType),

    /**
     * Maximum number of rows to return.
     * Optional, defaults to all rows.
     */
    rowLimit: OptionType(IntegerType),
});

/**
 * Access table list result.
 */
export const AccessTablesResultType = StructType({
    /** Array of table names in the database */
    tables: ArrayType(StringType),
});
