/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `$now` in the jq a person writes (#1670, #1674): the minute a query is
 * asked, which a program reads once it binds it — `.now as $now` — before its
 * data source. The steps bind it themselves, for an "is in the last" condition
 * and for a jq step that reads it (`queryReadsNow`, `print.ts`); the jq view is
 * the program as typed, where nothing binds it for the writer, and East's
 * checker says only that `$now` is not bound.
 *
 * {@link withNowFix} gives that problem its fix — the bind, written first, as
 * the steps write it — so jq that reads the minute is one press from checking,
 * and reads back as steps: its conditions where "is in the last" says them,
 * else a jq step.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import type { CheckJqResult } from "@elaraai/east";
import { NOW_FIELD, rootHasClock, type QueryRoot } from "../one-shot.js";
import { SEP, bindSegment } from "./print.js";

/** The checker's code for a variable no bind names (east's `unknownVariable`). */
const UNBOUND = "unknown_function";

/**
 * A check of jq as typed, each `$now` it reads unbound given the fix that
 * binds it: `.now as $now`, written first.
 *
 * @param check - What `checkJq` made of the jq, against the root
 * @param text - The jq as typed
 * @param root - The root: where a data source is named `now`, `.now` reads it, no minute, and there is no fix
 * @param label - The fix's words
 * @returns The check, its unbound `$now` problems each with the fix before any other; the check itself where it has none
 *
 * @example
 * ```ts
 * const text = `.orders | map(select(.at >= ($now | datetime_add(-30; "minute"))))`;
 * const checked = withNowFix(checkJq(text, root.type, { root: true }), text, root, m.fixBindNow());
 * // checked.diagnostics[0].fixes[0].edits: insert ".now as $now\n| " at 0
 * ```
 */
export function withNowFix(check: CheckJqResult, text: string, root: QueryRoot, label: string): CheckJqResult {
    if (!rootHasClock(root)) return check;
    const read = `$${NOW_FIELD}`;
    const bind = { edits: [{ insert: `${bindSegment(NOW_FIELD)}${SEP}`, length: 0n, offset: 0n }], label };
    let fixed = false;
    const diagnostics = check.diagnostics.map((problem) => {
        if (problem.code !== UNBOUND || problem.span.type !== "some") return problem;
        const { offset, length } = problem.span.value;
        if (text.slice(Number(offset), Number(offset + length)) !== read) return problem;
        fixed = true;
        return { ...problem, fixes: [bind, ...problem.fixes] };
    });
    return fixed ? { ...check, diagnostics } : check;
}
