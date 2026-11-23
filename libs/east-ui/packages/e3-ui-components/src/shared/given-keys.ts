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
 * known taken, each as its text. A key it gives that it was told is taken, and
 * a rule that throws, make no key: `refused` is told which, and throws to
 * refuse the gesture in its builder's own words, or returns and none is made.
 *
 * A session lists the keys it knows taken, and over a record read a window at
 * a time those are never all of them: its builder shows rows it cannot list
 * (keys.ts' `pastKeys`). A key the rule gives that such a row holds is one it
 * could not know taken, so it is told of it and asked again — until it gives a
 * key no row holds, or one it was told of. It is asked once more for each row
 * the page shows at most.
 *
 * @param rule - The app's rule: every key taken, each as its text, to a new one's
 * @param refused - Told of a key the rule gave that it was told is taken, or of what the rule threw
 * @returns The policy
 */
export function givenKeys(rule: (taken: SortedSet<string>) => string,
    refused: (why: { readonly taken: string } | { readonly failed: unknown }) => void): EntryKeys {
    return {
        make: (known) => {
            // What the rule has been told beyond what the session lists: kept only once it gives a key a row holds, so a
            // rule asked once — as most are — has one set made for it, the one it is given.
            let told: SortedSet<string> | undefined;
            for (;;) {
                let id: string;
                try {
                    // A set of its own at each asking: what a rule does to the one it is given never reaches the next.
                    id = rule(new SortedSet(told ?? known.ids(), compareString));
                } catch (error) {
                    refused({ failed: error });
                    return undefined;
                }
                if (!known.has(id)) return id;
                told ??= new SortedSet(known.ids(), compareString);
                if (told.has(id)) {
                    refused({ taken: id });
                    return undefined;
                }
                told.add(id);
            }
        },
    };
}
