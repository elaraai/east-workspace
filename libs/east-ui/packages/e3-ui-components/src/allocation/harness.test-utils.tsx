/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import * as ex from "@elaraai/e3-ui/examples/allocation/allocation";
import { builderHarness } from "../shared/builder-harness.test-utils.js";
import "./index.js";
export { act, mount, programOf, settle, slot, width } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "allocation-test";
/** The mock's plan day, Tue 11 May 2027; Tue 4 is published, Wed 12 holds split loads, Thu 13 has no entry. */
export const TUE = new Date("2027-05-11T00:00:00Z");
export const TUE_4 = new Date("2027-05-04T00:00:00Z");
export const WED = new Date("2027-05-12T00:00:00Z");
export const THU = new Date("2027-05-13T00:00:00Z");
export const allocationHarness = () => builderHarness(WORKSPACE, [ex.kilnPlans, ex.kilnHistory, ex.kilns, ex.arrivals, ex.yardBays], "data-allocation-main");
