/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { afterEach, beforeEach } from "vitest";
import { East } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { clearPagedApi, initializePagedApi, initializeRecordApi } from "../platform/index.js";
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
 * record Slice narrows by.
 */
export function allocationHarness() {
    const h = builderHarness(WORKSPACE, [ex.kilnPlans, ex.kilnHistory, ex.kilns, ex.arrivals, ex.yardBays], "data-allocation-main");
    const paging = {} as { reads: WholeReads; requests: string[] };
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
    });
    afterEach(() => clearPagedApi());
    return Object.assign(h, { paging });
}
