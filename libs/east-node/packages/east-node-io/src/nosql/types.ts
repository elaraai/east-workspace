/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared NoSQL type definitions for East Node IO.
 *
 * Provides East type definitions for Redis and MongoDB operations.
 *
 * @packageDocumentation
 */

import {
    StructType,
    OptionType,
    StringType,
    IntegerType,
    RecursiveType,
    VariantType,
    ArrayType,
    DictType,
    BooleanType,
    FloatType,
    NullType,
} from "@elaraai/east";

/**
 * Redis connection configuration.
 *
 * Configures connection to a Redis server.
 */
export const RedisConfigType = StructType({
    /** Redis server hostname or IP address */
    host: StringType,

    /** Redis server port (typically 6379) */
    port: IntegerType,

    /** Password for authentication (optional) */
    password: OptionType(StringType),

    /** Database index (0-15, optional, defaults to 0) */
    db: OptionType(IntegerType),

    /** Key prefix for all operations (optional) */
    keyPrefix: OptionType(StringType),
});

/**
 * MongoDB connection configuration.
 *
 * Configures connection to a MongoDB server.
 */
export const MongoConfigType = StructType({
    /** MongoDB connection URI */
    uri: StringType,

    /** Database name */
    database: StringType,

    /** Collection name */
    collection: StringType,
});

/**
 * BSON-compatible value type (recursive).
 *
 * Represents a value that can be stored in MongoDB.
 * Supports nested objects and arrays.
 */
export const BsonValueType: ReturnType<typeof RecursiveType> = RecursiveType((self) =>
    VariantType({
        String: StringType,
        Integer: IntegerType,
        Float: FloatType,
        Boolean: BooleanType,
        Null: NullType,
        Array: ArrayType(self),
        Object: DictType(StringType, self),
    })
);

/**
 * MongoDB find options.
 *
 * Options for limiting and offsetting query results.
 */
export const MongoFindOptionsType = StructType({
    /** Maximum number of documents to return (optional) */
    limit: OptionType(IntegerType),

    /** Number of documents to skip (optional) */
    skip: OptionType(IntegerType),
});

/**
 * Opaque connection handle type.
 *
 * Represents an active Redis or MongoDB connection.
 *
 * @internal
 */
const ConnectionHandleType = StringType;

// Export for internal use within nosql module only
export { ConnectionHandleType };
