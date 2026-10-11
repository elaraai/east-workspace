/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { East } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Roster } from "@elaraai/e3-ui";
import { Record, RosterPayloadType, createRosterPayload } from "@elaraai/e3-ui/internal";
import { memoryRecords } from "../schedule/memory-records.js";
import { warehouseConfig } from "./warehouse.js";
import * as ex from "./roster.examples.js";
describeEast("Roster — inline bound examples", test => {
    Assert.examples(test, { rosterWarehouse: ex.rosterWarehouse, rosterMobile: ex.rosterMobile, rosterPeople: ex.rosterPeople,
        rosterWeek: ex.rosterWeek, rosterWindowed: ex.rosterWindowed, rosterMinimal: ex.rosterMinimal, rosterPublished: ex.rosterPublished, rosterCustomInspector: ex.rosterCustomInspector });
}, { platformFns: TestImpl });
test("Roster is one tag; BuilderFrame, Builder and View are not part of its developer API", () => {
    assert.equal("Builder" in Roster, false); assert.equal("View" in Roster, false);
    const fn = East.function([], RosterPayloadType, $ => {
        const weeks = $.let(Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
        return createRosterPayload({ weeks, people: [], groups: warehouseConfig.groups, shifts: warehouseConfig.shifts, rules: { rest: 12 } });
    });
    const value = East.compile(fn, memoryRecords(new Map([[ex.rosterWeeks.name, ex.rosterWeeks.default]])))();
    assert.equal(value.sourceId, ex.rosterWeeks.name); assert.equal(value.rules.rest, 12); assert.equal(value.rules.skill, true);
    assert.equal(value.library.length, 0); assert.equal(value.inspector.type, "none");
    assert.equal("frame" in value, false); assert.equal("children" in value, false);
});
test("library patches reject identity and slot changes even from untyped JavaScript", () => {
    assert.throws(() => Roster.patch({ position: "lead", ...{ slot: "unsafe" } }), /slot cannot be changed/);
    assert.throws(() => Roster.patch({ ...{ who: "someone" } } as never), /who cannot be changed/);
});

test("the old Board and Roster are absent from east-ui's public API", () => {
    assert.equal("Board" in EastUI, false); assert.equal("Roster" in EastUI, false);
});
