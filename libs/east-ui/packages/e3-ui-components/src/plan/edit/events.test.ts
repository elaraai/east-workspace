/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * A new event's key, for an event kind read a window at a time (#1199): its
 * record is never read whole, so an Integer key is made past the record's
 * largest key, which the kind reads by its key order (`entries.last`) — none
 * until that read lands — and past the keys the drafts and the gesture hold.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { IntegerType, StringType, StructType, none, some, toEastTypeValue, variant, type option } from "@elaraai/east";
import { EditingDraftFieldType } from "@elaraai/east-ui/internal";
import { UIStore } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { usePlanEventEditing, type PlanEventEditingArgs } from "./events.js";

/** A run: what the kind's record holds by an Integer key. */
const Run = StructType({ title: StringType });

/**
 * A kind read a window at a time, keyed by Integer, as its payload carries it:
 * its record read by key, its largest key's text what `last` says.
 *
 * @param last - The record's largest key's text: `none` while its read is in flight, `some(none)` for an empty record
 * @returns The kinds, as `usePlanEventEditing` takes them
 */
function windowed(last: option<option<string>>): PlanEventEditingArgs["kinds"] {
    return [{
        key: "run", name: "Run",
        editing: {
            sourceId: "runs", entryType: toEastTypeValue(Run), idField: none, draftType: toEastTypeValue(EditingDraftFieldType(Run)),
            children: none, keyType: some(toEastTypeValue(IntegerType)), snapshot: none, readEntry: () => none, onPatch: none,
            onApply: some(variant("sync", () => variant("applied", { revision: some("r2") }))), mode: variant("batch", null),
        },
        ready: none,
        entries: some({ revision: () => some("r1"), refresh: () => null, entry: () => some(none), last: () => last }),
        planEvent: () => none,
        write: () => [],
    }] as unknown as PlanEventEditingArgs["kinds"];
}

beforeEach(() => { initializeStore(new UIStore()); });

describe("a new Integer key, for a kind read a window at a time (#1199)", () => {
    test("is the first past the record's largest, read by its key order — none until that read lands — and past the keys a gesture made", () => {
        const { result, rerender } = renderHook(({ kinds }) => usePlanEventEditing({ kinds, applyMode: "batch", storageKey: "plan-mint", joined: [] }),
            { initialProps: { kinds: windowed(none) } });
        // The largest key is still in flight: no key yet.
        expect(result.current.mint("run", "7", new Set())).toBeUndefined();
        rerender({ kinds: windowed(some(some("41"))) });
        expect(result.current.mint("run", "7", new Set())).toBe("42");
        expect(result.current.mint("run", "7", new Set(["42", "50"]))).toBe("51");
        // An empty record: the first key.
        rerender({ kinds: windowed(some(none)) });
        expect(result.current.mint("run", "7", new Set())).toBe("1");
    });
});
