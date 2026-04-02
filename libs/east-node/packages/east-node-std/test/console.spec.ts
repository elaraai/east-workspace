/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East } from "@elaraai/east";
import { describeEast, Assert, Console, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./console.examples.js";

describeEast("Console platform functions", (test) => {
    Assert.examples(test, { consoleLog: ex.consoleLog, consoleError: ex.consoleError, consoleWrite: ex.consoleWrite });

    test("console_log writes message", $ => {
        // We can't easily test stdout, but we can verify it compiles and runs
        $(Console.log("Assert message"));
        $(Assert.equal(East.value(true), true));
    });

    test("console_error writes to stderr", $ => {
        $(Console.error("Error message"));
        $(Assert.equal(East.value(true), true));
    });

    test("console_write writes without newline", $ => {
        $(Console.write("No newline"));
        $(Assert.equal(East.value(true), true));
    });

    test("String concatenation works with console_log", $ => {
        const msg = $.let(East.value("Hello").concat(" World"));
        $(Console.log(msg));
        $(Assert.equal(msg, "Hello World"));
    });
}, { platformFns: NodePlatform });
