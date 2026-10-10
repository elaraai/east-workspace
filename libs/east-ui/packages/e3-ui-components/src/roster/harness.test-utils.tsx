/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import * as ex from "@elaraai/e3-ui/examples/roster/roster";
import { builderHarness } from "../shared/builder-harness.test-utils.js";
import "./index.js";
export { act, mount, programOf, settle, slot, width } from "../shared/builder-harness.test-utils.js";
export const WORKSPACE = "roster-test";
export const START = new Date("2028-03-05T00:00:00Z");
export const NEXT = new Date("2028-03-12T00:00:00Z");
export const rosterHarness = () => builderHarness(WORKSPACE, [ex.rosterWeeks, ex.rosterStaff, ex.rosterConfiguration, ex.rosterForecast, ex.rosterProposals], "data-roster-main");
export const assignment = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-assignment="${id}"]`)!;
export const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-roster-card="${id}"]`)!;
