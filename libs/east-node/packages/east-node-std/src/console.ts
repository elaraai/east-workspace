/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, NullType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { stdout } from "node:process";

/**
 * Writes a message to stdout with a newline.
 *
 * Outputs a string message to standard output (stdout) followed by a newline character.
 * This is useful for general logging and output in East programs.
 *
 * This is a platform function for the East language, enabling console output
 * in East programs running on Node.js.
 *
 * @param message - The message to write to stdout
 * @returns Null
 *
 * @throws {EastError} When writing to stdout fails (rare, typically only on broken pipes)
 *
 * @example
 * ```ts
 * const logMessage = East.function([], NullType, $ => {
 *     $(Console.log("Hello, World!"));
 * });
 * ```
 */
export const console_log = East.platform("console_log", [StringType], NullType);

/**
 * Writes a message to stderr with a newline.
 *
 * Outputs a string message to standard error (stderr) followed by a newline character.
 * This is used for error messages and warnings, keeping them separate from normal output.
 *
 * This is a platform function for the East language, enabling error output
 * in East programs running on Node.js.
 *
 * @param message - The message to write to stderr
 * @returns Null
 *
 * @throws {EastError} When writing to stderr fails (rare, typically only on broken pipes)
 *
 * @example
 * ```ts
 * const logError = East.function([], NullType, $ => {
 *     $(Console.error("Error: Invalid input"));
 * });
 * ```
 */
export const console_error = East.platform("console_error", [StringType], NullType);

/**
 * Writes a message to stdout without a newline.
 *
 * Outputs a string message to standard output (stdout) without appending a newline.
 * This allows building output incrementally or creating progress indicators on a single line.
 *
 * This is a platform function for the East language, enabling raw console output
 * in East programs running on Node.js.
 *
 * @param message - The message to write to stdout
 * @returns Null
 *
 * @throws {EastError} When writing to stdout fails (rare, typically only on broken pipes)
 *
 * @example
 * ```ts
 * const showProgress = East.function([], NullType, $ => {
 *     $(Console.write("Processing... "));
 *     $(Console.log("done!"));
 * });
 * ```
 */
export const console_write = East.platform("console_write", [StringType], NullType);

/**
 * Node.js implementation of console platform functions.
 *
 * Pass this array to {@link East.compile} to enable console I/O operations.
 */
const ConsoleImpl: PlatformFunction[] = [
    console_log.implement((msg: string) => {
        try {
            console.log(msg);
        } catch (err: any) {
            throw new EastError(`Failed to write to stdout: ${err.message}`, {
                location: [{ filename: "console_log", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    console_error.implement((msg: string) => {
        try {
            console.error(msg);
        } catch (err: any) {
            throw new EastError(`Failed to write to stderr: ${err.message}`, {
                location: [{ filename: "console_error", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    console_write.implement((msg: string) => {
        try {
            stdout.write(msg);
        } catch (err: any) {
            throw new EastError(`Failed to write to stdout: ${err.message}`, {
                location: [{ filename: "console_write", line: 0n, column: 0n }],
                cause: err
            });
        }
    })
];

/**
 * Grouped console I/O platform functions.
 *
 * Provides standard console operations for East programs.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Console } from "@elaraai/east-node-std";
 *
 * const greet = East.function([], NullType, $ => {
 *     $(Console.log("Hello, World!"));
 *     $(Console.error("This is a warning"));
 *     $(Console.write("No newline here"));
 * });
 *
 * const compiled = East.compile(greet.toIR(), Console.Implementation);
 * await compiled();
 * ```
 */
export const Console = {
    /**
     * Writes a message to stdout with a newline.
     *
     * Outputs a string message to standard output (stdout) followed by a newline character.
     * This is useful for general logging and output in East programs.
     *
     * @param message - The message to write to stdout
     * @returns Null
     * @throws {EastError} When writing to stdout fails
     *
     * @example
     * ```ts
     * const logMessage = East.function([], NullType, $ => {
     *     $(Console.log("Hello, World!"));
     * });
     *
     * const compiled = East.compile(logMessage.toIR(), Console.Implementation);
     * await compiled();  // Outputs: Hello, World!
     * ```
     */
    log: console_log,

    /**
     * Writes a message to stderr with a newline.
     *
     * Outputs a string message to standard error (stderr) followed by a newline character.
     * This is used for error messages and warnings, keeping them separate from normal output.
     *
     * @param message - The message to write to stderr
     * @returns Null
     * @throws {EastError} When writing to stderr fails
     *
     * @example
     * ```ts
     * const logError = East.function([], NullType, $ => {
     *     $(Console.error("Error: Invalid input"));
     * });
     *
     * const compiled = East.compile(logError.toIR(), Console.Implementation);
     * await compiled();  // Outputs to stderr: Error: Invalid input
     * ```
     */
    error: console_error,

    /**
     * Writes a message to stdout without a newline.
     *
     * Outputs a string message to standard output (stdout) without appending a newline.
     * This allows building output incrementally or creating progress indicators.
     *
     * @param message - The message to write to stdout
     * @returns Null
     * @throws {EastError} When writing to stdout fails
     *
     * @example
     * ```ts
     * const showProgress = East.function([], NullType, $ => {
     *     $(Console.write("Processing... "));
     *     $(Console.log("done!"));
     * });
     *
     * const compiled = East.compile(showProgress.toIR(), Console.Implementation);
     * await compiled();  // Outputs: Processing... done!
     * ```
     */
    write: console_write,

    /**
     * Node.js implementation of console platform functions.
     *
     * Pass this to {@link East.compile} to enable console I/O operations.
     */
    Implementation: ConsoleImpl,
} as const;

// Export for backwards compatibility
export { ConsoleImpl };

/**
East.package(
    name: "console",
    ....

)



import(..)



ed3 import ./path_to_east_desdcribing_package...


ed3 run console.log "Hello, World!"

 */