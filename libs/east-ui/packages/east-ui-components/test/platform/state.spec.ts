/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe, beforeEach } from "node:test";
import { East, IntegerType, StringType, BooleanType, NullType, type BlockBuilder } from "@elaraai/east";
import { createTestPlatform, Assert } from "../platforms.spec.js";
import { State } from "@elaraai/east-ui";
import { getStore } from "../../src/platform/state-runtime.js";

const platform = createTestPlatform();

/**
 * Defines and runs an East test against the State platform.
 */
function testState(name: string, body: ($: BlockBuilder<NullType>) => void) {
    test(name, () => {
        const testFn = East.function([], NullType, body);
        const compiled = testFn.toIR().compile(platform);
        compiled();
    });
}

describe("State.bind", () => {
    beforeEach(() => {
        const store = getStore();
        store.write("counter", undefined);
        store.write("name", undefined);
        store.write("test_key", undefined);
        store.write("keyA", undefined);
        store.write("keyB", undefined);
        store.write("keyC", undefined);
    });

    // =========================================================================
    // Basic read/write through bind closures
    // =========================================================================

    testState("writes and reads integer value", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        $(counter.write(42n));
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 42n));
    });

    testState("writes and reads string value", $ => {
        const name = $.let(State.bind([StringType], "name", ""));
        $(name.write("hello"));
        const result = $.let(name.read(), StringType);
        $(Assert.equal(result, "hello"));
    });

    testState("bind initializes key to default value on first use", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 7n));
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 7n));
    });

    // =========================================================================
    // Increment pattern
    // =========================================================================

    testState("increments counter", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        const count = $.let(counter.read(), IntegerType);
        $(counter.write(count.add(1n)));
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 1n));
    });

    testState("increments counter multiple times", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        $.for(East.Array.range(0n, 3n), ($, _item, _i) => {
            const current = $.let(counter.read(), IntegerType);
            $(counter.write(current.add(1n)));
        });
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 3n));
    });

    // =========================================================================
    // Overwrite
    // =========================================================================

    testState("overwrites existing value", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        $(counter.write(10n));
        $(counter.write(20n));
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 20n));
    });

    // =========================================================================
    // Multiple independent keys
    // =========================================================================

    testState("handles multiple independent keys", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        const name = $.let(State.bind([StringType], "name", ""));
        $(counter.write(100n));
        $(name.write("Alice"));

        const countValue = $.let(counter.read(), IntegerType);
        const nameValue = $.let(name.read(), StringType);

        $(Assert.equal(countValue, 100n));
        $(Assert.equal(nameValue, "Alice"));
    });

    // =========================================================================
    // Cross-function persistence
    // =========================================================================

    testState("persists state across inner function calls", $ => {
        const writeFn = East.function([], NullType, $ => {
            const counter = $.let(State.bind([IntegerType], "counter", 0n));
            $(counter.write(42n));
        });

        const readFn = East.function([], IntegerType, $ => {
            const counter = $.let(State.bind([IntegerType], "counter", 0n));
            return counter.read();
        });

        $(writeFn());
        const result = $.let(readFn(), IntegerType);
        $(Assert.equal(result, 42n));
    });

    testState("accumulates across multiple inner function calls", $ => {
        const incrementFn = East.function([], NullType, $ => {
            const counter = $.let(State.bind([IntegerType], "counter", 0n));
            const current = $.let(counter.read(), IntegerType);
            $(counter.write(current.add(1n)));
        });

        $.for(East.Array.range(0n, 5n), ($, _item, _i) => {
            $(incrementFn());
        });

        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        const result = $.let(counter.read(), IntegerType);
        $(Assert.equal(result, 5n));
    });

    // =========================================================================
    // has()
    // =========================================================================

    testState("has returns true after bind initializes the key", $ => {
        const counter = $.let(State.bind([IntegerType], "counter", 0n));
        const exists = $.let(counter.has(), BooleanType);
        $(Assert.equal(exists, true));
    });
});
