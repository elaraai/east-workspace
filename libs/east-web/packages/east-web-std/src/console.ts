/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, NullType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

/**
 * Where an East program's console output goes: its host's standard output
 * and standard error.
 *
 * A browser has no standard streams, so the host that runs the program gives
 * them: e3-web appends each to the execution's log, and
 * {@link globalConsoleSink} hands each to the page's `console`. Each call
 * carries the text the program wrote, exactly — {@link Console.log} and
 * {@link Console.error} end it with a newline, {@link Console.write} does not
 * — so a sink that appends it to a log holds what east-node-std writes to
 * its process's streams.
 *
 * @remarks
 * A sink that throws fails the East call that wrote, with an `EastError`.
 */
export interface ConsoleSink {
    /** Takes text the program writes to standard output. */
    stdout(text: string): void;
    /** Takes text the program writes to standard error. */
    stderr(text: string): void;
}

/** The text without its final newline, when it ends with one. */
function withoutFinalNewline(text: string): string {
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * The global `console` as a {@link ConsoleSink}: standard output to
 * `console.log`, standard error to `console.error`.
 *
 * A console shows each call as one entry, so a write becomes an entry of its
 * own, and the newline that ends a line is dropped rather than shown as an
 * empty line below it.
 *
 * @remarks
 * This is the sink {@link ConsoleImpl} and `WebPlatform` write to. A host
 * that keeps a log gives `createWebPlatform` its own sink instead.
 */
export const globalConsoleSink: ConsoleSink = {
    stdout: (text: string) => { console.log(withoutFinalNewline(text)); },
    stderr: (text: string) => { console.error(withoutFinalNewline(text)); },
};

/**
 * Writes a message to stdout with a newline.
 *
 * Outputs a string message to standard output (stdout) followed by a newline character.
 * This is useful for general logging and output in East programs.
 *
 * This is a platform function for the East language, enabling console output
 * in East programs running in a browser, where the host's {@link ConsoleSink}
 * is standard output.
 *
 * @param message - The message to write to stdout
 * @returns Null
 *
 * @throws {EastError} When the host's sink fails to take the output
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
 * in East programs running in a browser, where the host's {@link ConsoleSink}
 * is standard error.
 *
 * @param message - The message to write to stderr
 * @returns Null
 *
 * @throws {EastError} When the host's sink fails to take the output
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
 * in East programs running in a browser, where the host's {@link ConsoleSink}
 * is standard output.
 *
 * @param message - The message to write to stdout
 * @returns Null
 *
 * @throws {EastError} When the host's sink fails to take the output
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
 * Creates the console platform functions over a host's sink.
 *
 * @param sink - Where the program's standard output and standard error go
 * @returns The console platform functions, writing to `sink`
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Console, createConsoleImpl } from "@elaraai/east-web-std";
 *
 * let stdout = "";
 * const greet = East.function([], NullType, $ => {
 *     $(Console.write("Hello, "));
 *     $(Console.log("World!"));
 * });
 *
 * const compiled = East.compile(greet, createConsoleImpl({
 *     stdout: text => { stdout += text; },
 *     stderr: () => {},
 * }));
 * compiled();  // stdout is now "Hello, World!\n"
 * ```
 */
export function createConsoleImpl(sink: ConsoleSink): PlatformFunction[] {
    return [
        console_log.implement((msg: string) => {
            try {
                sink.stdout(`${msg}\n`);
            } catch (err: any) {
                throw new EastError(`Failed to write to stdout: ${err.message}`, {
                    location: [{ filename: "console_log", line: 0n, column: 0n }],
                    cause: err
                });
            }
        }),
        console_error.implement((msg: string) => {
            try {
                sink.stderr(`${msg}\n`);
            } catch (err: any) {
                throw new EastError(`Failed to write to stderr: ${err.message}`, {
                    location: [{ filename: "console_error", line: 0n, column: 0n }],
                    cause: err
                });
            }
        }),
        console_write.implement((msg: string) => {
            try {
                sink.stdout(msg);
            } catch (err: any) {
                throw new EastError(`Failed to write to stdout: ${err.message}`, {
                    location: [{ filename: "console_write", line: 0n, column: 0n }],
                    cause: err
                });
            }
        }),
    ];
}

/**
 * Browser implementation of console platform functions, writing to the
 * global `console` ({@link globalConsoleSink}).
 *
 * Pass this array to {@link East.compile} to enable console I/O operations.
 */
const ConsoleImpl: PlatformFunction[] = createConsoleImpl(globalConsoleSink);

/**
 * Grouped console I/O platform functions.
 *
 * Provides standard console operations for East programs.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Console } from "@elaraai/east-web-std";
 *
 * const greet = East.function([], NullType, $ => {
 *     $(Console.log("Hello, World!"));
 *     $(Console.error("This is a warning"));
 *     $(Console.write("No newline here"));
 * });
 *
 * const compiled = East.compile(greet, Console.Implementation);
 * compiled();
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
     * @throws {EastError} When the host's sink fails to take the output
     *
     * @example
     * ```ts
     * const logMessage = East.function([], NullType, $ => {
     *     $(Console.log("Hello, World!"));
     * });
     *
     * const compiled = East.compile(logMessage, Console.Implementation);
     * compiled();  // Outputs: Hello, World!
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
     * @throws {EastError} When the host's sink fails to take the output
     *
     * @example
     * ```ts
     * const logError = East.function([], NullType, $ => {
     *     $(Console.error("Error: Invalid input"));
     * });
     *
     * const compiled = East.compile(logError, Console.Implementation);
     * compiled();  // Outputs to stderr: Error: Invalid input
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
     * @throws {EastError} When the host's sink fails to take the output
     *
     * @example
     * ```ts
     * const showProgress = East.function([], NullType, $ => {
     *     $(Console.write("Processing... "));
     *     $(Console.log("done!"));
     * });
     *
     * const compiled = East.compile(showProgress, Console.Implementation);
     * compiled();  // Outputs: Processing... done!
     * ```
     */
    write: console_write,

    /**
     * Browser implementation of console platform functions, writing to the
     * global `console`.
     *
     * Pass this to {@link East.compile} to enable console I/O operations.
     */
    Implementation: ConsoleImpl,
} as const;

// Exported beside `Console.Implementation`, as east-node-std exports it
export { ConsoleImpl };
