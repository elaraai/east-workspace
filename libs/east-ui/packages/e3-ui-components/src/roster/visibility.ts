/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Indexed visibility is independent of complete roster calculations and sessions. */
import { useKeyVisibility, type KeyVisibility } from "../shared/schedule/visibility.js";
import type { RosterValue } from "./model.js";

const WORDS = { changed: "Staff results changed; retry the narrowing.", failed: "Could not load staff results" };

/** Keep the previous complete membership while a new narrowing resolves. */
export function useRosterVisibility(value: Pick<RosterValue, "visibleSource" | "visiblePeople" | "people" | "recordSlice">): KeyVisibility {
    return useKeyVisibility({ visibleSource: value.visibleSource, visible: value.visiblePeople, rows: value.people, recordSlice: value.recordSlice }, WORDS);
}
