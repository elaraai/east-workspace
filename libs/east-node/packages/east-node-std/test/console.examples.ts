/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, NullType, example } from "@elaraai/east";
import { Console } from "@elaraai/east-node-std";

export const consoleLog = example({
    keywords: ["console", "Console", "log", "print", "stdout"],
    description: "Log a message to stdout",
    fn: East.asyncFunction([], NullType, ($) => {
        $(Console.log("Hello, World!"));
    }),
    inputs: [],
});

export const consoleError = example({
    keywords: ["console", "Console", "error", "stderr"],
    description: "Log an error message to stderr",
    fn: East.asyncFunction([], NullType, ($) => {
        $(Console.error("Error message"));
    }),
    inputs: [],
});

export const consoleWrite = example({
    keywords: ["console", "Console", "write", "stdout", "no newline"],
    description: "Write a message to stdout without a trailing newline",
    fn: East.asyncFunction([], NullType, ($) => {
        $(Console.write("No newline"));
    }),
    inputs: [],
});
