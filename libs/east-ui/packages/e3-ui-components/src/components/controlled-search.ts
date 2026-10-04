/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key search a host controls (#1120): the text the host's own input holds,
 * read in the key search's grammar, found as the preview's own search box
 * finds a query, and its first match jumped to.
 *
 * @packageDocumentation
 */

import { useEffect } from 'react';
import type { EastTypeValue } from '@elaraai/east';
import { parseKeyInput, type DatasetKeyMatchRange, type DatasetKeyQuery } from '@elaraai/east-ui-components';

/** How long a paged preview waits for the text to hold before it finds it, as its search box does: each find is a request. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Finds a controlled search's text and jumps to its first match.
 *
 * @param search - The host's text, or `undefined` when the host does not
 *   control the search
 * @param keyType - The collection's key type, or `null` when it has no keys
 *   to search
 * @param onFind - Locates a query, as the search box's own `onFind` does
 * @param onJump - Jumps the tree to a row, or clears its jump given
 *   `undefined`
 * @param debounceMs - How long the text must hold before it is found
 *
 * @remarks
 * `''`, a text the grammar refuses and a text with no match each clear the
 * jump. A find the text has since moved past is dropped.
 */
export function useControlledKeySearch(
    search: string | undefined,
    keyType: EastTypeValue | null,
    onFind: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>,
    onJump: (row: number | undefined) => void,
    debounceMs: number,
): void {
    useEffect(() => {
        if (search === undefined || keyType === null) return;
        const parsed = search === '' ? null : parseKeyInput(keyType, search);
        if (parsed === null || parsed.kind === 'hint') {
            onJump(undefined);
            return;
        }
        let current = true;
        const timer = setTimeout(() => {
            onFind(parsed.query).then(
                (range) => { if (current) onJump(range.found ? range.row : undefined); },
                () => { if (current) onJump(undefined); },
            );
        }, debounceMs);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [search, keyType, onFind, onJump, debounceMs]);
}
