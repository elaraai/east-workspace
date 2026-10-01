/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The test platform functions run an East test program's suites and tests
 * through a host: in place by default, so a program fails when a test did,
 * and through the host a page or runner gives otherwise. A failed assertion
 * is no `EastError`, so an East `try` cannot swallow it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncFunctionType, East, NullType, StringType } from "@elaraai/east";
import { Assert, describeEast } from "@elaraai/east-node-std";
import { Console, TestFailure, createTestImpl, createWebPlatform, type TestHost } from "@elaraai/east-web-std";
import { captureConsole } from "./support.js";

/** A TestFailure whose message matches. */
const testFailure = (message: RegExp) => (error: unknown): boolean => error instanceof TestFailure && message.test(error.message);

describe("the in-place test host", () => {
    it("runs every test, and fails the suite naming each failure", async () => {
        const sink = captureConsole();
        await assert.rejects(
            describeEast("Arithmetic", (test) => {
                test("adds", $ => {
                    $(Console.log("adds"));
                    $(Assert.equal(East.value(1n).add(1n), 2n));
                });
                test("subtracts wrongly", $ => {
                    $(Console.log("subtracts"));
                    $(Assert.equal(East.value(2n).subtract(1n), 5n));
                });
                test("multiplies", $ => {
                    $(Console.log("multiplies"));
                    $(Assert.equal(East.value(2n).multiply(3n), 6n));
                });
            }, { platformFns: createWebPlatform({ console: sink }) }) as Promise<null>,
            testFailure(/^East tests failed:\n {2}Arithmetic > subtracts wrongly: Expected 1 to equal 5/),
        );
        assert.deepEqual(sink.out, ["adds\n", "subtracts\n", "multiplies\n"]);
    });

    it("passes a suite whose tests all pass", async () => {
        const sink = captureConsole();
        await describeEast("Strings", (test) => {
            test("concatenates", $ => {
                const joined = $.let(East.value("Hello").concat(" World"));
                $(Console.log(joined));
                $(Assert.equal(joined, "Hello World"));
            });
        }, { platformFns: createWebPlatform({ console: sink }) });
        assert.deepEqual(sink.out, ["Hello World\n"]);
    });

    it("fails an assertion inside an East try, which cannot catch it", async () => {
        // Assert.throws runs its expression in an East try and fails from
        // inside it when nothing threw: were a failure an EastError, the try
        // would catch it and the test would pass
        await assert.rejects(
            describeEast("Throws", (test) => {
                test("expects an error that never comes", $ => {
                    $(Assert.throws(East.value(1n).add(1n)));
                });
            }, { platformFns: createWebPlatform({ console: captureConsole() }) }) as Promise<null>,
            testFailure(/Throws > expects an error that never comes: Expected error, got 2/),
        );
    });

    it("passes an assertion that an East error was thrown", async () => {
        await describeEast("Throws", (test) => {
            test("sees the error", $ => {
                $(Assert.throws(East.value(1n).divide(0n)));
            });
        }, { platformFns: createWebPlatform({ console: captureConsole() }) });
    });

    it("fails a test outside any suite at once, naming it", async () => {
        const test = East.asyncPlatform("test", [StringType, AsyncFunctionType([], NullType)], NullType);
        const program = East.asyncFunction([], NullType, $ => {
            $(test("alone", East.asyncFunction([], NullType, $ => {
                $(Assert.fail("on its own"));
            })));
        });
        await assert.rejects(program.toIR().compile(createTestImpl())(), testFailure(/^alone: on its own/));
    });
});

describe("a host of the page's own", () => {
    it("receives each suite and test the program declares, and runs them", async () => {
        const calls: string[] = [];
        const recording: TestHost = {
            describe: async (name, body) => {
                calls.push(`describe ${name}`);
                await body();
            },
            test: async (name, body) => {
                calls.push(`test ${name}`);
                try {
                    await body();
                    calls.push(`passed ${name}`);
                } catch (error) {
                    calls.push(`failed ${name}: ${error instanceof TestFailure}`);
                }
            },
        };
        await describeEast("Recorded", (test) => {
            test("passes", $ => { $(Assert.equal(East.value(1n), 1n)); });
            test("fails", $ => { $(Assert.equal(East.value(1n), 2n)); });
        }, { platformFns: createWebPlatform({ console: captureConsole(), test: recording }) });
        assert.deepEqual(calls, [
            "describe Recorded",
            "test passes",
            "passed passes",
            "test fails",
            "failed fails: true",
        ]);
    });
});
