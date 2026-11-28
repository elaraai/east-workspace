/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One record of every kind of step (#1769), and the Plan over it: a kind of
 * event per case of the steps' `kind` field. The Plan builds, reads its
 * machines a page at a time and every kind of step a cell at a time through
 * their one source — never whole — and writes through the steps' one patch
 * door. What it draws and reads, on e3, is e3-ui-components'
 * (`plan/frame/plan-case-kinds-examples`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, DictType, East, NullType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, type EastIR } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Schedule, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-case-kinds.examples.js";

describe("one record of every kind of step (#1769)", () => {
    test(ex.planCaseKinds.description, () => {
        const manifest = deriveManifest(ex.planCaseKinds.fn);
        // Its machines a page at a time and its steps a cell at a time, never either whole, and every kind of step saved
        // through the one patch door of the one record.
        assert.deepEqual(manifest.pages, [ex.planCaseSteps.path, ex.planCaseMachines.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads the machines or the steps whole");
        assert.deepEqual(manifest.records, [ex.planCaseSteps.name]);
        const component = (ex.planCaseKinds.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });

    test("accepts a 3-case variant that includes none and some alongside another case", () => {
        const Row = StructType({
            start: DateTimeType, end: DateTimeType, title: StringType,
            scope: VariantType({ none: NullType, some: StructType({ note: StringType }), all: StructType({ note: StringType }) }),
        });
        const rec = e3.record("case_kinds_three_case", DictType(StringType, Row), {
            initial: new Map(),
            mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.doesNotThrow(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(rec, ["patch"]));
            Schedule.events.kinds(bound, "scope", {
                some: { name: "Some", icon: "i", draw: "span", title: "title", start: "start", end: "end" },
                all: { name: "All", icon: "i", draw: "span", title: "title", start: "start", end: "end" },
            });
            return null;
        }));
    });

    test("refuses mixing incompatible time fields or resource placement across cases sharing a paged source", () => {
        const Row = StructType({
            press: StringType, start: DateTimeType, end: DateTimeType, title: StringType,
            kind: VariantType({ run: StructType({ sheets: StringType }), milestone: NullType }),
        });
        const rec = e3.record("case_kinds_shared_source_mismatch", DictType(StringType, Row), {
            initial: new Map(),
            mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(rec, ["patch"]));
            Schedule.events.kinds(bound, "kind", {
                run: { name: "Run", icon: "i", draw: "span", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } },
                milestone: { name: "Milestone", icon: "i", draw: "marks", title: "title", at: "start", resource: { field: "press", of: "presses" } },
            }, { entries: Data.bindPaged(rec), source: "steps" });
            return null;
        }), /share source "steps" with different time fields/);
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(rec, ["patch"]));
            Schedule.events.kinds(bound, "kind", {
                run: { name: "Run", icon: "i", draw: "span", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } },
                milestone: { name: "Milestone", icon: "i", draw: "span", title: "title", start: "start", end: "end" },
            }, { entries: Data.bindPaged(rec), source: "steps" });
            return null;
        }), /share source "steps" with different resource fields/);
    });
});
