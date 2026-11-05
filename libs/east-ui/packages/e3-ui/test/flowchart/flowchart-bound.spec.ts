/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Every Flowchart example reads its records from e3 (`Flowchart Records
// Spec.md` R1): its states, transitions, lanes and decisions, and the records
// of its cards — each declared beside it in its module. That is what lets the
// showcase draw it on e3-web, whose package carries every definition an
// example module exports; an inline collection as the flowchart's data draws
// nowhere but the page it is written in.

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { pathToString, type TreePath } from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import * as ex from "./flowchart.examples.js";

/** Each `example()` the module exports, by name. */
const EXAMPLES = Object.entries(ex).flatMap(([name, value]) =>
    "keywords" in value && "fn" in value ? [{ name, fn: value.fn }] : []);

/** The path of every dataset the module's e3 definitions provide — an input's
 *  or a record's own — as e3 prints it (`.records.flowchart_depot_states`). */
const PROVIDED = new Set(Object.values(ex).flatMap((value) =>
    "kind" in value && value.kind === "dataset" ? [pathToString(value.path)] : []));

/** A dataset's path, as e3 prints it. */
const printed = (dataset: { path: TreePath }): string => pathToString(dataset.path);

describe("Flowchart examples read e3", () => {
    hostTest("every example reads a dataset or a record of e3", () => {
        assert.notEqual(EXAMPLES.length, 0, "the module exports no example()");
        const unbound = EXAMPLES.filter(({ fn }) => {
            const { paths, pages } = deriveManifest(fn as never);
            return paths.length + pages.length === 0;
        }).map(({ name }) => name);
        assert.deepEqual(unbound, []);
    });

    hostTest("every dataset an example reads is declared in its module, so the showcase's package carries it", () => {
        const undeclared = EXAMPLES.flatMap(({ name, fn }) => {
            const { paths, pages } = deriveManifest(fn as never);
            return [...paths, ...pages].map(pathToString).filter((path) => !PROVIDED.has(path)).map((path) => `${name} reads ${path}`);
        });
        assert.deepEqual(undeclared, []);
    });

    hostTest("the front door reads its states, its transitions, its lanes and their time in state whole, read only", () => {
        const { paths, pages, records } = deriveManifest(ex.flowchartDwell.fn as never);
        assert.deepEqual(records, []);
        assert.deepEqual(pages, []);
        assert.deepEqual(new Set(paths.map(pathToString)), new Set([ex.depotStates, ex.depotTransitions, ex.depotLanes, ex.stateDwell].map(printed)));
    });

    hostTest("the phone's depot binds its states and its transitions for editing, and reads them, its lanes and the states' details whole", () => {
        const { paths, pages, records } = deriveManifest(ex.flowchartDepotPhone.fn as never);
        assert.deepEqual(new Set(records), new Set([ex.depotStates, ex.depotTransitions].map((record) => record.name)));
        assert.deepEqual(pages, []);
        assert.deepEqual(new Set(paths.map(pathToString)), new Set([ex.depotStates, ex.depotTransitions, ex.depotLanes, ex.stateEvidence].map(printed)));
    });

    hostTest("the depot binds its four records for editing; it reads its states and its transitions a page at a time, never whole, their details by the drawn rows' keys, and its lanes, its decisions and its cards whole", () => {
        const { paths, pages, records } = deriveManifest(ex.flowchartDepot.fn as never);
        assert.deepEqual(new Set(records), new Set([ex.depotStates, ex.depotTransitions, ex.depotLanes, ex.depotDecisions].map((record) => record.name)));
        assert.deepEqual(new Set(pages.map(pathToString)),
            new Set([ex.depotStates, ex.depotTransitions, ex.stateEvidence, ex.moveEvidence, ex.stepCards, ex.moveCards, ex.laneCards].map(printed)));
        assert.deepEqual(new Set(paths.map(pathToString)),
            new Set([ex.depotLanes, ex.depotDecisions, ex.stepCards, ex.moveCards, ex.laneCards, ex.decisionOwners].map(printed)));
    });

    hostTest("the dimmed depot reads its states and its transitions through their sources alone, read only, the states' details by key, and its lanes whole", () => {
        const { paths, pages, records } = deriveManifest(ex.flowchartDepotDimmed.fn as never);
        assert.deepEqual(records, []);
        assert.deepEqual(new Set(pages.map(pathToString)), new Set([ex.depotStates, ex.depotTransitions, ex.stateEvidence].map(printed)));
        assert.deepEqual(paths.map(pathToString), [printed(ex.depotLanes)]);
    });
});
