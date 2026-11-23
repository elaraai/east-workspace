/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An event kind that builds each event's key from its row (`rowKey`,
 * east-workspace#1709) — the kind the Calendar, the Plan, the Roster and the
 * Allocation share (`Schedule.events`), told it as the Flowchart's and the
 * Schematic's kinds are: a function of the row, held to the record's key type.
 * The kind carries it over the row's bytes to the key's text; told none, it
 * carries none; `rowKey` beside `newKey` is refused, naming both. The Roster's
 * targets (`Roster.targets`) take the same option.
 *
 * e3-ui's specs read and write no e3: each record is a handle made by hand
 * (`record-handles.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    BlobType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType,
    compareFor, encodeBeast2For, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Record } from "@elaraai/e3-ui";
import { Roster, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../record-handles.js";

/** A visit: the site it is to, the day's number in the site's round, what it is, and when it runs. */
const Visit = StructType({ site: StringType, round: IntegerType, title: StringType, start: DateTimeType, end: DateTimeType });
const DAY = new Date("2026-11-23T08:00:00Z");
const LATER = new Date("2026-11-23T12:00:00Z");
const NO_VISITS = <K>(compare: (a: K, b: K) => number) => new SortedMap<K, ValueTypeOf<typeof Visit>>([], compare);
/** Visits keyed by a text, and visits keyed by a number. */
const byText = recordHandle(DictType(StringType, Visit), NO_VISITS(compareFor(StringType)), "spec_visits_by_text");
const byNumber = recordHandle(DictType(IntegerType, Visit), NO_VISITS(compareFor(IntegerType)), "spec_visits_by_number");
const encodeVisit = encodeBeast2For(Visit);
const VISIT: ValueTypeOf<typeof Visit> = { site: "quay", round: 7n, title: "Survey", start: DAY, end: LATER };

/** A kind over a record, built as the Calendar builds one. */
const kindOver = (record: typeof byText | typeof byNumber, options: object) => East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const handle = $.let(record());
    return Schedule.events(handle as never, { name: "Visit", icon: "location-dot", title: "title", start: "start", end: "end", ...options } as never).build("visits");
}), []);

describe("an event kind that builds each event's key from its row", () => {
    test("ruling 1 — carries the key's text from a row's bytes: a String key as it is, an Integer key as East prints it", () => {
        const texts = kindOver(byText, { rowKey: (visit: { site: unknown; round: unknown }) => East.str`${visit.site as never}-${visit.round as never}` })();
        if (texts.rowKey.type !== "some") assert.fail("expected the kind to carry its key");
        assert.equal(texts.rowKey.value(encodeVisit(VISIT)), "quay-7");
        const numbers = kindOver(byNumber, { rowKey: (visit: { round: unknown }) => visit.round })();
        if (numbers.rowKey.type !== "some") assert.fail("expected the kind to carry its key");
        assert.equal(numbers.rowKey.value(encodeVisit(VISIT)), "7");
    });

    test("ruling 3 — told none, it carries none: its session makes the key", () => {
        assert.equal(kindOver(byText, {})().rowKey.type, "none");
    });

    test("ruling 2 — refuses `rowKey` beside `newKey`, naming both, and a `rowKey` building another type than the record's key, naming both types", () => {
        const next = East.function([SetType(StringType)], StringType, (_$, keys) => East.str`V-${keys.size().add(1n)}`);
        assert.throws(() => kindOver(byText, { rowKey: (visit: { site: unknown }) => visit.site, newKey: next }),
            /Schedule\.events: "Visit": `rowKey` and `newKey` each decide a new row's key — give one: `rowKey` builds it from the row, `newKey` makes it from the keys taken/);
        assert.throws(() => kindOver(byText, { rowKey: (visit: { round: unknown }) => visit.round }),
            /Schedule\.events: "Visit": `rowKey` builds an event's key, of the record's key type \.String — and this one builds \.Integer/);
    });
});

/** A staffing target: the Roster's roles. */
const Cover = StructType({ day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
const covers = recordHandle(DictType(StringType, Cover), new SortedMap<string, ValueTypeOf<typeof Cover>>([], compareFor(StringType)), "spec_keyed_covers");
/** The key the targets carry, built as the Roster builds them. */
const coversKey = (options: object) => East.compile(East.function([], OptionType(FunctionType([BlobType], StringType)), ($) => {
    const handle = $.let(covers());
    return Roster.targets(handle as never, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", ...options } as never).build().rowKey;
}), []);

describe("the Roster's targets that build each target's key from its row", () => {
    test("ruling 1 — carry the key's text from a row's bytes; told none, they carry none; and `rowKey` beside `newKey` is refused", () => {
        const built = coversKey({ rowKey: (cover: { team: unknown; shift: unknown }) => East.str`${cover.team as never}/${cover.shift as never}` })();
        if (built.type !== "some") assert.fail("expected the targets to carry their key");
        assert.equal(built.value(encodeBeast2For(Cover)({ day: DAY, team: "north", shift: "early", heads: 3n, hours: new SortedMap([], compareFor(StringType)) })), "north/early");
        assert.equal(coversKey({})().type, "none");
        const next = East.function([SetType(StringType)], StringType, (_$, keys) => East.str`C-${keys.size().add(1n)}`);
        assert.throws(() => coversKey({ rowKey: (cover: { team: unknown }) => cover.team, newKey: next }),
            /Roster\.targets: `rowKey` and `newKey` each decide a new row's key — give one/);
    });
});

// A record declared with e3, as an app declares one: what the option's type is checked over.
const visits = e3.record("built_key_spec_visits", DictType(StringType, Visit), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The option's type checks: never called — `tsc` checks what each line says. */
export function builtKeyEventChecks($: BlockBuilder<NullType>): void {
    const bound = $.let(Record.bind(visits));
    Schedule.events(bound, { name: "Visit", icon: "location-dot", title: "title", start: "start", end: "end", rowKey: (visit) => East.str`${visit.site}-${visit.round}` });
    // @ts-expect-error — the visits are keyed by a String, and this builds an Integer
    Schedule.events(bound, { name: "Visit", icon: "location-dot", title: "title", start: "start", end: "end", rowKey: (visit) => visit.round });
}
