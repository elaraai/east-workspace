/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The showcase's e3 fault hook (#1398, `showcase-e3-faults.ts`), from a spec:
 * installed before the page loads, then holds, faults and releases over the
 * page's requests of its e3, by what they ask and the dataset they name. A
 * spec that holds a read reads the page at rest with `settled(page, {
 * holding: true })`, since the builder's main stays busy over it.
 */

import { expect, type Page } from "playwright/test";
import { FAULTS_CONTROLS, FAULTS_FLAG, type FaultFailure, type FaultMatch, type FaultRequest, type ShowcaseE3Faults } from "../../showcase-e3-faults";

export type { FaultFailure, FaultMatch, FaultRequest } from "../../showcase-e3-faults";

/** What a builder's reads of a record take: its pages, its key searches, its rows and runs by key, and a narrowing's placement and membership. */
export const RECORD_READS = ["page", "find", "rows", "runs", "place", "within"] as const;

/** The window, as the hook's controls sit on it. */
type Scope = Record<string, ShowcaseE3Faults | undefined>;

/**
 * Asks for the hook: call before the page loads.
 *
 * @param page - The page
 */
export async function installE3Faults(page: Page): Promise<void> {
    await page.addInitScript((flag) => { (window as unknown as Record<string, unknown>)[flag] = true; }, FAULTS_FLAG);
}

/** Waits for e3 to have started and installed the hook. */
async function installed(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate((name) => (window as unknown as Scope)[name] !== undefined, FAULTS_CONTROLS), {
        message: "the showcase's e3 fault hook was not installed: install it before the page loads",
    }).toBe(true);
}

/**
 * Holds each request it matches in flight, from now until released.
 *
 * @returns The hold's id
 */
export async function holdE3(page: Page, match: FaultMatch): Promise<number> {
    await installed(page);
    return page.evaluate(({ name, match }) => (window as unknown as Scope)[name]!.hold(match), { name: FAULTS_CONTROLS, match });
}

/**
 * Answers each request it matches as the failure says — e3's 500 unless given
 * another — from now until released.
 *
 * @returns The fault's id
 */
export async function failE3(page: Page, match: FaultMatch, failure?: FaultFailure): Promise<number> {
    await installed(page);
    return page.evaluate(({ name, match, failure }) => (window as unknown as Scope)[name]!.fail(match, failure),
        { name: FAULTS_CONTROLS, match, failure });
}

/** Lets a hold's requests go on to e3 and holds no more, or stops a fault. */
export async function releaseE3(page: Page, id: number): Promise<void> {
    await installed(page);
    await page.evaluate(({ name, id }) => (window as unknown as Scope)[name]!.release(id), { name: FAULTS_CONTROLS, id });
}

/** How many requests a hold holds now. */
export async function heldE3(page: Page, id: number): Promise<number> {
    await installed(page);
    return page.evaluate(({ name, id }) => (window as unknown as Scope)[name]!.held(id), { name: FAULTS_CONTROLS, id });
}

/** Each request the page has made of its e3 since the hook was installed, in order. */
export async function e3Requests(page: Page): Promise<readonly FaultRequest[]> {
    await installed(page);
    return page.evaluate((name) => (window as unknown as Scope)[name]!.requests(), FAULTS_CONTROLS);
}
