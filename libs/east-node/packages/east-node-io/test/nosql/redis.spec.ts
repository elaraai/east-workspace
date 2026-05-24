/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Redis platform function tests
 *
 * These tests use describeEast following east-node conventions.
 * Tests compile East functions and run them to validate platform function behavior.
 *
 * Note: These tests require Redis running on localhost:6379.
 * Run `npm run dev:services` to start Docker containers.
 */
import { East, variant } from "@elaraai/east";
import { describeEast, Assert, NodePlatform } from "@elaraai/east-node-std";
import { NoSQL } from "@elaraai/east-node-io";
import * as ex from "./redis.examples.js";

// Redis test configuration
const TEST_CONFIG = {
    host: "localhost",
    port: 6379n,
    password: variant('none', null),
    db: variant('none', null),
    keyPrefix: variant('none', null),
};

await describeEast("Redis platform functions", (test) => {
    Assert.examples(test, { redisConnect: ex.redisConnect, redisClose: ex.redisClose, redisSet: ex.redisSet, redisGet: ex.redisGet, redisDelete: ex.redisDelete, redisSetex: ex.redisSetex, redisCloseAll: ex.redisCloseAll });

    test("connect and close Redis connection", $ => {
        console.log("connect and close Redis connection");

        const config = $.let(TEST_CONFIG);
        const handle = $.let(NoSQL.Redis.connect(config));

        // Handle should be non-empty string
        $(Assert.greater(handle.length(), East.value(0n)));

        // Close connection
        $(NoSQL.Redis.close(handle));
    });

    test("set stores value successfully", $ => {
        console.log("set stores value successfully");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.Redis.connect(config));

        $(NoSQL.Redis.set(conn, "test:set", "test-value"));

        $(NoSQL.Redis.close(conn));
    });

    test("get retrieves stored value", $ => {
        console.log("get retrieves stored value");

        const config = $.let(TEST_CONFIG);
        const testValue = $.let("test-get-value");

        const conn = $.let(NoSQL.Redis.connect(config));

        // Store value first
        $(NoSQL.Redis.set(conn, "test:get", testValue));

        // Retrieve it
        const retrieved = $.let(NoSQL.Redis.get(conn, "test:get"));

        // Verify value matches
        $.match(retrieved, {
            some: ($, value) => {
                $(Assert.equal(value, testValue));
            },
            none: ($) => $(Assert.fail("Expected to find value")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("get returns None for non-existent key", $ => {
        console.log("get returns None for non-existent key");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.Redis.connect(config));

        // Get non-existent key
        const result = $.let(NoSQL.Redis.get(conn, "test:nonexistent"));

        // Verify it's None
        $.match(result, {
            some: ($) => $(Assert.fail("Expected None for non-existent key")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("set overwrites existing value", $ => {
        console.log("set overwrites existing value");

        const config = $.let(TEST_CONFIG);
        const value1 = $.let("first-value");
        const value2 = $.let("second-value");

        const conn = $.let(NoSQL.Redis.connect(config));

        // Set first value
        $(NoSQL.Redis.set(conn, "test:overwrite", value1));

        // Set second value
        $(NoSQL.Redis.set(conn, "test:overwrite", value2));

        // Verify second value
        const retrieved = $.let(NoSQL.Redis.get(conn, "test:overwrite"));

        $.match(retrieved, {
            some: ($, value) => {
                $(Assert.equal(value, value2));
            },
            none: ($) => $(Assert.fail("Expected to find value")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("del removes stored value", $ => {
        console.log("del removes stored value");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.Redis.connect(config));

        // Store value first
        $(NoSQL.Redis.set(conn, "test:del", "to-be-deleted"));

        // Delete it
        const deleted = $.let(NoSQL.Redis.delete(conn, "test:del"));

        // Verify deletion count is 1
        $(Assert.equal(deleted, East.value(1n)));

        // Verify key no longer exists
        const retrieved = $.let(NoSQL.Redis.get(conn, "test:del"));

        $.match(retrieved, {
            some: ($) => $(Assert.fail("Expected None after deletion")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("del returns 0 for non-existent key", $ => {
        console.log("del returns 0 for non-existent key");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.Redis.connect(config));

        // Delete non-existent key
        const deleted = $.let(NoSQL.Redis.delete(conn, "test:del-nonexistent"));

        // Verify deletion count is 0
        $(Assert.equal(deleted, East.value(0n)));

        $(NoSQL.Redis.close(conn));
    });

    test("setex stores value with expiration", $ => {
        console.log("setex stores value with expiration");

        const config = $.let(TEST_CONFIG);
        const conn = $.let(NoSQL.Redis.connect(config));

        // Store value with 10 second TTL
        $(NoSQL.Redis.setex(conn, "test:setex", "expiring-value", 10n));

        // Verify value exists
        const retrieved = $.let(NoSQL.Redis.get(conn, "test:setex"));

        $.match(retrieved, {
            some: ($, value) => {
                $(Assert.equal(value, East.value("expiring-value")));
            },
            none: ($) => $(Assert.fail("Expected to find value")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("setex overwrites existing value", $ => {
        console.log("setex overwrites existing value");

        const config = $.let(TEST_CONFIG);
        const value1 = $.let("first-expiring");
        const value2 = $.let("second-expiring");

        const conn = $.let(NoSQL.Redis.connect(config));

        // Set first value
        $(NoSQL.Redis.setex(conn, "test:setex-overwrite", value1, 10n));

        // Set second value
        $(NoSQL.Redis.setex(conn, "test:setex-overwrite", value2, 20n));

        // Verify second value
        const retrieved = $.let(NoSQL.Redis.get(conn, "test:setex-overwrite"));

        $.match(retrieved, {
            some: ($, value) => {
                $(Assert.equal(value, value2));
            },
            none: ($) => $(Assert.fail("Expected to find value")),
        });

        $(NoSQL.Redis.close(conn));
    });

    test("handles special characters in keys and values", $ => {
        console.log("handles special characters in keys and values");

        const config = $.let(TEST_CONFIG);
        const specialValue = $.let("hello:world/test@#$%");

        const conn = $.let(NoSQL.Redis.connect(config));

        $(NoSQL.Redis.set(conn, "test:special:key/with@chars", specialValue));

        const retrieved = $.let(NoSQL.Redis.get(conn, "test:special:key/with@chars"));

        $.match(retrieved, {
            some: ($, value) => {
                $(Assert.equal(value, specialValue));
            },
            none: ($) => $(Assert.fail("Expected to find value")),
        });

        $(NoSQL.Redis.close(conn));
    });
}, {
    platformFns: [...NoSQL.Redis.Implementation, ...NodePlatform],
    afterEach: $ => {
        // Close all connections after each test (even on failure)
        $(NoSQL.Redis.closeAll());
    }
});
