/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, beforeEach, vi } from "vitest";
import { East } from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { clearFunctionApi, clearPagedApi, createInMemoryFunctionApi, initializeFunctionApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, pathText, recordPaging, type WholeReads } from "../platform/record-paging.test-utils.js";
import { builderHarness } from "../shared/builder-harness.test-utils.js";
import "./index.js";
export { act, mount, programOf, settle, slot, width } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "allocation-test";
/** The mock's plan day, Tue 11 May 2027; Tue 4 is published, Wed 12 holds split loads, Thu 13 has no entry. */
export const TUE = new Date("2027-05-11T00:00:00Z");
export const TUE_4 = new Date("2027-05-04T00:00:00Z");
export const WED = new Date("2027-05-12T00:00:00Z");
export const THU = new Date("2027-05-13T00:00:00Z");

/**
 * The kiln yard's records under the shared builder harness, read a window at a
 * time through the stand-in paging service as e3 serves them: the plans, the
 * windowed example's history, the kilns with their group, group-then-max and
 * name indexes, the bays with their area and cover indexes and the loads with
 * their spec index, which the record Slice narrows by; `paging.failing`
 * names the records whose reads fail. The yard's fits are served by name through the
 * shared `Func` runtime, each its `e3.function`'s own East body, as e3 runs it:
 * `calls` counts what the board asks of each, `answers` keeps each one's
 * last answer and `history` every answer in turn; `hold()` keeps the answers on their way until its release, and
 * `failure` makes every call fail with its message.
 */
export function allocationHarness() {
    const h = builderHarness(WORKSPACE, [ex.kilnPlans, ex.kilnHistory, ex.kilns, ex.arrivals, ex.yardBays], "data-allocation-main");
    const paging = { failing: new Set<string>() } as { reads: WholeReads; requests: string[]; failing: Set<string> };
    const fits = {
        calls: new Map<string, number>(), answers: new Map<string, unknown>(), history: [] as unknown[], failure: undefined as string | undefined,
        gate: undefined as Promise<void> | undefined,
        /** Holds every answer until the release. */
        hold() { let release!: () => void; fits.gate = new Promise<void>(resolve => { release = resolve; }); return () => { fits.gate = undefined; release(); }; },
    };
    const yardFit = East.compile(ex.yardFitBody, []), bulkFit = East.compile(ex.bulkFitBody, []);
    // The plans' bin values, as the plans record's type holds them.
    const values = ex.kilnPlans.type.value.fields.bins.value.fields.values;
    const served = (name: string, body: (request: unknown) => unknown) => ({
        name, inputTypes: [Allocation.Types.FitRequest(values)], outputType: Allocation.Types.FitResult,
        fn: async (request: unknown) => {
            fits.calls.set(name, (fits.calls.get(name) ?? 0) + 1);
            if (fits.gate !== undefined) await fits.gate;
            if (fits.failure !== undefined) throw new Error(fits.failure);
            const answer = body(request);
            fits.answers.set(name, answer);
            fits.history.push(answer);
            return answer;
        },
    });
    beforeEach(() => {
        paging.reads = countWholeReads(h.cache);
        initializeRecordApi(paging.reads.serve(h.memory), h.cache, WORKSPACE);
        // Each index served as e3 serves it: its own key function, over each entry.
        type Index = typeof ex.kilnsByGroup | typeof ex.kilnsByGroupMax | typeof ex.kilnsByName | typeof ex.yardBaysByArea | typeof ex.yardBaysByCover | typeof ex.arrivalsBySpec;
        const spec = (index: Index) => {
            const keys = East.compile(index.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
            return { name: index.name, keyType: index.keyType, keys: (key: unknown, row: unknown) => [keys(key, row)] };
        };
        const service = recordPaging(h.cache, paging.reads.raw, [
            { path: ex.kilnPlans.path, type: ex.kilnPlans.type },
            { path: ex.kilnHistory.path, type: ex.kilnHistory.type },
            { path: ex.kilns.path, type: ex.kilns.type, indexes: [spec(ex.kilnsByGroup), spec(ex.kilnsByGroupMax), spec(ex.kilnsByName)] },
            { path: ex.yardBays.path, type: ex.yardBays.type, indexes: [spec(ex.yardBaysByArea), spec(ex.yardBaysByCover)] },
            { path: ex.arrivals.path, type: ex.arrivals.type, indexes: [spec(ex.arrivalsBySpec)] },
        ]);
        paging.requests = service.requests;
        paging.failing.clear();
        const fails = (path: Parameters<typeof service.api.getPage>[1]) => {
            if (paging.failing.has(pathText(path))) throw new Error(`${pathText(path)} is unavailable`);
        };
        initializePagedApi({ ...service.api,
            getPage: async (workspace, path, window) => { fails(path); return service.api.getPage(workspace, path, window); },
            findKey: async (workspace, path, query) => { fails(path); return service.api.findKey(workspace, path, query); },
        }, WORKSPACE);
        fits.calls.clear(); fits.answers.clear(); fits.history.length = 0; fits.failure = undefined; fits.gate = undefined;
        initializeFunctionApi(createInMemoryFunctionApi([served("yard_fit", yardFit as (r: unknown) => unknown), served("yard_bulk_fit", bulkFit as (r: unknown) => unknown)]), WORKSPACE);
    });
    afterEach(() => { clearPagedApi(); clearFunctionApi(); });
    return Object.assign(h, { paging, fits });
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
