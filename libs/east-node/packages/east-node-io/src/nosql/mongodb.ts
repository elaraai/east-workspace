/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * MongoDB platform functions for East Node IO.
 *
 * Provides MongoDB document database operations for East programs,
 * including find, insert, update, and delete operations with BSON-compatible values.
 *
 * @packageDocumentation
 */

import { East, DictType, StringType, IntegerType, ArrayType, OptionType, NullType, BooleanType, FloatType, DateTimeType, SortedMap, variant, match, isValueOf } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { MongoClient, Db, ObjectId } from "mongodb";
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import { MongoConfigType, BsonValueType, MongoFindOptionsType, ConnectionHandleType } from "./types.js";

/**
 * BSON document type (dictionary mapping strings to BSON values).
 *
 * Used for MongoDB documents in queries, inserts, and updates.
 */
export const BsonDocumentType = DictType(StringType, BsonValueType);

/**
 * Connects to a MongoDB server.
 *
 * Creates a connection to a MongoDB server and returns an opaque handle
 * for use in document operations.
 *
 * @param config - MongoDB connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails (location: "mongodb_connect")
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const testConnect = East.function([], StringType, $ => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(conn);
 * });
 *
 * const compiled = East.compileAsync(testConnect.toIR(), NoSQL.MongoDB.Implementation);
 * const handle = await compiled();  // Returns connection handle string
 * ```
 */
export const mongodb_connect = East.asyncPlatform("mongodb_connect", [MongoConfigType], ConnectionHandleType);

/**
 * Finds a single document in MongoDB.
 *
 * Searches for a document matching the query object.
 * Returns None if no document is found.
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param query - Query object to match documents
 * @returns Option containing the document, or None if not found
 *
 * @throws {EastError} When operation fails (location: "mongodb_find_one")
 *
 * @example
 * ```ts
 * import { East, StringType, OptionType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const findUser = East.function([StringType], OptionType(NoSQL.MongoDB.Types.BsonDocument), ($, username) => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     const query = $.let(new Map([["username", variant('String', username)]]), NoSQL.MongoDB.Types.BsonDocument);
 *     const user = $.let(NoSQL.MongoDB.findOne(conn, query));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(user);
 * });
 *
 * const compiled = East.compileAsync(findUser.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled("alice");  // variant('some', document) or variant('none', null)
 * ```
 */
export const mongodb_find_one = East.asyncPlatform("mongodb_find_one", [ConnectionHandleType, BsonDocumentType], OptionType(BsonDocumentType));

/**
 * Finds multiple documents in MongoDB.
 *
 * Searches for documents matching the query object with optional
 * limit and skip for pagination.
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param query - Query object to match documents
 * @param options - Find options (limit, skip)
 * @returns Array of matching documents
 *
 * @throws {EastError} When operation fails (location: "mongodb_find_many")
 *
 * @example
 * ```ts
 * import { East, ArrayType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const findAllUsers = East.function([], ArrayType(NoSQL.MongoDB.Types.BsonDocument), $ => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     const query = $.let(new Map(), NoSQL.MongoDB.Types.BsonDocument);
 *     const options = $.let({ limit: variant('some', 10n), skip: variant('none', null) });
 *     const users = $.let(NoSQL.MongoDB.findMany(conn, query, options));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(users);
 * });
 *
 * const compiled = East.compileAsync(findAllUsers.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled();  // [doc1, doc2, ...]
 * ```
 */
export const mongodb_find_many = East.asyncPlatform("mongodb_find_many", [ConnectionHandleType, BsonDocumentType, MongoFindOptionsType], ArrayType(BsonDocumentType));

/**
 * Inserts a document into MongoDB.
 *
 * Inserts a new document into the collection.
 * Returns the inserted document's _id as a string.
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param document - Document to insert
 * @returns The inserted document's _id
 *
 * @throws {EastError} When operation fails (location: "mongodb_insert_one")
 *
 * @example
 * ```ts
 * import { East, StringType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const createUser = East.function([StringType, StringType], StringType, ($, username, email) => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     const document = $.let(new Map([
 *         ["username", variant('String', username)],
 *         ["email", variant('String', email)],
 *     ]), NoSQL.MongoDB.Types.BsonDocument);
 *     const id = $.let(NoSQL.MongoDB.insertOne(conn, document));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(id);
 * });
 *
 * const compiled = East.compileAsync(createUser.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled("alice", "alice@example.com");  // "507f1f77bcf86cd799439011"
 * ```
 */
export const mongodb_insert_one = East.asyncPlatform("mongodb_insert_one", [ConnectionHandleType, BsonDocumentType], StringType);

/**
 * Updates a document in MongoDB.
 *
 * Updates a single document matching the query with the update operations.
 * Returns the number of documents modified (0 or 1).
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param query - Query object to match document
 * @param update - Update operations object
 * @returns Number of documents modified
 *
 * @throws {EastError} When operation fails (location: "mongodb_update_one")
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const updateEmail = East.function([StringType, StringType], IntegerType, ($, username, newEmail) => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     const query = $.let(new Map([["username", variant('String', username)]]), NoSQL.MongoDB.Types.BsonDocument);
 *     const update = $.let(new Map([["email", variant('String', newEmail)]]), NoSQL.MongoDB.Types.BsonDocument);
 *     const modified = $.let(NoSQL.MongoDB.updateOne(conn, query, update));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(modified);
 * });
 *
 * const compiled = East.compileAsync(updateEmail.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled("alice", "newemail@example.com");  // 1n (updated) or 0n (not found)
 * ```
 */
export const mongodb_update_one = East.asyncPlatform("mongodb_update_one", [ConnectionHandleType, BsonDocumentType, BsonDocumentType], IntegerType);

/**
 * Deletes a document from MongoDB.
 *
 * Deletes a single document matching the query object.
 * Returns the number of documents deleted (0 or 1).
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param query - Query object to match document
 * @returns Number of documents deleted
 *
 * @throws {EastError} When operation fails (location: "mongodb_delete_one")
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const deleteUser = East.function([StringType], IntegerType, ($, username) => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     const query = $.let(new Map([["username", variant('String', username)]]), NoSQL.MongoDB.Types.BsonDocument);
 *     const deleted = $.let(NoSQL.MongoDB.deleteOne(conn, query));
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(deleted);
 * });
 *
 * const compiled = East.compileAsync(deleteUser.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled("alice");  // 1n (deleted) or 0n (not found)
 * ```
 */
export const mongodb_delete_one = East.asyncPlatform("mongodb_delete_one", [ConnectionHandleType, BsonDocumentType], IntegerType);

/**
 * Deletes multiple documents from MongoDB.
 *
 * Deletes all documents matching the query object.
 * Returns the number of documents deleted.
 *
 * @param handle - Connection handle from mongodb_connect()
 * @param query - Query object to match documents (empty query matches all)
 * @returns Number of documents deleted
 *
 * @throws {EastError} When operation fails (location: "mongodb_delete_many")
 *
 * @internal
 */
export const mongodb_delete_many = East.asyncPlatform("mongodb_delete_many", [ConnectionHandleType, BsonDocumentType], IntegerType);

/**
 * Closes a MongoDB connection.
 *
 * Closes the MongoDB connection and releases all resources.
 *
 * @param handle - Connection handle from mongodb_connect()
 * @returns Null on success
 *
 * @throws {EastError} When handle is invalid (location: "mongodb_close")
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const cleanup = East.function([], NullType, $ => {
 *     const config = $.let({
 *         uri: "mongodb://localhost:27017",
 *         database: "myapp",
 *         collection: "users",
 *     });
 *     const conn = $.let(NoSQL.MongoDB.connect(config));
 *     // ... do work ...
 *     $(NoSQL.MongoDB.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), NoSQL.MongoDB.Implementation);
 * await compiled();
 * ```
 */
export const mongodb_close = East.asyncPlatform("mongodb_close", [ConnectionHandleType], NullType);

/**
 * Closes all active MongoDB connections.
 *
 * Utility function for test cleanup. Closes all open connection handles,
 * useful for ensuring cleanup even when tests fail.
 *
 * @returns Null on success
 *
 * @internal
 */
export const mongodb_close_all = East.asyncPlatform("mongodb_close_all", [], NullType);

/**
 * Converts East BsonValue to native MongoDB value.
 *
 * @param value - East BsonValue variant
 * @returns JavaScript value for MongoDB
 * @internal
 */
function bsonValueToNative(value: ValueTypeOf<typeof BsonValueType>): any {
    return match(value, {
        String: (v) => v,
        Integer: (v) => Number(v), // MongoDB uses Numbers, not BigInt
        Float: (v) => v,
        Boolean: (v) => v,
        Null: () => null,
        Array: (arr) => arr.map(bsonValueToNative),
        Object: (obj) => {
            const result: any = {};
            for (const [key, val] of obj.entries()) {
                result[key] = bsonValueToNative(val);
            }
            return result;
        },
    });
}

/**
 * Converts native MongoDB value to East BsonValue variant.
 *
 * @param value - Native JavaScript value from MongoDB
 * @returns East BsonValue variant
 * @internal
 */
function nativeToBsonValue(value: any): ValueTypeOf<typeof BsonValueType> {
    if (isValueOf(value, NullType)) {
        return variant('Null', null);
    } else if (isValueOf(value, BooleanType)) {
        return variant('Boolean', value);
    } else if (isValueOf(value, IntegerType)) {
        return variant('Integer', value);
    } else if (isValueOf(value, FloatType)) {
        // MongoDB returns numbers - check if integer or float
        if (Number.isInteger(value)) {
            return variant('Integer', BigInt(value));
        } else {
            return variant('Float', value);
        }
    } else if (isValueOf(value, StringType)) {
        return variant('String', value);
    } else if (isValueOf(value, DateTimeType)) {
        // MongoDB may return Date objects - convert to Integer (Unix timestamp)
        return variant('Integer', BigInt(Math.floor(value.getTime() / 1000)));
    } else if (value instanceof ObjectId) {
        // MongoDB ObjectId - convert to string
        return variant('String', value.toString());
    } else if (Array.isArray(value)) {
        return variant('Array', value.map(nativeToBsonValue));
    } else if (typeof value === 'object' && value !== null) {
        const result = new SortedMap<string, ValueTypeOf<typeof BsonValueType>>();
        for (const [key, val] of Object.entries(value)) {
            result.set(key, nativeToBsonValue(val));
        }
        return variant('Object', result);
    } else {
        return variant('Null', null);
    }
}

/**
 * Node.js implementation of MongoDB platform functions.
 *
 * Pass this to East.compileAsync() to enable MongoDB operations.
 */
export const MongoDBImpl: PlatformFunction[] = [
    mongodb_connect.implement(async (config: ValueTypeOf<typeof MongoConfigType>): Promise<string> => {
        try {
            const client = new MongoClient(config.uri);
            await client.connect();

            // Store the database and collection context with the client
            const db = client.db(config.database);
            const collection = db.collection(config.collection);

            // Store both client and collection for later use, with cleanup function
            const conn = { client, db, collection };
            const handle = createHandle(conn, async () => await client.close());

            return handle;
        } catch (err: any) {
            throw new EastError(`MongoDB connection failed: ${err.message}`, {
                location: [{ filename: "mongodb_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_find_one.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        query: ValueTypeOf<typeof BsonDocumentType>
    ): Promise<ValueTypeOf<ReturnType<typeof OptionType>>> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert query SortedMap to native object
            const nativeQuery: any = {};
            for (const [key, value] of query.entries()) {
                nativeQuery[key] = bsonValueToNative(value);
            }

            const doc = await collection.findOne(nativeQuery);

            if (doc === null) {
                return variant('none', null);
            }

            // Convert MongoDB document to East BsonValue SortedMap
            const bsonDict = new SortedMap<string, ValueTypeOf<typeof BsonValueType>>();
            for (const [key, val] of Object.entries(doc)) {
                bsonDict.set(key, nativeToBsonValue(val));
            }

            return variant('some', bsonDict);
        } catch (err: any) {
            throw new EastError(`MongoDB findOne failed: ${err.message}`, {
                location: [{ filename: "mongodb_find_one", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_find_many.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        query: ValueTypeOf<typeof BsonDocumentType>,
        options: ValueTypeOf<typeof MongoFindOptionsType>
    ): Promise<ValueTypeOf<ReturnType<typeof ArrayType>>> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert query SortedMap to native object
            const nativeQuery: any = {};
            for (const [key, value] of query.entries()) {
                nativeQuery[key] = bsonValueToNative(value);
            }

            let cursor = collection.find(nativeQuery);

            if (options.limit?.type === 'some') {
                cursor = cursor.limit(Number(options.limit.value));
            }

            if (options.skip?.type === 'some') {
                cursor = cursor.skip(Number(options.skip.value));
            }

            const docs = await cursor.toArray();

            // Convert MongoDB documents to East BsonValue SortedMap array
            const result: ValueTypeOf<typeof BsonDocumentType>[] = [];
            for (const doc of docs) {
                const bsonDict = new SortedMap<string, ValueTypeOf<typeof BsonValueType>>();
                for (const [key, val] of Object.entries(doc)) {
                    bsonDict.set(key, nativeToBsonValue(val));
                }
                result.push(bsonDict);
            }

            return result;
        } catch (err: any) {
            throw new EastError(`MongoDB findMany failed: ${err.message}`, {
                location: [{ filename: "mongodb_find_many", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_insert_one.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        document: ValueTypeOf<typeof BsonDocumentType>
    ): Promise<string> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert document SortedMap to native object
            const nativeDoc: any = {};
            for (const [key, value] of document.entries()) {
                nativeDoc[key] = bsonValueToNative(value);
            }

            const result = await collection.insertOne(nativeDoc);

            return result.insertedId.toString();
        } catch (err: any) {
            throw new EastError(`MongoDB insertOne failed: ${err.message}`, {
                location: [{ filename: "mongodb_insert_one", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_update_one.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        query: ValueTypeOf<typeof BsonDocumentType>,
        update: ValueTypeOf<typeof BsonDocumentType>
    ): Promise<bigint> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert query SortedMap to native object
            const nativeQuery: any = {};
            for (const [key, value] of query.entries()) {
                nativeQuery[key] = bsonValueToNative(value);
            }

            // Convert update SortedMap to native object
            const nativeUpdate: any = {};
            for (const [key, value] of update.entries()) {
                nativeUpdate[key] = bsonValueToNative(value);
            }

            const result = await collection.updateOne(nativeQuery, nativeUpdate);

            return BigInt(result.modifiedCount);
        } catch (err: any) {
            throw new EastError(`MongoDB updateOne failed: ${err.message}`, {
                location: [{ filename: "mongodb_update_one", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_delete_one.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        query: ValueTypeOf<typeof BsonDocumentType>
    ): Promise<bigint> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert query SortedMap to native object
            const nativeQuery: any = {};
            for (const [key, value] of query.entries()) {
                nativeQuery[key] = bsonValueToNative(value);
            }

            const result = await collection.deleteOne(nativeQuery);

            return BigInt(result.deletedCount);
        } catch (err: any) {
            throw new EastError(`MongoDB deleteOne failed: ${err.message}`, {
                location: [{ filename: "mongodb_delete_one", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_delete_many.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        query: ValueTypeOf<typeof BsonDocumentType>
    ): Promise<bigint> => {
        try {
            const { collection } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);

            // Convert query SortedMap to native object
            const nativeQuery: any = {};
            for (const [key, value] of query.entries()) {
                nativeQuery[key] = bsonValueToNative(value);
            }

            const result = await collection.deleteMany(nativeQuery);

            return BigInt(result.deletedCount);
        } catch (err: any) {
            throw new EastError(`MongoDB deleteMany failed: ${err.message}`, {
                location: [{ filename: "mongodb_delete_many", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const { client } = getConnection<{ client: MongoClient; db: Db; collection: any }>(handle);
            await client.close();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`MongoDB close failed: ${err.message}`, {
                location: [{ filename: "mongodb_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    mongodb_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
