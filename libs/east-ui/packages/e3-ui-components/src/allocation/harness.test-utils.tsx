/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's examples on e3 itself (#1376): the kiln yard's module
 * deployed to e3-web (`allocation/allocation`), each test a workspace of its
 * own. The bays, the kilns and the loads are read a window at a time through
 * their indexes as e3 serves them, the windowed example's history a day at a
 * time, and every Save and Publish is a real commit through the plans' patch
 * door. Another session's edit of the plans or the kilns goes in through their
 * doors (`h.patch`), and a record whose reads fail is a fault at the harness's
 * fetch ({@link AllocationHarness.unavailable}). The yard's fits are the
 * examples' own `e3.function`s, called by name on e3
 * (`shared/func/fit-calls.test-utils.ts`). What a test counts it reads from the
 * request log (`h.requests`).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */
import { vi } from "vitest";
import type { ValueTypeOf } from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import type { E3Dataset } from "../e3-web.test-utils.js";
import { e3Harness, type E3Harness } from "../e3-web-mount.test-utils.js";
import { fitCalls, type FitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./index.js";
export { act, programOf, settle, slot, width, type Example, type MountOptions } from "../e3-web-mount.test-utils.js";
/** The mock's plan day, Tue 11 May 2027; Tue 4 is published, Wed 12 holds split loads, Thu 13 has no entry. */
export const TUE = new Date("2027-05-11T00:00:00Z");
export const TUE_4 = new Date("2027-05-04T00:00:00Z");
export const WED = new Date("2027-05-12T00:00:00Z");
export const THU = new Date("2027-05-13T00:00:00Z");

/** A question to the yard's fit, over the plans' bin values as the plans record's type holds them. */
const FIT_REQUEST = Allocation.Types.FitRequest(ex.kilnPlans.type.value.fields.bins.value.fields.values);
/** A question to the yard's fit, and its answer, decoded. */
export type FitRequest = ValueTypeOf<typeof FIT_REQUEST>;
export type FitResult = ValueTypeOf<typeof Allocation.Types.FitResult>;

/** The Allocation's harness: e3 with the kiln yard's module deployed, the fits its board asks, and a record's reads made to fail. */
export interface AllocationHarness extends E3Harness {
    /** The yard's fits, as the board asks them: `yard_fit`, or `yard_bulk_fit`, by name. */
    readonly fits: FitCalls<FitRequest, FitResult>;
    /**
     * Fails every read of a record from now — its pages and its key searches,
     * through any of its indexes — as e3 answers one it cannot serve
     * (`500`, `internal`), until the returned function stops it.
     *
     * @param record - The record
     * @returns What stops it
     */
    unavailable(record: E3Dataset): () => void;
}

/**
 * The kiln yard's records on e3: the module's package deployed once for the
 * file, a workspace of its own for each test.
 *
 * @returns The harness
 */
export function allocationHarness(): AllocationHarness {
    const h = e3Harness({ "allocation/allocation": ex }, { main: "data-allocation-main" });
    return Object.assign(h, {
        fits: fitCalls(h, { request: FIT_REQUEST, result: Allocation.Types.FitResult }),
        unavailable(record: E3Dataset) {
            const dataset = record.path.map((step) => step.value).join(".");
            return h.e3.fail((request) => (request.kind === "page" || request.kind === "find") && request.dataset === dataset,
                { status: 500, type: "internal", message: `${dataset} is unavailable` });
        },
    });
}

/**
 * The board's three boxes the links run between, as a browser lays them out —
 * jsdom lays out nothing: the board at the window's corner, 1200 × 700, so the
 * links' layer, under its 48px head, is the window's px less 48 down; the lane
 * grid from 10, 336 wide; the channel to 395, the rows' leading edge.
 */
export function stubLinkGeometry() {
    const spy = vi.mocked(Element.prototype.getBoundingClientRect);
    const base = spy.getMockImplementation()!;
    spy.mockImplementation(function (this: Element) {
        const box = (left: number, width: number, height: number) => ({ x: left, y: 0, top: 0, left, right: left + width, bottom: height, width, height, toJSON() {} });
        if (this.hasAttribute("data-allocation-timeline")) return box(0, 1200, 700);
        if (this.hasAttribute("data-allocation-grid")) return box(10, 336, 1116);
        if (this.hasAttribute("data-allocation-channel")) return box(347, 48, 700);
        return base.call(this);
    });
}
