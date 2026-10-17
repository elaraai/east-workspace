/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Project indexed staff windows to their original identities, never a row predicate. */
import { keyVisibility } from "../utils/key-visibility.js";

/**
 * Preserve inline key sets and adapt Slice.rows(recordSlice) through shared paging.
 * Full staff remains a separate input for coverage, costs and validation.
 * @param input - Original staff keys, or indexed staff windows.
 * @returns The existing inline set or a source of original keys.
 */
export function rosterVisibility(input: unknown) {
    return keyVisibility(input, "Roster.visiblePeople");
}
