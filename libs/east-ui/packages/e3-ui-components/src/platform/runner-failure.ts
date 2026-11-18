/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A runner's failure, as every stock runner reports it on stderr: one reading
 * of it for each part of the renderer that says why a run ended — a query's
 * run (`query/one-shot.ts`), and a call a draft's mutation ended
 * (`func-runtime.ts`, east-workspace#1624), whose record's words are its
 * message.
 *
 * @packageDocumentation
 */

/** A failure as every stock runner reports it on stderr. */
export interface RunnerFailure {
    /** The error's message. */
    readonly message: string;
    /** Where it was raised, innermost first: a file, and a 1-based line and column. */
    readonly places: readonly { readonly file: string; readonly line: number; readonly column: number }[];
}

/** The line that leads a runner's failure. */
const FAILURE_LEAD = "Error: ";

/** A place a failure was raised at, as a runner lists it under the failure. */
const FAILURE_PLACE = /^ {2}at (.+):(\d+):(\d+)$/;

/**
 * The failure a runner reported: `Error: <message>`, then `  at <file>:<line>:<column>`
 * for each place, innermost first, as east-c, east-node and east-py all write it.
 *
 * @param stderr - the tail of the runner's stderr
 * @returns the failure, or `undefined` when the runner reported none
 */
export function runnerFailureOf(stderr: string): RunnerFailure | undefined {
    const lines = stderr.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const places: { file: string; line: number; column: number }[] = [];
    let end = lines.length;
    for (; end > 0; end--) {
        const place = FAILURE_PLACE.exec(lines[end - 1]!);
        if (place === null) break;
        places.unshift({ file: place[1]!, line: Number(place[2]), column: Number(place[3]) });
    }
    let start = end - 1;
    while (start >= 0 && !lines[start]!.startsWith(FAILURE_LEAD)) start--;
    if (start < 0) return undefined;
    return { message: [lines[start]!.slice(FAILURE_LEAD.length), ...lines.slice(start + 1, end)].join("\n"), places };
}
