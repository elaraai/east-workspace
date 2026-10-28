/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Save's patch over rows read beside their nested series index, restated by
 * key (#1438): a machine whose only job moves off it is a whole `replace` of
 * its jobs to East's diff, which conflicts with another planner's job added
 * meanwhile; restated, it is a `delete` of the one job, which applies over the
 * other planner's. A hall's member's load is restated through its child rows.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ConflictError, East, Expr, OptionType, PatchType, StringType, applyFor, diffFor, equalFor, none, printFor, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Data, nestedPartOf, planNestedIndex, planNestedRestatement } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-nested.examples.js";

type Machine = ValueTypeOf<typeof ex.Machine>;
type Hall = ValueTypeOf<typeof ex.Hall>;

/** The nested series index a binding of a record's rows reads beside, as the Plan holds it. */
function indexOf(binding: unknown) {
    return planNestedIndex(nestedPartOf(Expr.type(binding as Expr) as EastType))!;
}

/** A batch of one change, as the Plan's session hands it: the entry's patch, East's diff of it before and after. */
function batchOf(id: string, patch: unknown) {
    return { requestId: "r-1", base: variant("revision", "rev-1"), label: "Move", changes: [{ id, patch, place: none }] };
}

describe("a Save's patch over rows read beside their nested series index, restated by key (#1438)", () => {
    test("a machine's only job moved off it: a whole replace of its jobs restated as the job's delete, which applies over another planner's job", () => {
        const full = East.compile(ex.generateMachine, [])(0n) as Machine;
        const [id, job] = [...full.jobs][0]!;
        const held = { ...full, jobs: new Map([[id, job]]) } as unknown as Machine;
        const moved = { ...full, jobs: new Map() } as unknown as Machine;
        const entry = OptionType(ex.Machine);
        const patch = diffFor(entry)(some(held), some(moved));
        const print = printFor(PatchType(entry));
        assert.match(print(patch as never), /jobs=\.replace/, "East's diff replaces the jobs whole");
        const restate = East.compile(planNestedRestatement(ex.Machine, StringType, indexOf(Data.bindPaged(ex.machines, { indexes: ["machines_by_name", "machines_in_time"] })))! as never, []) as
            (batch: unknown) => { changes: { patch: unknown }[] };
        const restated = restate(batchOf("M-10001", patch)).changes[0]!.patch;
        assert.match(print(restated as never), new RegExp(`jobs=\\.patch \\{"${id}":\\.delete`), "the one job deleted, by key");
        const apply = applyFor(entry);
        assert.ok(equalFor(entry)(apply(some(held), restated) as never, some(moved) as never), "the row the draft left");
        // Another planner's job added to the machine meanwhile: the replace conflicts, the restated delete applies over it.
        const theirs = { ...full, jobs: new Map([[id, job], ["J-THEIRS", job]]) } as unknown as Machine;
        assert.throws(() => apply(some(theirs), patch), ConflictError);
        const left = apply(some(theirs), restated) as ValueTypeOf<typeof entry>;
        assert.ok(left.type === "some");
        assert.deepEqual([...left.value.jobs.keys()], ["J-THEIRS"]);
    });

    test("a member's load emptied: restated through the hall's child rows, the member's update its load's deletes", () => {
        const full = East.compile(ex.generateHall, [])(0n) as Hall;
        const [member, held] = [...full.members][0]!;
        const emptied = { ...full, members: new Map([...full.members].map(([m, value]) => [m, m === member ? { ...value, load: new Map() } : value])) } as unknown as Hall;
        const entry = OptionType(ex.Hall);
        const patch = diffFor(entry)(some(full), some(emptied));
        const print = printFor(PatchType(entry));
        assert.match(print(patch as never), /load=\.replace/, "East's diff replaces the member's load whole");
        const restate = East.compile(planNestedRestatement(ex.Hall, StringType, indexOf(Data.bindPaged(ex.halls, { indexes: ["halls_by_site", "halls_in_time"] })))! as never, []) as
            (batch: unknown) => { changes: { patch: unknown }[] };
        const restated = restate(batchOf("H-101", patch)).changes[0]!.patch;
        assert.doesNotMatch(print(restated as never), /load=\.replace/, "no load replaced whole");
        assert.equal((print(restated as never).match(/:\.delete/g) ?? []).length, held.load.size, "each of its values deleted, by its instant");
        assert.ok(equalFor(entry)(applyFor(entry)(some(full), restated) as never, some(emptied) as never), "the row the draft left");
    });
});
