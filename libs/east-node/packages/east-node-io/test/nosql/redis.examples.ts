/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, StringType, variant, example } from "@elaraai/east";
import { NoSQL } from "@elaraai/east-node-io";

const redisConfig = {
    host: "localhost",
    port: 6379n,
    password: variant('none', null),
    db: variant('none', null),
    keyPrefix: variant('none', null),
};

export const redisConnect = example({
    keywords: ["redis", "Redis", "connect", "connection"],
    description: "Connect to a Redis server",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(redisConfig);
        const handle = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.close(handle));
    }),
    inputs: [],
});

export const redisClose = example({
    keywords: ["redis", "Redis", "close", "disconnect"],
    description: "Close a Redis connection",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(redisConfig);
        const handle = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.close(handle));
    }),
    inputs: [],
});

export const redisSet = example({
    keywords: ["redis", "Redis", "set", "store", "write"],
    description: "Store a value in Redis",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(redisConfig);
        const conn = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.set(conn, "example:key", "hello"));
        $(NoSQL.Redis.close(conn));
    }),
    inputs: [],
});

export const redisGet = example({
    keywords: ["redis", "Redis", "get", "retrieve", "read"],
    description: "Retrieve a value from Redis by key",
    fn: East.asyncFunction([], StringType, ($) => {
        const config = $.let(redisConfig);
        const conn = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.set(conn, "example:get", "world"));
        const result = $.let(NoSQL.Redis.get(conn, "example:get"));
        $(NoSQL.Redis.close(conn));
        return result.unwrap("some");
    }),
    inputs: [],
    returns: "world",
});

export const redisDelete = example({
    keywords: ["redis", "Redis", "delete", "remove", "del"],
    description: "Delete a key from Redis",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let(redisConfig);
        const conn = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.set(conn, "example:del", "to-delete"));
        const deleted = $.let(NoSQL.Redis.delete(conn, "example:del"));
        $(NoSQL.Redis.close(conn));
        return deleted;
    }),
    inputs: [],
    returns: 1n,
});

export const redisSetex = example({
    keywords: ["redis", "Redis", "setex", "expire", "ttl", "expiration"],
    description: "Store a value in Redis with an expiration time",
    fn: East.asyncFunction([], NullType, ($) => {
        const config = $.let(redisConfig);
        const conn = $.let(NoSQL.Redis.connect(config));
        $(NoSQL.Redis.setex(conn, "example:ttl", "expiring-value", 60n));
        $(NoSQL.Redis.close(conn));
    }),
    inputs: [],
});

export const redisCloseAll = example({
    keywords: ["redis", "Redis", "closeAll", "cleanup"],
    description: "Close all open Redis connections",
    fn: East.asyncFunction([], NullType, ($) => {
        $(NoSQL.Redis.closeAll());
    }),
    inputs: [],
});
