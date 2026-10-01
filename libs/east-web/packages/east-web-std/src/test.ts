/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { AsyncFunctionType, East, NullType, StringType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";

/**
 * Platform function that indicates a test assertion passed.
 *
 * This is used by East test code to signal successful assertions. It does
 * nothing: the test continues.
 */
const testPass = East.platform("testPass", [], NullType);

/**
 * Platform function that indicates a test assertion failed.
 *
 * This is used by East test code to signal failed assertions. It throws a
 * {@link TestFailure}, which fails the test.
 *
 * @param message - The error message describing the assertion failure
 */
const testFail = East.platform("testFail", [StringType], NullType);

/**
 * Platform function that defines a single test case.
 *
 * This is used by East test code to define individual tests. The host's
 * {@link TestHost.test} runs it.
 *
 * @param name - The name of the test
 * @param body - The test body function
 */
const test = East.asyncPlatform("test", [StringType, AsyncFunctionType([], NullType)], NullType);

/**
 * Platform function that defines a test suite.
 *
 * This is used by East test code to group related tests. The host's
 * {@link TestHost.describe} runs it.
 *
 * @param name - The name of the test suite
 * @param body - A function that calls test() to define tests
 */
const describe = East.asyncPlatform("describe", [StringType, AsyncFunctionType([], NullType)], NullType);

/**
 * A failed East test assertion: what `testFail` throws.
 *
 * It is not an `EastError`, so an East `try`/`catch` does not catch it — as it
 * does not catch the `node:assert` error east-node-std throws — and an
 * assertion that fails inside one still fails the test.
 */
export class TestFailure extends Error {
    /**
     * @param message - What failed
     * @param options - The error that caused it, if any
     */
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "TestFailure";
    }
}

/**
 * Runs the suites and tests an East test program declares.
 *
 * The program calls `describe` and `test` (as east-node-std's `describeEast`
 * builds them, and as east-node-std's exported compliance suite does), and
 * the host decides how each runs and where its result goes: in place
 * (the default), through `node:test`, or into a browser test page's report.
 *
 * @remarks
 * A test's body rejects when an assertion in it fails, with a
 * {@link TestFailure}, or when the East code in it throws.
 */
export interface TestHost {
    /**
     * Runs a suite: `body` declares its tests, calling {@link TestHost.test}.
     *
     * @param name - The suite's name
     * @param body - The suite's body
     */
    describe(name: string, body: () => Promise<void>): Promise<void>;

    /**
     * Runs one test.
     *
     * @param name - The test's name
     * @param body - The test's body, which rejects when the test fails
     */
    test(name: string, body: () => Promise<void>): Promise<void>;
}

/** A failure in place: the suites it was in, the test's name last. */
interface Failure {
    path: readonly string[];
    error: unknown;
}

/** The message of whatever a failing body threw. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}

/**
 * A host that runs each suite and test where the program declares it.
 *
 * Every test runs, whether or not the ones before it passed. When the
 * outermost suite ends, it fails with a {@link TestFailure} that lists every
 * failure in it, so the program fails when a test did. A test declared
 * outside any suite fails the program at once.
 */
function inPlaceTestHost(): TestHost {
    const suites: string[] = [];
    const failures: Failure[] = [];
    return {
        async describe(name: string, body: () => Promise<void>): Promise<void> {
            suites.push(name);
            try {
                await body();
            } catch (error) {
                // The suite failed outside its tests
                failures.push({ path: [...suites], error });
            } finally {
                suites.pop();
            }
            if (suites.length === 0 && failures.length > 0) {
                const failed = failures.splice(0);
                const lines = failed.map(({ path, error }) => `  ${path.join(" > ")}: ${messageOf(error)}`);
                throw new TestFailure(`East tests failed:\n${lines.join("\n")}`, { cause: failed[0]!.error });
            }
        },
        async test(name: string, body: () => Promise<void>): Promise<void> {
            try {
                await body();
            } catch (error) {
                if (suites.length === 0) {
                    throw new TestFailure(`${name}: ${messageOf(error)}`, { cause: error });
                }
                failures.push({ path: [...suites, name], error });
            }
        },
    };
}

/**
 * Creates the test platform functions — `testPass`, `testFail`, `test` and
 * `describe` — over a host that runs them.
 *
 * These are the functions east-node-std's `describeEast` and `Assert` build
 * East tests from, and so the functions its exported compliance suite calls.
 *
 * @param host - Runs the suites and tests; by default, in place (see
 *   {@link TestImpl})
 * @returns The test platform functions
 *
 * @example
 * ```ts
 * import { createWebPlatform, type TestHost } from "@elaraai/east-web-std";
 *
 * const results: string[] = [];
 * const recording: TestHost = {
 *     describe: async (_name, body) => { await body(); },
 *     test: async (name, body) => {
 *         try { await body(); results.push(`pass ${name}`); }
 *         catch (error) { results.push(`fail ${name}`); }
 *     },
 * };
 * const platform = createWebPlatform({ test: recording });
 * ```
 */
export function createTestImpl(host: TestHost = inPlaceTestHost()): PlatformFunction[] {
    return [
        testPass.implement(() => { }), // Assertion passed - do nothing (test continues)
        testFail.implement((message: string) => {
            // Assertion failed - throw to fail the test
            throw new TestFailure(message);
        }),
        test.implement(async (name: string, body: () => Promise<null>) => {
            await host.test(name, async () => { await body(); });
        }),
        describe.implement(async (name: string, body: () => Promise<null>) => {
            await host.describe(name, async () => { await body(); });
        }),
    ];
}

/**
 * The test platform functions, running each suite and test in place.
 *
 * Every test runs; when the outermost suite ends, it fails with a
 * {@link TestFailure} listing every test that failed, so a test program
 * fails when a test did. Give `createWebPlatform` (or
 * {@link createTestImpl}) a {@link TestHost} to report tests another way.
 *
 * @remarks
 * Its failures are kept for the suite that is running, so run one test
 * program at a time over it; each {@link createTestImpl} keeps its own.
 */
export const TestImpl: PlatformFunction[] = createTestImpl();
