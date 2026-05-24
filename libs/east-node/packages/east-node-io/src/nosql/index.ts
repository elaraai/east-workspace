/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * NoSQL database platform functions.
 *
 * Provides Redis and MongoDB operations for East programs,
 * supporting caching and document storage use cases.
 *
 * @packageDocumentation
 */

// Export individual modules
export * from "./redis.js";
export * from "./mongodb.js";

// Export public types (not ConnectionHandleType to avoid conflict with SQL module)
export { RedisConfigType, MongoConfigType, BsonValueType, MongoFindOptionsType } from "./types.js";

// Import for grouped exports
import {
    redis_connect,
    redis_get,
    redis_set,
    redis_setex,
    redis_del,
    redis_close,
    redis_close_all,
    RedisImpl
} from "./redis.js";
import {
    mongodb_connect,
    mongodb_find_one,
    mongodb_find_many,
    mongodb_insert_one,
    mongodb_update_one,
    mongodb_delete_one,
    mongodb_close,
    BsonDocumentType,
    MongoDBImpl
} from "./mongodb.js";
import { RedisConfigType, MongoConfigType, BsonValueType, MongoFindOptionsType } from "./types.js";

/**
 * NoSQL database platform functions.
 *
 * Provides Redis and MongoDB operations for East programs with type-safe
 * caching and document storage capabilities.
 *
 * @example
 * ```ts
 * import { East, StringType, OptionType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const cacheExample = East.function([StringType], OptionType(StringType), ($, key) => {
 *     const config = $.let({
 *         host: "localhost",
 *         port: 6379n,
 *         password: variant('none', null),
 *         db: variant('none', null),
 *         keyPrefix: variant('none', null),
 *     });
 *
 *     const conn = $.let(NoSQL.Redis.connect(config));
 *     const value = $.let(NoSQL.Redis.get(conn, key));
 *     $(NoSQL.Redis.close(conn));
 *
 *     $.return(value);
 * });
 *
 * // All NoSQL operations are async
 * const compiled = East.compileAsync(cacheExample.toIR(), NoSQL.Redis.Implementation);
 * await compiled("user:42");
 * ```
 */
export const NoSQL = {
    /**
     * Redis key-value store operations.
     *
     * Provides platform functions for Redis caching and data storage,
     * supporting get, set, delete, and expiration operations.
     */
    Redis: {
        /**
         * Connects to a Redis server.
         *
         * Creates a connection to a Redis server and returns an
         * opaque handle for use in key-value operations.
         *
         * @example
         * ```ts
         * const getValue = East.function([StringType], OptionType(StringType), ($, key) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     const value = $.let(NoSQL.Redis.get(conn, key));
         *     $(NoSQL.Redis.close(conn));
         *     $.return(value);
         * });
         *
         * const compiled = East.compileAsync(getValue.toIR(), NoSQL.Redis.Implementation);
         * await compiled("user:42");  // Some("Alice") or None
         * ```
         */
        connect: redis_connect,

        /**
         * Gets a value by key from Redis.
         *
         * Retrieves the string value associated with the given key.
         * Returns None if the key doesn't exist.
         *
         * @example
         * ```ts
         * const getValue = East.function([StringType], OptionType(StringType), ($, key) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     const value = $.let(NoSQL.Redis.get(conn, key));
         *     $(NoSQL.Redis.close(conn));
         *     $.return(value);
         * });
         *
         * const compiled = East.compileAsync(getValue.toIR(), NoSQL.Redis.Implementation);
         * await compiled("user:42");  // variant('some', "Alice") or variant('none', null)
         * ```
         */
        get: redis_get,

        /**
         * Sets a key-value pair in Redis.
         *
         * Stores a string value associated with the given key.
         * Overwrites existing values.
         *
         * @example
         * ```ts
         * const setValue = East.function([StringType, StringType], NullType, ($, key, value) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     $(NoSQL.Redis.set(conn, key, value));
         *     $(NoSQL.Redis.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(setValue.toIR(), NoSQL.Redis.Implementation);
         * await compiled("user:42", "Alice");
         * ```
         */
        set: redis_set,

        /**
         * Sets a key-value pair with expiration in Redis.
         *
         * Stores a string value with a TTL (time-to-live) in seconds.
         * The key will automatically expire after the specified duration.
         *
         * @example
         * ```ts
         * const setSession = East.function([StringType, StringType], NullType, ($, sessionId, data) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     $(NoSQL.Redis.setex(conn, sessionId, data, 3600n)); // 1 hour TTL
         *     $(NoSQL.Redis.close(conn));
         *     $.return(null);
         * });
         *
         * const compiled = East.compileAsync(setSession.toIR(), NoSQL.Redis.Implementation);
         * await compiled("session:xyz", "user_data");
         * ```
         */
        setex: redis_setex,

        /**
         * Deletes a key from Redis.
         *
         * Removes the key and its associated value from Redis.
         * Returns the number of keys deleted (0 or 1).
         *
         * @example
         * ```ts
         * const deleteKey = East.function([StringType], IntegerType, ($, key) => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     const deleted = $.let(NoSQL.Redis.delete(conn, key));
         *     $(NoSQL.Redis.close(conn));
         *     $.return(deleted);
         * });
         *
         * const compiled = East.compileAsync(deleteKey.toIR(), NoSQL.Redis.Implementation);
         * await compiled("user:42");  // 1n (deleted) or 0n (not found)
         * ```
         */
        delete: redis_del,

        /**
         * Closes the Redis connection.
         *
         * Closes the connection and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         host: "localhost",
         *         port: 6379n,
         *         password: variant('none', null),
         *         db: variant('none', null),
         *         keyPrefix: variant('none', null),
         *     });
         *     const conn = $.let(NoSQL.Redis.connect(config));
         *     // ... do work ...
         *     $(NoSQL.Redis.close(conn));
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), NoSQL.Redis.Implementation);
         * await compiled();
         * ```
         */
        close: redis_close,

        /**
         * Closes all Redis connections.
         *
         * Closes all active Redis connections and releases all resources.
         * Useful for test cleanup to ensure all connections are closed.
         *
         * @returns Null on success
         *
         * @example
         * ```ts
         * const cleanupAll = East.function([], NullType, $ => {
         *     // ... test code that may have left connections open ...
         *     $(NoSQL.Redis.closeAll());
         *     return $.return(null);
         * });
         *
         * const compiled = East.compileAsync(cleanupAll.toIR(), NoSQL.Redis.Implementation);
         * await compiled();
         * ```
         *
         * @internal
         */
        closeAll: redis_close_all,

        /**
         * Node.js implementation of Redis platform functions.
         *
         * Pass this to East.compileAsync() to enable Redis operations.
         */
        Implementation: RedisImpl,

        /**
         * Type definitions for Redis operations.
         */
        Types: {
            /**
             * Redis connection configuration type.
             */
            Config: RedisConfigType,
        },
    },

    /**
     * MongoDB document database operations.
     *
     * Provides platform functions for MongoDB document storage,
     * supporting find, insert, update, and delete operations.
     */
    MongoDB: {
        /**
         * Connects to a MongoDB server.
         *
         * Creates a connection to a MongoDB database and returns an
         * opaque handle for use in document operations.
         *
         * @example
         * ```ts
         * const findUser = East.function([StringType], OptionType(BsonDocumentType), ($, username) => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const query = $.let(new Map([["username", variant('String', username)]]), BsonDocumentType);
         *     const result = $.let(NoSQL.MongoDB.findOne(conn, query));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(result);
         * });
         *
         * const compiled = East.compileAsync(findUser.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled("alice");  // variant('some', document) or variant('none', null)
         * ```
         */
        connect: mongodb_connect,

        /**
         * Finds a single document in MongoDB.
         *
         * Searches for a document matching the query object.
         * Returns None if no document is found.
         *
         * @example
         * ```ts
         * const findUser = East.function([StringType], OptionType(BsonDocumentType), ($, username) => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const query = $.let(new Map([["username", variant('String', username)]]), BsonDocumentType);
         *     const result = $.let(NoSQL.MongoDB.findOne(conn, query));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(result);
         * });
         *
         * const compiled = East.compileAsync(findUser.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled("alice");  // variant('some', document) or variant('none', null)
         * ```
         */
        findOne: mongodb_find_one,

        /**
         * Finds multiple documents in MongoDB.
         *
         * Searches for documents matching the query object with optional
         * limit and skip for pagination.
         *
         * @example
         * ```ts
         * const findUsers = East.function([], ArrayType(BsonDocumentType), $ => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const query = $.let(new Map(), BsonDocumentType);
         *     const options = $.let({ limit: variant('some',10n), skip: variant('none', null) });
         *     const result = $.let(NoSQL.MongoDB.findMany(conn, query, options));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(result);
         * });
         *
         * const compiled = East.compileAsync(findUsers.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled();  // [doc1, doc2, ...]
         * ```
         */
        findMany: mongodb_find_many,

        /**
         * Inserts a document into MongoDB.
         *
         * Inserts a new document into the collection.
         * Returns the inserted document's _id as a string.
         *
         * @example
         * ```ts
         * const createUser = East.function([StringType, StringType], StringType, ($, username, email) => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const doc = $.let(new Map([
         *         ["username", variant('String', username)],
         *         ["email", variant('String', email)],
         *     ]), BsonDocumentType);
         *     const id = $.let(NoSQL.MongoDB.insertOne(conn, doc));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(id);
         * });
         *
         * const compiled = East.compileAsync(createUser.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled("alice", "alice@example.com");  // "507f1f77bcf86cd799439011"
         * ```
         */
        insertOne: mongodb_insert_one,

        /**
         * Updates a document in MongoDB.
         *
         * Updates a single document matching the query with the update operations.
         * Returns the number of documents modified (0 or 1).
         *
         * @example
         * ```ts
         * const updateUser = East.function([StringType, StringType], IntegerType, ($, username, newEmail) => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const query = $.let(new Map([["username", variant('String', username)]]), BsonDocumentType);
         *     const update = $.let(new Map([["email", variant('String', newEmail)]]), BsonDocumentType);
         *     const modified = $.let(NoSQL.MongoDB.updateOne(conn, query, update));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(modified);
         * });
         *
         * const compiled = East.compileAsync(updateUser.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled("alice", "newemail@example.com");  // 1n (updated) or 0n (not found)
         * ```
         */
        updateOne: mongodb_update_one,

        /**
         * Deletes a document from MongoDB.
         *
         * Deletes a single document matching the query object.
         * Returns the number of documents deleted (0 or 1).
         *
         * @example
         * ```ts
         * const deleteUser = East.function([StringType], IntegerType, ($, username) => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     const query = $.let(new Map([["username", variant('String', username)]]), BsonDocumentType);
         *     const deleted = $.let(NoSQL.MongoDB.deleteOne(conn, query));
         *     $(NoSQL.MongoDB.close(conn));
         *     $.return(deleted);
         * });
         *
         * const compiled = East.compileAsync(deleteUser.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled("alice");  // 1n (deleted) or 0n (not found)
         * ```
         */
        deleteOne: mongodb_delete_one,

        /**
         * Closes the MongoDB connection.
         *
         * Closes the connection and releases all resources.
         *
         * @example
         * ```ts
         * const cleanup = East.function([], NullType, $ => {
         *     const config = $.let({
         *         uri: "mongodb://localhost:27017",
         *         database: "myapp",
         *         collection: "users",
         *     });
         *     const conn = $.let(NoSQL.MongoDB.connect(config));
         *     // ... do work ...
         *     $(NoSQL.MongoDB.close(conn));
         * });
         *
         * const compiled = East.compileAsync(cleanup.toIR(), NoSQL.MongoDB.Implementation);
         * await compiled();
         * ```
         */
        close: mongodb_close,

        /**
         * Node.js implementation of MongoDB platform functions.
         *
         * Pass this to East.compileAsync() to enable MongoDB operations.
         */
        Implementation: MongoDBImpl,

        /**
         * Type definitions for MongoDB operations.
         */
        Types: {
            /**
             * MongoDB connection configuration type.
             */
            Config: MongoConfigType,

            /**
             * BSON value type (recursive type for MongoDB values).
             */
            BsonValue: BsonValueType,

            /**
             * BSON document type (dictionary of string keys to BSON values).
             */
            BsonDocument: BsonDocumentType,

            /**
             * MongoDB find operation options type.
             */
            FindOptions: MongoFindOptionsType,
        },
    },
} as const;
