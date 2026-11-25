/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * One record of every kind of step (#1769), on e3 itself: `planCaseKinds`
 * mounts as a surface mounts it — the works' machines a page at a time, drawn
 * by what they are, and a kind of event per case of the steps' `kind` field,
 * each drawn its own way on the machines of its kind: the runs as bars and the
 * setups as marks on the presses, the shifts as chips on the crews, none on
 * another's machines. Every kind is read a cell at a time through the one
 * source they share, through its one series index, the steps never read
 * whole, and the footer counts that source's steps once.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-case-kinds";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-case-kinds": ex });

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The example's frame as a browser lays it: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

describe("one record of every kind of step on e3 (#1769)", () => {
    test("planCaseKinds: each kind of step drawn its own way on the machines of its kind, none on another's, all read through the one source's series index", async () => {
        const { container: c } = await h.mount(ex.planCaseKinds);
        await settle();
        const main = slot(c, "main") ?? c;
        expect([...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((node) => node.textContent ?? "")).toEqual([]);
        const press = rowAt(entry("press", "P1"));
        const crew = rowAt(entry("crew", "C1"));
        await waitFor(() => {
            // The runs as bars on the press's own row, the shifts as chips on the crew's.
            expect(main.querySelector(`${press} ${el("data-run", "run", "S-02")}`)).not.toBeNull();
            expect(main.querySelector(`${crew} ${el("data-chip", "shift", "S-07")}`)).not.toBeNull();
            // The setups as marks, on the row the press draws its marks on.
            expect(main.querySelector(el("data-mark", "setup", "S-01"))?.closest("[data-plan-row]")?.getAttribute("data-plan-row")).toContain("P1");
        });
        // No kind on another's machines: no run nor setup on a crew, no shift on a press.
        expect(main.querySelector(`${crew} [data-run], ${crew} [data-mark]`)).toBeNull();
        expect(main.querySelector(`${press} [data-chip]`)).toBeNull();
        // The footer counts the week's nine steps once: the one source all three kinds read through, counted once.
        await waitFor(() => expect(slot(c, "footer")?.textContent).toMatch(/^9 events/));
        // Every kind's cells through the one source's series index, and the steps never read whole.
        const dataset = pathText(ex.planCaseSteps.path as TreePath);
        expect(h.readKinds(dataset, "plan_case_steps_by_machine_week")).toEqual(expect.arrayContaining(["find", "runs"]));
        expect(h.requests("read", dataset)).toEqual([]);
    });
});
