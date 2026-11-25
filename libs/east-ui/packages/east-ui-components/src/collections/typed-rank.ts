/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What words typed narrow a list of choices to, best first: the choices not already taken — with nothing typed, each in
 * its order; with words, those they start (the whole choice or one of its words), then those holding them anywhere else,
 * each run in the list's order. Matched without regard to case; a choice is taken when one taken is the choice itself.
 * A phone's tags input offers its suggestions by it (east-workspace#1741).
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";

const stringEqual = equalFor(StringType);

/**
 * The choices words typed narrow a list to, best first — see the module docs.
 *
 * @param choices - The choices, in their order
 * @param typed - What is typed
 * @param taken - The choices already taken, which it never offers: a tags input's tags
 * @returns The choices not taken that the words match, those they start first
 */
export function rankByTyped(choices: readonly string[], typed: string, taken: readonly string[] = []): string[] {
    const open = choices.filter((choice) => !taken.some((t) => stringEqual(t, choice)));
    const words = typed.trim().toLocaleLowerCase();
    if (words === "") return open;
    const starting: string[] = [];
    const holding: string[] = [];
    for (const choice of open) {
        const lower = choice.toLocaleLowerCase();
        if (lower.startsWith(words) || lower.split(/\s+/).some((word) => word.startsWith(words))) starting.push(choice);
        else if (lower.includes(words)) holding.push(choice);
    }
    return [...starting, ...holding];
}
