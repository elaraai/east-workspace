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
import { decodeBeast2For, encodeBeast2For, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
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
});
