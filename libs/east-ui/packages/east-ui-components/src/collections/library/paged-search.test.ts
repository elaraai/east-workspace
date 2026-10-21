/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A paged tab's own search (#1340, ruling 11): the fields it may read — String
 * fields its source lists in `search`, but a Set's — the field it reads under
 * the rail's choices, or the choices that block it, and the narrowing it reads
 * — the rail's choices and the text's prefix, a field the rail narrows already
 * narrowed further by the text, or nothing when no row can match.
 */
import { describe, expect, test } from "vitest";
import { IntegerType, OptionType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceChoiceType, type RecordSliceConfigType, type RecordSliceFieldType } from "@elaraai/east-ui/internal";
import { pagedSearchFields, pagedSearchTarget, pagedSearchWhere } from "./paged-search.js";

type Config = ValueTypeOf<RecordSliceConfigType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
type Where = ValueTypeOf<RecordSliceWhereType>;

const printString = printFor(StringType);
const printOptional = printFor(OptionType(StringType));
const printInteger = printFor(IntegerType);
const whereEqual = equalFor(RecordSliceWhereType);

/** A narrowing read, held to the one expected — as East compares a Dict. */
function expectWhere(actual: Where | null, expected: Where): void {
    expect(actual).not.toBeNull();
    expect(whereEqual(actual!, expected), "the narrowing").toBe(true);
}

/** A field's control, as `Slice.bindRecord` derives it. */
function field(fieldId: string, label: string, kind: string, options: { set?: boolean; optional?: boolean } = {}): Field {
    const set = options.set ?? false;
    return { fieldId, label, kind, optional: options.optional ?? false, multiple: !set, set, values: [], format: none };
}

const NAME = field("name", "Name", "string");
const DESCRIPTION = field("description", "Description", "string", { optional: true });
const LANE = field("lane", "Lane", "string", { set: true });
const STATE_COUNT = field("stateCount", "State count", "integer");

/** An index path over fields, a Set field's fanning out. */
function index(name: string, fields: readonly string[], sets: readonly string[] = []) {
    return { name, fields: [...fields], sets: new Set(sets), structured: fields.length > 1, interval: none };
}

/** A record of flows' Slice: by name, by description, by description then name, by lane and by state count. */
function config(search: readonly string[]): Config {
    return {
        fields: [NAME, DESCRIPTION, LANE, STATE_COUNT],
        indexes: [
            index("name", ["name"]), index("by_description", ["description"]), index("by_description_name", ["description", "name"]),
            index("lane", ["lane"], ["lane"]), index("stateCount", ["stateCount"]),
        ],
        range: none, search: [...search], presets: [],
    };
}

/** A narrowing, as the rail writes it. */
const where = (choices: Readonly<Record<string, Choice>>): Where => new SortedMap(Object.entries(choices), compareFor(StringType));
const described = (...descriptions: (string | null)[]) => variant("values", descriptions.map((d) => printOptional(d === null ? none : some(d))));

describe("the fields a tab's search may read", () => {
    test("the String fields its source lists in `search`, in that order, but a Set's — and never a field it does not list", () => {
        expect(pagedSearchFields(config(["description", "lane", "name"]))).toEqual([DESCRIPTION, NAME]);
        expect(pagedSearchFields(config(["lane"]))).toEqual([]);
    });
});

describe("the field a tab's search reads under the rail's choices", () => {
    const flows = config(["name", "description", "lane"]);

    test("with no choice, the first it may read", () => {
        expect(pagedSearchTarget(flows, where({}))).toEqual({ field: NAME });
    });

    test("one whose prefix follows the rail's choices on one index: a name within a description", () => {
        expect(pagedSearchTarget(flows, where({ description: described("Inbound parcels") }))).toEqual({ field: NAME });
    });

    test("one the rail narrows already, whose choice the text narrows further", () => {
        expect(pagedSearchTarget(config(["description", "name"]), where({ description: described("Inbound parcels") }))).toEqual({ field: DESCRIPTION });
        expect(pagedSearchTarget(flows, where({ name: variant("prefix", "FLOW-1") }))).toEqual({ field: NAME });
    });

    test("none that combines with the rail's choices: the choices that block it, which the tab names", () => {
        expect(pagedSearchTarget(flows, where({ stateCount: variant("range", { from: printInteger(4n), to: printInteger(6n) }) }))).toEqual({ blocking: [STATE_COUNT] });
        expect(pagedSearchTarget(flows, where({ lane: variant("values", [printString("review")]) }))).toEqual({ blocking: [LANE] });
    });

    test("no field to read: no search", () => {
        expect(pagedSearchTarget(config(["lane"]), where({}))).toBeUndefined();
    });
});

describe("the narrowing a tab's search reads", () => {
    test("the rail's choices and the text a prefix of the field, the rail's choices kept", () => {
        const rail = where({ description: described("Inbound parcels") });
        expectWhere(pagedSearchWhere(NAME, rail, "FLOW-10"), where({ description: described("Inbound parcels"), name: variant("prefix", "FLOW-10") }));
        // The rail's own narrowing is not touched.
        expectWhere(rail, where({ description: described("Inbound parcels") }));
    });

    test("over the rail's prefix on the field: the longer of the two, and nothing where neither starts the other", () => {
        const rail = where({ name: variant("prefix", "FLOW-1") });
        expectWhere(pagedSearchWhere(NAME, rail, "FLOW-10"), where({ name: variant("prefix", "FLOW-10") }));
        expectWhere(pagedSearchWhere(NAME, rail, "FLOW"), rail);
        expect(pagedSearchWhere(NAME, rail, "ROUTE")).toBeNull();
    });

    test("over the rail's chosen values on the field: those that start with the text, Unset never among them, and nothing where none does", () => {
        const rail = where({ description: described("Inbound parcels", "Returns", null) });
        expectWhere(pagedSearchWhere(DESCRIPTION, rail, "Ret"), where({ description: described("Returns") }));
        expect(pagedSearchWhere(DESCRIPTION, rail, "Collect")).toBeNull();
    });
});
