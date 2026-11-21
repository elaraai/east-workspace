/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new entry's key by the app's own rule (`newKey`): the policy a builder
 * binds its session to where the app gives one — the Sheet's and the Record's
 * rows, and every kind and record the shared Schedule editing writes — in
 * place of the rules every collection shares (east-ui-components' `keys.ts`).
 *
 * @packageDocumentation
 */

import { SortedSet, StringType, compareFor } from "@elaraai/east";
import type { EntryKeys } from "@elaraai/east-ui-components";

const compareString = compareFor(StringType);

/**
 * Keys by an app's own rule: its function of the keys taken, given every key
 * known taken, each as its text. A key it gives that is taken, and a rule that
 * throws, make no key: `refused` is told which, and throws to refuse the
 * gesture in its builder's own words, or returns and none is made.
 *
 * @param rule - The app's rule: every key taken, each as its text, to a new one's
 * @param refused - Told of a key the rule gave that is taken, or of what the rule threw
 * @returns The policy
 */
export function givenKeys(rule: (taken: SortedSet<string>) => string,
    refused: (why: { readonly taken: string } | { readonly failed: unknown }) => void): EntryKeys {
    return {
        make: (known) => {
            let id: string;
            try {
                id = rule(new SortedSet(known.ids(), compareString));
            } catch (error) {
                refused({ failed: error });
                return undefined;
            }
            if (!known.has(id)) return id;
            refused({ taken: id });
            return undefined;
        },
    };
}
