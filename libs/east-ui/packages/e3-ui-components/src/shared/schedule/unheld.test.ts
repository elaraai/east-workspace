/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Whether a builder holds every row of a kind it reads through its source of
 * the rail (`sourceUnheld`, #1580, #1621): what the Flowchart and the
 * Schematic ask before a gesture moves a key that rows of the kind may name.
 */
import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceChoiceType, RecordSliceNarrowed } from "@elaraai/east-ui/internal";
import { sourceUnheld } from "./unheld.js";

type Choice = ValueTypeOf<RecordSliceChoiceType>;

const compareString = compareFor(StringType);

/** A narrowing: each field's exact values. */
function narrowing(fields: Record<string, readonly string[]>): SortedMap<string, Choice> {
    return new SortedMap(Object.entries(fields).map(([field, values]) => [field, variant("values", [...values])] as const), compareString);
}

/** A source as a builder holds it: its page's scope, and the narrowing a read of it carries — the scope with the viewer's choices. */
function source(scope: Record<string, readonly string[]>, choices: Record<string, readonly string[]>): RecordSliceNarrowed {
    const where = narrowing({ ...choices, ...scope });
    return { config: { scope: narrowing(scope) }, read: () => ({ where }) };
}

describe("sourceUnheld — whether a builder holds every row of a kind read through its source", () => {
    test("a kind read whole — no source of the rail — is held whole, dimmed or not", () => {
        expect(sourceUnheld(undefined, false)).toBeUndefined();
        expect(sourceUnheld(undefined, true)).toBeUndefined();
    });

    test("a source its viewer has chosen nothing of, on a page with no scope, is held whole", () => {
        const whole = source({}, {});
        expect(sourceUnheld(whole, false)).toBeUndefined();
        expect(sourceUnheld(whole, true)).toBeUndefined();
    });

    test("the viewer's choices leave rows out where the narrowing hides them — and none under dim, which reads every row", () => {
        const chosen = source({}, { status: ["Ready"] });
        expect(sourceUnheld(chosen, false)).toBe("filtered");
        expect(sourceUnheld(chosen, true)).toBeUndefined();
    });

    test("a page's scope holds only some rows under either reading, whatever its viewer chose: the scope alone is no filter of theirs", () => {
        const scoped = source({ press: ["P-1"] }, {});
        expect(sourceUnheld(scoped, false)).toBe("scoped");
        expect(sourceUnheld(scoped, true)).toBe("scoped");
    });

    test("the scope is asked first: a scoped source its viewer narrows too says the page, never the filters a Clear would not help", () => {
        const both = source({ press: ["P-1"] }, { status: ["Ready"] });
        expect(sourceUnheld(both, false)).toBe("scoped");
        expect(sourceUnheld(both, true)).toBe("scoped");
    });
});
