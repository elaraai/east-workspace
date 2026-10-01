/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Console writes the text an East program gives it to the host's standard
 * output and standard error, exactly as east-node-std writes it to a
 * process's: a log or error line ends with a newline, a write does not.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { East, NullType, EastError } from "@elaraai/east";
import { Console, ConsoleImpl, createConsoleImpl, globalConsoleSink } from "@elaraai/east-web-std";
import { captureConsole } from "./support.js";

describe("Console writes to the host's sink", () => {
    it("writes each call's text exactly, a line with its newline", () => {
        const sink = captureConsole();
        const program = East.function([], NullType, $ => {
            $(Console.write("Processing... "));
            $(Console.log("done!"));
            $(Console.error("a warning"));
            $(Console.log(""));
            $(Console.write(""));
            $(Console.log("two\nlines"));
        });
        program.toIR().compile(createConsoleImpl(sink))();
        assert.deepEqual(sink.out, ["Processing... ", "done!\n", "\n", "", "two\nlines\n"]);
        assert.deepEqual(sink.err, ["a warning\n"]);
        assert.equal(sink.out.join(""), "Processing... done!\n\ntwo\nlines\n");
    });

    it("passes any text through unchanged", () => {
        const sink = captureConsole();
        const text = "é 日本 🙂 \u0000 \t tab";
        const program = East.function([], NullType, $ => {
            $(Console.write(text));
        });
        program.toIR().compile(createConsoleImpl(sink))();
        assert.deepEqual(sink.out, [text]);
    });

    it("fails the call that wrote with an EastError when the sink throws", () => {
        const broken = {
            stdout: () => { throw new Error("the log is closed"); },
            stderr: () => { throw new Error("the log is closed"); },
        };
        const cases = [
            [East.function([], NullType, $ => { $(Console.log("x")); }), /Failed to write to stdout: the log is closed/],
            [East.function([], NullType, $ => { $(Console.write("x")); }), /Failed to write to stdout: the log is closed/],
            [East.function([], NullType, $ => { $(Console.error("x")); }), /Failed to write to stderr: the log is closed/],
        ] as const;
        for (const [program, message] of cases) {
            assert.throws(
                () => program.toIR().compile(createConsoleImpl(broken))(),
                (error: unknown) => error instanceof EastError && message.test(error.message),
            );
        }
    });
});

describe("the global console sink", () => {
    it("hands standard output to console.log and standard error to console.error, a line without its newline", (t) => {
        const log = t.mock.method(console, "log", () => { });
        const error = t.mock.method(console, "error", () => { });
        globalConsoleSink.stdout("a line\n");
        globalConsoleSink.stdout("a write");
        globalConsoleSink.stdout("two\nlines\n");
        globalConsoleSink.stdout("\n");
        globalConsoleSink.stderr("a warning\n");
        assert.deepEqual(log.mock.calls.map(call => call.arguments), [["a line"], ["a write"], ["two\nlines"], [""]]);
        assert.deepEqual(error.mock.calls.map(call => call.arguments), [["a warning"]]);
    });

    it("is where ConsoleImpl writes", (t) => {
        const log = t.mock.method(console, "log", () => { });
        const error = t.mock.method(console, "error", () => { });
        const program = East.function([], NullType, $ => {
            $(Console.log("Hello, World!"));
            $(Console.error("Error: Invalid input"));
        });
        program.toIR().compile(ConsoleImpl)();
        assert.deepEqual(log.mock.calls.map(call => call.arguments), [["Hello, World!"]]);
        assert.deepEqual(error.mock.calls.map(call => call.arguments), [["Error: Invalid input"]]);
    });
});
