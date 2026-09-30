/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East Web - the standard platform functions for East programs in a browser.
 *
 * The same platform functions, under the same names and East types, as
 * east-node-std's Console, Time, Random, Crypto, Fetch, Path and Test, so an
 * East program written for Node runs in a browser unchanged. It reaches no
 * Node module: only web-standard globals.
 *
 * FileSystem, Env and the large-JSON reader have no browser meaning and are
 * not provided: a program that calls one fails to compile, naming the
 * platform function it called.
 *
 * @packageDocumentation
 */

import type { PlatformFunction } from "@elaraai/east/internal";

// Export test utilities
export * from "./test.js";

// Export platform function definitions and implementations
export * from "./console.js";
export * from "./path.js";
export * from "./crypto.js";
export * from "./time.js";
export * from "./fetch.js";
export * from "./random.js";

// Import implementations for combined export
import { ConsoleImpl, createConsoleImpl, globalConsoleSink, type ConsoleSink } from "./console.js";
import { PathImpl } from "./path.js";
import { CryptoImpl } from "./crypto.js";
import { TimeImpl } from "./time.js";
import { FetchImpl } from "./fetch.js";
import { RandomImpl, createRandomImpl } from "./random.js";
import { TestImpl, createTestImpl, type TestHost } from "./test.js";

/**
 * What a host gives the platform it runs a program on.
 */
export interface WebPlatformOptions {
    /**
     * Where the program's console output goes: the host's standard output and
     * standard error. Defaults to the global `console`
     * ({@link globalConsoleSink}).
     */
    console?: ConsoleSink;

    /**
     * Runs the suites and tests an East test program declares. Defaults to
     * running them in place (see {@link TestImpl}).
     */
    test?: TestHost;
}

/**
 * Creates a complete browser platform for one program.
 *
 * The platform holds east-node-std's platform functions that mean the same in
 * a browser — Console, Path, Crypto, Time, Fetch, Random and Test — writing
 * console output to the host's sink and running tests through its host.
 * Random starts unseeded, with a generator no other platform shares.
 *
 * @param options - The host's console sink and test host
 * @returns The platform functions, to pass to `compile()` or `compileAsync()`
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Console, createWebPlatform } from "@elaraai/east-web-std";
 *
 * let stdout = "";
 * const fn = East.asyncFunction([], NullType, $ => {
 *     $(Console.log("Hello from a browser"));
 * });
 *
 * const platform = createWebPlatform({
 *     console: { stdout: text => { stdout += text; }, stderr: text => { stdout += text; } },
 * });
 * await fn.toIR().compile(platform)();  // stdout is now "Hello from a browser\n"
 * ```
 */
export function createWebPlatform(options: WebPlatformOptions = {}): PlatformFunction[] {
    return [
        ...createConsoleImpl(options.console ?? globalConsoleSink),
        ...PathImpl,
        ...CryptoImpl,
        ...TimeImpl,
        ...FetchImpl,
        ...createRandomImpl(),
        ...createTestImpl(options.test),
    ];
}

/**
 * Complete browser platform implementation.
 *
 * Pass this array to `compile()` or `compileAsync()` to enable all the
 * browser's platform functions. Console output goes to the global `console`,
 * tests run in place, and every program compiled with it shares one Random
 * generator; use {@link createWebPlatform} to give a program its own.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { WebPlatform, Console, Crypto } from "@elaraai/east-web-std";
 *
 * const fn = East.asyncFunction([], NullType, $ => {
 *     const id = $.let(Crypto.uuid());
 *     $(Console.log(id));
 * });
 *
 * // An async East function, since Time.sleep and Fetch are async
 * const compiled = fn.toIR().compile(WebPlatform);
 * await compiled();
 * ```
 */
export const WebPlatform: PlatformFunction[] = [
    ...ConsoleImpl,
    ...PathImpl,
    ...CryptoImpl,
    ...TimeImpl,
    ...FetchImpl,
    ...RandomImpl,
    ...TestImpl,
];
