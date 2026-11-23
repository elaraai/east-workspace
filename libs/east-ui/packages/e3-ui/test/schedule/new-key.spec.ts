/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An event kind told the app's own rule for a new event's key (`newKey`,
 * east-workspace#1709) — the kind the Calendar, the Plan, the Roster and the
 * Allocation share (`Schedule.events`), told it as a Record and a Sheet are:
 * an East function from the keys taken to a new one, at the record's key
 * type. The kind carries it over the keys' text, as every builder's payload
 * does; told none, it carries none, and its session makes the key. The
 * Roster's targets (`Roster.targets`) take the same option.
 *
 * e3-ui's specs read and write no e3: each record is a handle made by hand
 * (`record-handles.ts`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType, StructType,
    compareFor, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Record } from "@elaraai/e3-ui";
import { Roster, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { recordHandle } from "../record-handles.js";

/** A job: what it is, and when it runs. */
const Job = StructType({ title: StringType, start: DateTimeType, end: DateTimeType });
const NO_JOBS = <K>(compare: (a: K, b: K) => number) => new SortedMap<K, ValueTypeOf<typeof Job>>([], compare);
/** Jobs keyed by their reference, and jobs keyed by their number. */
const byRef = recordHandle(DictType(StringType, Job), NO_JOBS(compareFor(StringType)), "spec_jobs_by_ref");
const byNumber = recordHandle(DictType(IntegerType, Job), NO_JOBS(compareFor(IntegerType)), "spec_jobs_by_number");

/** A kind over a record, built as the Calendar builds one: told its rule for a new key, or told none. */
const kindOver = (record: typeof byRef | typeof byNumber, options: object) => East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const handle = $.let(record());
    return Schedule.events(handle as never, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", ...options } as never).build("jobs");
}), []);

/** The keys taken, as a builder's payload gives them: each as its text. */
const taken = (...ids: string[]) => new SortedSet(ids, compareFor(StringType));

describe("an event kind told the app's rule for a new key", () => {
    test("ruling 1 — carries the rule over the keys' text: a String key's as it is, an Integer key's read from its text and printed back", () => {
        const next = East.function([SetType(StringType)], StringType, (_$, keys) => East.str`J-${keys.size().add(1n)}`);
        const refs = kindOver(byRef, { newKey: next })();
        if (refs.newKey.type !== "some") assert.fail("expected the kind to carry its rule");
        assert.equal(refs.newKey.value(taken("J-1", "J-2")), "J-3");
        // The largest key taken, and ten on: the rule reads the keys as Integers.
        const tenOn = East.function([SetType(IntegerType)], IntegerType, (_$, keys) => keys.reduce((_$2, most, key) => East.max(most, key), 0n).add(10n));
        const numbers = kindOver(byNumber, { newKey: tenOn })();
        if (numbers.newKey.type !== "some") assert.fail("expected the kind to carry its rule");
        assert.equal(numbers.newKey.value(taken("7", "40")), "50");
    });

    test("ruling 3 — told none, it carries none: its session makes the key", () => {
        assert.equal(kindOver(byRef, {})().newKey.type, "none");
    });

    test("ruling 1 — refuses a rule that is no function from the record's keys to one, naming both types", () => {
        const overNumbers = East.function([SetType(IntegerType)], IntegerType, (_$, keys) => keys.size());
        assert.throws(() => kindOver(byRef, { newKey: overNumbers }),
            /Schedule\.events: "Job": `newKey` takes the keys taken and gives a new one — an East function from \.Set \.String to \.String/);
    });
});

/** A staffing target: the Roster's roles. */
const Cover = StructType({ day: DateTimeType, team: StringType, shift: StringType, heads: IntegerType, hours: DictType(StringType, FloatType) });
const coversHandle = recordHandle(DictType(StringType, Cover), new SortedMap<string, ValueTypeOf<typeof Cover>>([], compareFor(StringType)), "spec_covers");
/** The rule the targets carry, built as the Roster builds them: told the app's rule for a new key, or told none. */
const coversRule = (options: object) => East.compile(East.function([], OptionType(FunctionType([SetType(StringType)], StringType)), ($) => {
    const handle = $.let(coversHandle());
    return Roster.targets(handle as never, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours", ...options } as never).build().newKey;
}), []);

describe("the Roster's targets told the app's rule for a new key", () => {
    test("ruling 1 — carry the rule; told none, they carry none, and the Roster makes a key up", () => {
        const next = East.function([SetType(StringType)], StringType, (_$, keys) => East.str`C-${keys.size().add(1n)}`);
        const rule = coversRule({ newKey: next })();
        if (rule.type !== "some") assert.fail("expected the targets to carry their rule");
        assert.equal(rule.value(taken("C-1")), "C-2");
        assert.equal(coversRule({})().type, "none");
    });

    test("ruling 1 — refuse a rule that is no function from the targets' keys to one", () => {
        const overNumbers = East.function([SetType(IntegerType)], IntegerType, (_$, keys) => keys.size());
        assert.throws(() => coversRule({ newKey: overNumbers }),
            /Roster\.targets: `newKey` takes the keys taken and gives a new one — an East function from \.Set \.String to \.String/);
    });
});

// A record declared with e3, as an app declares one: what the option's type is checked over.
const jobs = e3.record("new_key_jobs", DictType(StringType, Job), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The option's type checks: never called — `tsc` checks what each line says. */
export function newKeyEventChecks($: BlockBuilder<NullType>): void {
    const bound = $.let(Record.bind(jobs));
    const next = $.const(East.function([SetType(StringType)], StringType, (_$, keys) => East.str`J-${keys.size().add(1n)}`));
    Schedule.events(bound, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", newKey: next });
    const overNumbers = $.const(East.function([SetType(IntegerType)], IntegerType, (_$, keys) => keys.size()));
    // @ts-expect-error — the jobs are keyed by a String, and this rule is over Integer keys
    Schedule.events(bound, { name: "Job", icon: "wrench", title: "title", start: "start", end: "end", newKey: overNumbers });
}
