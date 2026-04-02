/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Redis platform functions for East Node IO.
 *
 * Provides Redis key-value store operations for East programs,
 * including get, set, delete, and expiration operations.
 *
 * @packageDocumentation
 */

import { East, StringType, IntegerType, OptionType, NullType, variant } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { Redis } from "ioredis";
import { createHandle, getConnection, closeHandle, closeAllHandles } from '../connection/index.js';
import { RedisConfigType, ConnectionHandleType } from "./types.js";

/**
 * Connects to a Redis server.
 *
 * Creates a connection to a Redis server and returns an opaque handle
 * for use in key-value operations.
 *
 * @param config - Redis connection configuration
 * @returns Connection handle (opaque string)
 *
 * @throws {EastError} When connection fails (location: "redis_connect")
 *
 * @example
 * ```ts
 * import { East, StringType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const testConnect = East.function([], StringType, $ => {
 *     const config = $.let({
 *         host: "localhost",
 *         port: 6379n,
 *         password: variant('none', null),
 *         db: variant('none', null),
 *         keyPrefix: variant('none', null),
 *     });
 *     const conn = $.let(NoSQL.Redis.connect(config));
 *     $(NoSQL.Redis.close(conn));
 *     return $.return(conn);
 * });
 *
 * const compiled = East.compileAsync(testConnect.toIR(), NoSQL.Redis.Implementation);
 * const handle = await compiled();  // Returns connection handle string
 * ```
 */
export const redis_connect = East.asyncPlatform("redis_connect", [RedisConfigType], ConnectionHandleType);

/**
 * Gets a value by key from Redis.
 *
 * Retrieves the string value associated with the given key.
 * Returns None if the key doesn't exist.
 *
 * @param handle - Connection handle from redis_connect()
 * @param key - Key to retrieve
 * @returns Option containing the value, or None if key doesn't exist
 *
 * @throws {EastError} When operation fails (location: "redis_get")
 *
 * @example
 * ```ts
 * import { East, StringType, OptionType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(value);
 * });
 *
 * const compiled = East.compileAsync(getValue.toIR(), NoSQL.Redis.Implementation);
 * await compiled("user:42");  // variant('some', "Alice") or variant('none', null)
 * ```
 */
export const redis_get = East.asyncPlatform("redis_get", [ConnectionHandleType, StringType], OptionType(StringType));

/**
 * Sets a key-value pair in Redis.
 *
 * Stores a string value associated with the given key.
 * Overwrites existing values.
 *
 * @param handle - Connection handle from redis_connect()
 * @param key - Key to set
 * @param value - Value to store
 * @returns Null on success
 *
 * @throws {EastError} When operation fails (location: "redis_set")
 *
 * @example
 * ```ts
 * import { East, StringType, NullType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(setValue.toIR(), NoSQL.Redis.Implementation);
 * await compiled("user:42", "Alice");
 * ```
 */
export const redis_set = East.asyncPlatform("redis_set", [ConnectionHandleType, StringType, StringType], NullType);

/**
 * Sets a key-value pair with expiration in Redis.
 *
 * Stores a string value with a TTL (time-to-live) in seconds.
 * The key will automatically expire after the specified duration.
 *
 * @param handle - Connection handle from redis_connect()
 * @param key - Key to set
 * @param value - Value to store
 * @param ttl - Time-to-live in seconds
 * @returns Null on success
 *
 * @throws {EastError} When operation fails (location: "redis_setex")
 *
 * @example
 * ```ts
 * import { East, StringType, NullType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
 * const setSession = East.function([StringType, StringType], NullType, ($, sessionId, data) => {
 *     const config = $.let({
 *         host: "localhost",
 *         port: 6379n,
 *         password: variant('none', null),
 *         db: variant('none', null),
 *         keyPrefix: variant('none', null),
 *     });
 *     const conn = $.let(NoSQL.Redis.connect(config));
 *     $(NoSQL.Redis.setex(conn, sessionId, data, 3600n));  // 1 hour TTL
 *     $(NoSQL.Redis.close(conn));
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(setSession.toIR(), NoSQL.Redis.Implementation);
 * await compiled("session:xyz", "user_data");
 * ```
 */
export const redis_setex = East.asyncPlatform("redis_setex", [ConnectionHandleType, StringType, StringType, IntegerType], NullType);

/**
 * Deletes a key from Redis.
 *
 * Removes the key and its associated value from Redis.
 * Returns the number of keys deleted (0 or 1).
 *
 * @param handle - Connection handle from redis_connect()
 * @param key - Key to delete
 * @returns Number of keys deleted (0 if key didn't exist, 1 if deleted)
 *
 * @throws {EastError} When operation fails (location: "redis_del")
 *
 * @example
 * ```ts
 * import { East, StringType, IntegerType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(deleted);
 * });
 *
 * const compiled = East.compileAsync(deleteKey.toIR(), NoSQL.Redis.Implementation);
 * await compiled("user:42");  // 1n (deleted) or 0n (not found)
 * ```
 */
export const redis_del = East.asyncPlatform("redis_del", [ConnectionHandleType, StringType], IntegerType);

/**
 * Closes a Redis connection.
 *
 * Closes the Redis connection and releases all resources.
 *
 * @param handle - Connection handle from redis_connect()
 * @returns Null on success
 *
 * @throws {EastError} When handle is invalid (location: "redis_close")
 *
 * @example
 * ```ts
 * import { East, NullType, variant } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
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
 *     return $.return(null);
 * });
 *
 * const compiled = East.compileAsync(cleanup.toIR(), NoSQL.Redis.Implementation);
 * await compiled();
 * ```
 */
export const redis_close = East.asyncPlatform("redis_close", [ConnectionHandleType], NullType);

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
 * import { East, NullType } from "@elaraai/east";
 * import { NoSQL } from "@elaraai/east-node-io";
 *
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
export const redis_close_all = East.asyncPlatform("redis_close_all", [], NullType);

/**
 * Node.js implementation of Redis platform functions.
 *
 * Pass this to East.compileAsync() to enable Redis operations.
 */
export const RedisImpl: PlatformFunction[] = [
    redis_connect.implement(async (config: ValueTypeOf<typeof RedisConfigType>): Promise<string> => {
        try {
            const options: any = {
                host: config.host,
                port: Number(config.port),
            };

            if (config.password?.type === 'some') {
                options.password = config.password.value;
            }

            if (config.db?.type === 'some') {
                options.db = Number(config.db.value);
            }

            if (config.keyPrefix?.type === 'some') {
                options.keyPrefix = config.keyPrefix.value;
            }

            const client = new Redis(options);

            // Wait for connection to be ready
            await new Promise<void>((resolve, reject) => {
                client.on('ready', () => resolve());
                client.on('error', (err: any) => reject(err));
            });

            return createHandle(client, async () => {
                await client.quit()
            });
        } catch (err: any) {
            throw new EastError(`Redis connection failed: ${err.message}`, {
                location: [{ filename: "redis_connect", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_get.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        key: ValueTypeOf<typeof StringType>
    ): Promise<ValueTypeOf<ReturnType<typeof OptionType>>> => {
        try {
            const client = getConnection<Redis>(handle);
            const value = await client.get(key);

            if (value === null) {
                return variant('none', null);
            }

            return variant('some', value);
        } catch (err: any) {
            throw new EastError(`Redis get failed: ${err.message}`, {
                location: [{ filename: "redis_get", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_set.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        key: ValueTypeOf<typeof StringType>,
        value: ValueTypeOf<typeof StringType>
    ): Promise<null> => {
        try {
            const client = getConnection<Redis>(handle);
            await client.set(key, value);
            return null;
        } catch (err: any) {
            throw new EastError(`Redis set failed: ${err.message}`, {
                location: [{ filename: "redis_set", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_setex.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        key: ValueTypeOf<typeof StringType>,
        value: ValueTypeOf<typeof StringType>,
        ttl: ValueTypeOf<typeof IntegerType>
    ): Promise<null> => {
        try {
            const client = getConnection<Redis>(handle);
            await client.setex(key, Number(ttl), value);
            return null;
        } catch (err: any) {
            throw new EastError(`Redis setex failed: ${err.message}`, {
                location: [{ filename: "redis_setex", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_del.implement(async (
        handle: ValueTypeOf<typeof ConnectionHandleType>,
        key: ValueTypeOf<typeof StringType>
    ): Promise<bigint> => {
        try {
            const client = getConnection<Redis>(handle);
            const deleted = await client.del(key);
            return BigInt(deleted);
        } catch (err: any) {
            throw new EastError(`Redis del failed: ${err.message}`, {
                location: [{ filename: "redis_del", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_close.implement(async (handle: ValueTypeOf<typeof ConnectionHandleType>) => {
        try {
            const client = getConnection<Redis>(handle);
            await client.quit();
            closeHandle(handle);
            return null;
        } catch (err: any) {
            throw new EastError(`Redis close failed: ${err.message}`, {
                location: [{ filename: "redis_close", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    redis_close_all.implement(async () => {
        await closeAllHandles();
        return null;
    }),
];
