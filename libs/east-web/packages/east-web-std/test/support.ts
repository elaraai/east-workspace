/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test } from "node:test";
import type { ConsoleSink, TestHost } from "@elaraai/east-web-std";

/** Runs East's suites and tests as `node:test`'s, as east-node-std's TestImpl does. */
export const nodeTestHost: TestHost = {
    describe: (name, body) => describe(name, body),
    test: (name, body) => test(name, body),
};

/** A console sink that keeps what a program writes, stream by stream. */
export interface CapturedConsole extends ConsoleSink {
    /** Everything written to standard output, in order. */
    readonly out: string[];
    /** Everything written to standard error, in order. */
    readonly err: string[];
}

/** A sink that keeps each write, for a spec to read back. */
export function captureConsole(): CapturedConsole {
    const out: string[] = [];
    const err: string[] = [];
    return {
        out,
        err,
        stdout: (text: string) => { out.push(text); },
        stderr: (text: string) => { err.push(text); },
    };
}
