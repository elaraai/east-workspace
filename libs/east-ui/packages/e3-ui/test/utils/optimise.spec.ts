/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `optimise` check every builder makes (#1409, east-workspace#1622,
 * rules 3 and 4): `Func.bind` of a function from the builder's request to its
 * answer, refused where the page is built when it is not one, naming what it
 * asks or answers; and the drafts rule, held as the page is evaluated — a
 * function that reads a record the builder edits, itself or by an index of
 * it, lists it in `drafts`, or the page fails naming the function, the record
 * and the remedy. And what an answer does to a record, key by key, and the
 * record type it patches, checked.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor, diffFor, dictPatchOpsType, equalFor, isTypeEqual,
    none, printFor, printType, some, variant, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import e3, { type FunctionDef } from "@elaraai/e3";
import { Func, FuncBindingType, Record, optimiseBinding, optimiseChangesFor, optimisedRecordType, type OptimiseContract } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";

const Job = StructType({ press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const JobsType = DictType(StringType, Job);
const Crew = StructType({ name: StringType });
const CrewsType = DictType(StringType, Crew);

/** A record the board edits, with an interval index a function may read it through. */
const jobs = e3.record("optimise_spec_jobs", JobsType, {
    initial: new Map(),
    indexes: (index) => ({ optimise_spec_jobs_in_time: index.interval({ from: "start", to: "end" }) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/** A second record the board edits. */
const crews = e3.record("optimise_spec_crews", CrewsType, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) });
/** Data the board does not edit. */
const presses = e3.input("optimise_spec_presses", DictType(StringType, StringType));

const Request = StructType({ run: IntegerType });
const Result = StructType({ jobs: PatchType(JobsType) });

/** The board's contract, the records it edits by their names. */
function contract(edits: readonly ExprType<StringType>[]): OptimiseContract {
    return {
        builder: "Board", request: Request, result: Result,
        signature: "from Board.Types.OptimiseRequest to Board.Types.OptimiseResult(D)",
        names: { request: "Board.Types.OptimiseRequest", result: "Board.Types.OptimiseResult(D)" },
        edits,
    };
}

// Each answers a patch that changes nothing: the diff of no jobs and no jobs.
const readsItself = e3.function("optimise_spec_reads_itself", { inputs: [jobs], args: [Request], output: Result }, ($) => {
    const held = $.const(new Map(), JobsType);
    return { jobs: East.diff(held, held) };
});
const readsByIndex = e3.function("optimise_spec_reads_by_index", {
    inputs: [e3.index(jobs.indexes.optimise_spec_jobs_in_time)], args: [Request], output: Result,
}, ($) => {
    const held = $.const(new Map(), JobsType);
    return { jobs: East.diff(held, held) };
});
const listsIt = e3.function("optimise_spec_lists_it", {
    inputs: [e3.index(jobs.indexes.optimise_spec_jobs_in_time), jobs], drafts: [jobs], args: [Request], output: Result,
}, ($) => {
    const held = $.const(new Map(), JobsType);
    return { jobs: East.diff(held, held) };
});
const readsOther = e3.function("optimise_spec_reads_other", { inputs: [presses], args: [Request], output: Result }, ($) => {
    const held = $.const(new Map(), JobsType);
    return { jobs: East.diff(held, held) };
});
const listsOneOfTwo = e3.function("optimise_spec_lists_one_of_two", { inputs: [jobs, crews], drafts: [jobs], args: [Request], output: Result }, ($) => {
    const held = $.const(new Map(), JobsType);
    return { jobs: East.diff(held, held) };
});

type Binding = ValueTypeOf<typeof FuncBindingType>;
const sameBinding = equalFor(FuncBindingType);
const printBinding = printFor(FuncBindingType);

/**
 * The binding the check answers for a function, the board editing the records named, evaluated as a page is.
 *
 * @param def - The function the page binds
 * @param edited - Which of the two records the board edits
 * @returns The binding, once the page is evaluated
 */
function evaluated(def: FunctionDef, edited: readonly ("jobs" | "crews")[]): Binding {
    return East.compile(East.function([], FuncBindingType, ($) => {
        const optimise = $.let(Func.bind(def as never));
        const board = $.let(Record.bind(jobs));
        const crew = $.let(Record.bind(crews));
        const names = { jobs: board.binding.name, crews: crew.binding.name };
        return optimiseBinding(optimise, contract(edited.map((record) => names[record])));
    }), refusingPlatform)();
}

/** Builds the check over a value the app passed, refused, if it is, where the page is built. */
function built(optimise: (def: FunctionDef) => unknown, def: FunctionDef): void {
    East.function([], FuncBindingType, ($) => optimiseBinding($.let(optimise(def) as never), contract([])));
}

describe("rule 3: Func.bind of a function from the builder's request to its answer, checked where the page is built", () => {
    test("a function of the builder's types is taken: its binding names it, what it lists and what it reads", () => {
        const binding = evaluated(listsIt, ["jobs"]);
        const expected: Binding = { name: "optimise_spec_lists_it", drafts: ["optimise_spec_jobs"], reads: ["optimise_spec_jobs"] };
        assert.ok(sameBinding(binding, expected), printBinding(binding));
    });

    test("a value that is no Func.bind handle is refused, naming the signature and what goes in and comes out", () => {
        const message = "Board: `optimise` is Func.bind of the app's e3.function from Board.Types.OptimiseRequest to Board.Types.OptimiseResult(D) — " +
            "the period in view and the page's narrowing in, a patch of each record the Board edits out";
        assert.throws(() => built(() => East.value("optimise_spec_lists_it"), listsIt), { message });
        assert.throws(() => East.function([], FuncBindingType, () => optimiseBinding(undefined, contract([]))), { message });
    });

    test("one that asks another request is refused naming what it asks, and one that answers another result naming that", () => {
        const asksRows = e3.function("optimise_spec_asks_rows", { inputs: [], args: [StructType({ run: IntegerType, jobs: JobsType })], output: Result }, ($) => {
            const held = $.const(new Map(), JobsType);
            return { jobs: East.diff(held, held) };
        });
        assert.throws(() => built((def) => Func.bind(def as never), asksRows), {
            message: `Board: \`optimise\` asks ${printType(StructType({ run: IntegerType, jobs: JobsType }))}, not Board.Types.OptimiseRequest — ` +
                "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace",
        });
        const answersRows = e3.function("optimise_spec_answers_rows", { inputs: [], args: [Request], output: StructType({ jobs: JobsType }) },
            () => ({ jobs: new Map() }));
        assert.throws(() => built((def) => Func.bind(def as never), answersRows), {
            message: `Board: \`optimise\` answers ${printType(StructType({ jobs: JobsType }))}, not Board.Types.OptimiseResult(D) — a patch of each record the Board edits`,
        });
    });
});

describe("rule 4: a function that reads a record the builder edits lists it in `drafts`, held as the page is evaluated", () => {
    const refusal = (fn: string, record: string) =>
        `Board: \`optimise\` is the function '${fn}', which reads the record '${record}' that the Board edits and does not list it in \`drafts\` — ` +
        `it would plan around edits it cannot see: list it, drafts: [${record}], beside the function's inputs`;

    test("one that reads the record itself, or through an index of it, and does not list it fails the page, naming both", () => {
        assert.throws(() => evaluated(readsItself, ["jobs"]), (error: Error) => error.message.includes(refusal("optimise_spec_reads_itself", "optimise_spec_jobs")));
        assert.throws(() => evaluated(readsByIndex, ["jobs"]), (error: Error) => error.message.includes(refusal("optimise_spec_reads_by_index", "optimise_spec_jobs")));
    });

    test("of two records the builder edits, the one the function reads and does not list is named", () => {
        assert.throws(() => evaluated(listsOneOfTwo, ["jobs", "crews"]), (error: Error) => error.message.includes(refusal("optimise_spec_lists_one_of_two", "optimise_spec_crews")));
        // The record it lists is the one the board edits: the page stands
        assert.doesNotThrow(() => evaluated(listsOneOfTwo, ["jobs"]));
    });

    test("one that reads no record the builder edits, or lists each it reads, is taken as it is", () => {
        const other = evaluated(readsOther, ["jobs", "crews"]);
        assert.ok(sameBinding(other, { name: "optimise_spec_reads_other", drafts: [], reads: [] }), printBinding(other));
        assert.doesNotThrow(() => evaluated(listsIt, ["jobs", "crews"]));
        // A record the builder does not edit is no matter of the rule, read as saved or not
        assert.doesNotThrow(() => evaluated(readsItself, ["crews"]));
    });

    test("a builder that edits no record holds the function to nothing", () => {
        assert.doesNotThrow(() => evaluated(readsItself, []));
    });
});

describe("rule 7: what an answer does to a record, key by key (`optimiseChangesFor`)", () => {
    type JobRow = ValueTypeOf<typeof Job>;
    const byString = compareFor(StringType);
    const ChangesType = DictType(StringType, dictPatchOpsType(Job));
    const changesOf = East.compile(optimiseChangesFor(JobsType), []) as unknown as (patch: unknown) => ValueTypeOf<typeof ChangesType>;
    const sameChanges = equalFor(ChangesType);
    const printChanges = printFor(ChangesType);
    const diff = diffFor(JobsType);
    const job = (press: string, hour: number | null): JobRow => ({
        press, start: hour === null ? none : some(new Date(Date.UTC(2026, 9, 5, hour))), end: hour === null ? none : some(new Date(Date.UTC(2026, 9, 5, hour + 2))),
    });
    const rows = (...entries: [string, JobRow][]) => new SortedMap<string, JobRow>(entries, byString);
    const changes = (...entries: [string, unknown][]) => new SortedMap(entries, byString) as unknown as ValueTypeOf<typeof ChangesType>;

    test("a patch by key lands as it is: each key's insert, update or delete", () => {
        const before = rows(["j1", job("P1", 6)], ["j2", job("P1", null)], ["j3", job("P2", 9)]);
        const after = rows(["j1", job("P1", 6)], ["j2", job("P2", 8)], ["j4", job("P1", 12)]);
        const patch = diff(before, after);
        assert.equal((patch as { type: string }).type, "patch", "East.diff answers these rows by key");
        const expected = changes(
            ["j2", variant("update", diffFor(Job)(job("P1", null), job("P2", 8)))],
            ["j3", variant("delete", job("P2", 9))],
            ["j4", variant("insert", job("P1", 12))],
        );
        const got = changesOf(patch);
        assert.ok(sameChanges(got, expected), printChanges(got));
    });

    test("a patch of the whole Dict lands key by key — the rows of `before` the answer lacks deleted, its new rows inserted, a row in both updated where it differs — never as the record replaced", () => {
        const before = rows(["j1", job("P1", null)], ["j2", job("P2", null)], ["j3", job("P2", 9)]);
        const after = rows(["j2", job("P2", null)], ["j3", job("P1", 9)], ["elara-1-1", job("P2", 14)]);
        const whole = variant("replace", { before, after });
        const expected = changes(
            ["elara-1-1", variant("insert", job("P2", 14))],
            ["j1", variant("delete", job("P1", null))],
            ["j3", variant("update", diffFor(Job)(job("P2", 9), job("P1", 9)))],
        );
        const got = changesOf(whole);
        assert.ok(sameChanges(got, expected), printChanges(got));
        // What East.diff answers of a few rows against none: their every row deleted, whatever else the record holds
        const cleared = changesOf(diff(rows(["j1", job("P1", null)]), rows()));
        assert.ok(sameChanges(cleared, changes(["j1", variant("delete", job("P1", null))])), printChanges(cleared));
    });

    test("an unchanged patch touches no key", () => {
        const got = changesOf(variant("unchanged", null));
        assert.ok(sameChanges(got, changes()), printChanges(got));
        const same = changesOf(diff(rows(["j1", job("P1", 6)]), rows(["j1", job("P1", 6)])));
        assert.ok(sameChanges(same, changes()), printChanges(same));
    });

    test("it takes a record's type alone, refusing any other", () => {
        assert.throws(() => optimiseChangesFor(Job as never), { message: `optimiseChangesFor: takes a record's type, a Dict of rows by key, and was given ${printType(Job)}` });
    });
});

describe("the record type an answer patches, checked, each builder refusing another in its own words (`optimisedRecordType`)", () => {
    const refusal = (given: string) => `Board.Types.OptimiseResult: is given ${given} — it takes the jobs' record type, a Dict of jobs by key`;

    test("a Dict of rows by key is the record's type, as it is given", () => {
        assert.ok(isTypeEqual(optimisedRecordType(JobsType, refusal), JobsType));
    });

    test("nothing, or a type that is no Dict, is refused in the factory's words, naming what it was given", () => {
        assert.throws(() => optimisedRecordType(Job, refusal), { message: refusal(printType(Job)) });
        assert.throws(() => optimisedRecordType(undefined, refusal), { message: refusal("nothing") });
    });
});
