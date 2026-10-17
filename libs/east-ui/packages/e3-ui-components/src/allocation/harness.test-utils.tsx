/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, beforeEach } from "vitest";
import { East } from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { clearFunctionApi, clearPagedApi, createInMemoryFunctionApi, initializeFunctionApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
import { countWholeReads, recordPaging, type WholeReads } from "../platform/record-paging.test-utils.js";
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
 * windowed example's history, and the kilns with their group index, which the
 * record Slice narrows by. The yard's fits are served by name through the
 * shared `Func` runtime, each its `e3.function`'s own East body, as e3 runs it:
 * `calls` counts what the board asks of each, `answers` keeps each one's
 * last answer and `history` every answer in turn; `hold()` keeps the answers on their way until its release, and
 * `failure` makes every call fail with its message.
 */
export function allocationHarness() {
    const h = builderHarness(WORKSPACE, [ex.kilnPlans, ex.kilnHistory, ex.kilns, ex.arrivals, ex.yardBays], "data-allocation-main");
    const paging = {} as { reads: WholeReads; requests: string[] };
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
        const byGroup = East.compile(ex.kilnsByGroup.keyFn as never, []) as (key: unknown, row: unknown) => unknown;
        const service = recordPaging(h.cache, paging.reads.raw, [
            { path: ex.kilnPlans.path, type: ex.kilnPlans.type },
            { path: ex.kilnHistory.path, type: ex.kilnHistory.type },
            { path: ex.kilns.path, type: ex.kilns.type, indexes: [{ name: ex.kilnsByGroup.name, keyType: ex.kilnsByGroup.keyType, keys: (key, row) => [byGroup(key, row)] }] },
        ]);
        paging.requests = service.requests;
        initializePagedApi(service.api, WORKSPACE);
        fits.calls.clear(); fits.answers.clear(); fits.history.length = 0; fits.failure = undefined; fits.gate = undefined;
        initializeFunctionApi(createInMemoryFunctionApi([served("yard_fit", yardFit as (r: unknown) => unknown), served("yard_bulk_fit", bulkFit as (r: unknown) => unknown)]), WORKSPACE);
    });
    afterEach(() => { clearPagedApi(); clearFunctionApi(); });
    return Object.assign(h, { paging, fits });
}
