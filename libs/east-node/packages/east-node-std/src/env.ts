/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, OptionType, some, none } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

/**
 * Reads an environment variable from the process environment.
 *
 * Returns `some(value)` when the variable is set (including when set to the
 * empty string) and `none` when it is not set. Like `Time.now()`, this is an
 * impure platform function: the value comes from the process environment at
 * runtime and is never part of the compiled program.
 *
 * This is the supported way to consume credentials in East programs — the IR
 * carries only the variable *name*, and whatever launched the process supplies
 * the value (a developer's shell locally, a secret store in hosted runtimes).
 * Never write a credential as a string literal: East IR is content-addressed,
 * stored, exported, and replicated, so a literal secret in it is effectively
 * unredactable.
 *
 * This is a platform function for the East language, enabling environment
 * access in East programs running on Node.js.
 *
 * @param name - The environment variable name (e.g. "ERP_DB_PASSWORD")
 * @returns `some(value)` if the variable is set, `none` otherwise
 *
 * @example
 * ```ts
 * const readToken = East.function([], OptionType(StringType), $ => {
 *     return Env.get("API_TOKEN");
 *     // Returns: some("...") when API_TOKEN is set, none otherwise
 * });
 * ```
 */
export const env_get = East.platform("env_get", [StringType], OptionType(StringType));

/**
 * Node.js implementation of environment platform functions.
 *
 * Pass this array to {@link East.compile} or {@link East.compileAsync} to
 * enable environment access.
 */
const EnvImpl: PlatformFunction[] = [
    env_get.implement((name: string) => {
        try {
            const value = process.env[name];
            return value === undefined ? none : some(value);
        } catch (err: any) {
            throw new EastError(`Failed to read environment variable "${name}": ${err.message}`, {
                location: [{ filename: "env_get", line: 0n, column: 0n }],
                cause: err,
            });
        }
    }),
];

/**
 * Grouped environment platform functions.
 *
 * Provides read access to process environment variables for East programs.
 * Use this for values that must be supplied by the runtime environment rather
 * than compiled into the program — above all credentials, which must never
 * appear as literals in East code (the IR is content-addressed and replicated;
 * a literal secret in it cannot be redacted).
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Env } from "@elaraai/east-node-std";
 *
 * const connectionPassword = East.function([], StringType, $ => {
 *     // Name in IR; value from the environment. `.unwrap()` errors at
 *     // runtime if the variable is not set.
 *     return Env.get("ERP_DB_PASSWORD").unwrap();
 * });
 *
 * const compiled = East.compile(connectionPassword.toIR(), Env.Implementation);
 * compiled();
 * ```
 */
export const Env = {
    /**
     * Reads an environment variable from the process environment.
     *
     * Returns `some(value)` when the variable is set (including when set to
     * the empty string) and `none` when it is not set. Impure by design —
     * the value is read at runtime and never participates in the compiled
     * program or task input hashing, which is the desired semantics for
     * credentials: rotating a secret does not invalidate caches.
     *
     * Use `.unwrap()` on the result for the must-exist case, or
     * `.unwrap("some", $ => ...)` to supply a default.
     *
     * @param name - The environment variable name (e.g. "ERP_DB_PASSWORD")
     * @returns `some(value)` if the variable is set, `none` otherwise
     *
     * @example
     * ```ts
     * const readToken = East.function([], OptionType(StringType), $ => {
     *     return Env.get("API_TOKEN");
     * });
     *
     * const compiled = East.compile(readToken.toIR(), Env.Implementation);
     * compiled();  // Returns: some("...") when API_TOKEN is set, none otherwise
     * ```
     */
    get: env_get,

    /**
     * Node.js implementation of environment platform functions.
     *
     * Pass this to {@link East.compile} or {@link East.compileAsync} to
     * enable environment access.
     */
    Implementation: EnvImpl,
} as const;

// Export for consistency with the other module implementation arrays
export { EnvImpl };
