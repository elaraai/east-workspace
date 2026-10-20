/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's DOM test harness over the print works' examples (#1192, #1193,
 * #1195, #1197), on e3 itself (#1375): the examples' records deployed to
 * e3-web, each test a workspace of its own, every read a real one through the
 * records' indexes and every Save a real commit through their patch doors.
 * What a test counts it reads from the request log (`h.requests`); another
 * planner's write is a real commit ({@link PlanHarness.commit}). A test file
 * calls {@link planHarness} once, at its top, and mounts Plans as a surface
 * does: through the dispatcher, under the page's drag layer when its cards
 * drag, as the showcase mounts an e3 example.
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): once a test ends,
 * the work it left in flight settles before the next begins, and a body its
 * timeout abandoned starts nothing more. A test file takes `act` from here,
 * never from Testing Library.
 *
 * @packageDocumentation
 */

import type { RenderResult } from "@testing-library/react";
import { printFor, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import type { E3Record } from "../../e3-web.test-utils.js";
import { act, e3Harness, programOf, settle, type E3Harness, type Example, type UIProgram } from "../../e3-web-mount.test-utils.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
// The canvas is an extension: its renderer registers as it loads.
import "../index.js";

/** The `act` the harness's tests take: each scope its test's work, until it closes (#1280). */
export { act, programOf, settle };

/** A compiled Plan: a program that returns its UI component. */
export type PlanProgram = UIProgram;

/** How a test mounts a Plan. */
export interface MountOptions {
    /** Mount the page's drag layer around it, as a surface whose cards drag does. */
    drag?: boolean | undefined;
    /** The program to render in place of the example's own: a counted one (`builds.test-utils.ts`). */
    program?: PlanProgram | undefined;
    /** Where its view and sessions are kept; `plan` unless given. */
    storageKey?: string | undefined;
}

/** What a Plan test reads and writes through: e3, and the print works mounted over it. */
export interface PlanHarness extends E3Harness {
    /**
     * Commits a record's state as another planner would, through its patch
     * door; then lets the mounted Plans' reads and renders settle.
     *
     * @param record - The record, which declares its patch door
     * @param state - Its new state
     */
    commit<T extends EastType>(record: E3Record<T>, state: ValueTypeOf<T>): Promise<void>;
    /**
     * Mounts a Plan through the dispatcher, as a surface does, once what it
     * reads whole has loaded.
     *
     * @param example - The Plan's example, or its own East function as one (`{ fn }`)
     * @param options - Whether the page holds a drag layer, a program in its place, where it keeps its sessions
     * @returns The render
     */
    mount(example: Example, options?: MountOptions): Promise<RenderResult>;
}

/**
 * Installs the harness around each test of the file: e3 with the print works'
 * examples deployed, started once; a workspace of its own, and a fresh store,
 * for each test; after each, the DOM and the viewer's storage are cleared.
 *
 * @param modules - The e3-ui example modules the file mounts, by their keys: the print works' unless given
 * @returns The harness
 */
export function planHarness(modules: Readonly<Record<string, Readonly<Record<string, unknown>>>> = { "plan/plan-events": ex }): PlanHarness {
    const h = e3Harness(modules, { measure: false });
    const mountOver = h.mount;
    return Object.assign(h, {
        commit: <T extends EastType>(record: E3Record<T>, state: ValueTypeOf<T>) => h.patch(record, state),
        mount: (example: Example, options: MountOptions = {}) => mountOver(example, {
            drag: options.drag === true,
            storageKey: options.storageKey ?? "plan",
            ...(options.program !== undefined && { program: options.program }),
        }),
    });
}

/**
 * A region of the Plan's frame.
 *
 * @param container - The render's container
 * @param name - The region: `toolbar`, `banners`, `start`, `main`, `end` or `footer`
 * @returns Its element, if the frame draws it
 */
export const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`);

/**
 * A pane's tabs, as they read.
 *
 * @param pane - The pane's region
 * @returns Each tab's text: its name and its count
 */
export const tabs = (pane: HTMLElement) => [...pane.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

/**
 * A row's id, by its series and path.
 *
 * @param series - Its series: `<kind>.<draw>` for a resource's row
 * @param path - Its path: its group and its resource's key, for a resource's
 * @returns The id
 */
export const entry = (series: string, ...path: string[]): PlanRowId => variant("entry", { series, path }) as PlanRowId;

/**
 * The selector of a row, by its id — `data-plan-row` holds its id's text.
 *
 * @param id - The row's id
 * @returns The selector
 */
export const rowAt = (id: PlanRowId) => `[data-plan-row=${JSON.stringify(rowKeyOf(id))}]`;

const printRef = printFor(ScheduleEventRefType);

/**
 * An event's element key: its event, as East prints a `Schedule.Types.EventRef`.
 *
 * @param kind - The event's kind
 * @param key - The event's key in its record
 * @returns The key its elements carry
 */
export const elementKey = (kind: string, key: string) => printRef({ kind, key });

/**
 * The selector of an event's element, by the attribute its draw carries.
 *
 * @param attr - `data-run` for a bar, `data-chip` for a chip, `data-event` for a tile, `data-mark` for a mark
 * @param kind - The event's kind
 * @param key - The event's key in its record
 * @returns The selector
 */
export const el = (attr: "data-run" | "data-chip" | "data-event" | "data-mark", kind: string, key: string) =>
    `[${attr}=${JSON.stringify(elementKey(kind, key))}]`;
