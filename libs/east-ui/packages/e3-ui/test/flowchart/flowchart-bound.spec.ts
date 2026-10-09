/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Every Flowchart example reads its flows from e3 (#1251, `Flowchart Builder
// Spec.md` §2a): a record of flows, an input of one flow, or the host's
// tables, each an input — declared beside it in its module. That is what lets
// the showcase run it on e3-web, whose package carries every definition an
// example module exports; an inline collection as the flowchart's data runs
// nowhere but the page it is written in.

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { pathToString } from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import * as ex from "./flowchart.examples.js";

/** Each `example()` the module exports, by name. */
const EXAMPLES = Object.entries(ex).flatMap(([name, value]) =>
    "keywords" in value && "fn" in value ? [{ name, fn: value.fn }] : []);

/** The path of every dataset the module's e3 definitions provide — an input's
 *  or a record's own — as e3 prints it (`.inputs.flowchart_depot_scans`). */
const PROVIDED = new Set(Object.values(ex).flatMap((value) =>
    "kind" in value && value.kind === "dataset" ? [pathToString(value.path)] : []));

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

    hostTest("the host's tables are the flowchart's: the depot's flow reads its states, its scans and its decisions, each an input", () => {
        const { paths } = deriveManifest(ex.flowchartDepot.fn as never);
        assert.deepEqual(new Set(paths.map(pathToString)), new Set([ex.depotStates, ex.scanTransitions, ex.depotDecisions].map((input) => pathToString(input.path))));
    });
});
