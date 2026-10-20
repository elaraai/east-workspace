/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's DOM test harness over its examples (#1184, #1186, #1216), on e3
 * itself (#1376): the Sheet's example module deployed to e3-web, each test a
 * workspace of its own, every read a real one — a record read whole, or paged
 * through its indexes by the rail's sources (#1345) — and every Save a real
 * commit through its record's patch door. What a test counts it reads from the
 * request log (`h.requests`); another session's write is a real commit
 * (`h.patch`, `h.race`). Each test's page is the theme, the locale (en-US) and
 * what jsdom lacks: a bounded frame over the grid's rows, 400px unless the
 * file says. A test file calls {@link sheetHarness} once, at its top, and
 * mounts a sheet as a surface does — an example through the dispatcher, under
 * the page's drag layer when it drags (#1187) — or a payload it builds itself,
 * through the Sheet's renderer ({@link SheetHarness.mountPayload}).
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): once a test ends,
 * the work it left in flight settles before the next begins, and a body its
 * timeout abandoned starts nothing more. A test file takes `act` from here,
 * never from Testing Library.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactNode } from "react";
import { afterEach, beforeEach } from "vitest";
import type { RenderResult } from "@testing-library/react";
import type { EastIR } from "@elaraai/east";
import type { SheetPayloadType } from "@elaraai/e3-ui/internal";
import { I18nProvider, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { e3Harness, type E3Harness, type Example, type UIProgram } from "../../e3-web-mount.test-utils.js";
import { boundFrame } from "../frame.test-utils.js";
// The Sheet is an extension: its renderer registers as it loads.
import { EastChakraSheet } from "./index.js";

/** The `act` the harness's tests take: each scope its test's work, until it closes (#1280). */
export { act, programOf, settle } from "../../e3-web-mount.test-utils.js";

/** The frame over the grid's rows: 400px, a screenful of a dozen rows. */
const VIEWPORT = 400;

/** A sheet's payload as a test builds it: an East function returning `Sheet.Payload`'s value. */
export interface PayloadFunction {
    /** Its IR: what is compiled under the runtimes a surface installs, and what its reads are derived from. */
    toIR(): EastIR<[], typeof SheetPayloadType>;
}

/** How a test mounts a sheet. */
export interface MountOptions {
    /** Mount the page's drag layer around it, as a surface that drags does (#1187). */
    drag?: boolean | undefined;
    /** The program to render in place of the example's own: a counted one (`builds.test-utils.ts`). */
    program?: UIProgram | undefined;
    /** Where its view and sessions are kept; `sheet` unless given. */
    storageKey?: string | undefined;
    /** What the page holds the sheet in, inside its locale: a message table (`SheetMessagesProvider`), say. */
    wrap?: ((sheet: ReactNode) => ReactNode) | undefined;
}

/** What a Sheet test reads and writes through: e3, and the sheets mounted over it. */
export interface SheetHarness extends E3Harness {
    /**
     * Mounts an example of the Sheet's through the dispatcher, as a surface
     * does, once what it reads whole has loaded.
     *
     * @param example - The example, or a program's own East function as one (`{ fn }`)
     * @param options - Whether the page holds a drag layer, a program in its place, where it keeps its sessions, what holds it
     * @returns The render
     */
    mount(example: Example, options?: MountOptions): Promise<RenderResult>;
    /**
     * Mounts a sheet's payload as a test builds it, through the Sheet's
     * renderer: built under the runtimes a surface installs, once what it
     * reads whole has loaded.
     *
     * @param payload - The East function that builds it
     * @param options - Whether the page holds a drag layer, where it keeps its sessions, what holds it
     * @returns The render
     */
    mountPayload(payload: PayloadFunction, options?: MountOptions): Promise<RenderResult>;
}

/** What a file's harness deploys, and how its frame is laid out. */
export interface SheetHarnessOptions {
    /** The e3-ui example modules the file mounts, by their keys: the Sheet's unless given. */
    modules?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** The frame over the grid's rows, its height in px: 400 unless given. */
    frame?: number;
}

/** A payload, built under the runtimes a surface installs, rendered by the Sheet's renderer as given. */
function PayloadSheet({ payload, storageKey }: { payload: PayloadFunction; storageKey: string }) {
    const value = useMemo(() => payload.toIR().compile(getRegisteredPlatformImplementations())(), [payload]);
    return <EastChakraSheet value={value} storageKey={storageKey} />;
}

/**
 * Installs the harness around each test of the file: e3 with the examples
 * deployed, started once; a workspace of its own, a fresh store and the
 * bounded frame for each test; after each, the DOM, the viewer's storage and
 * the frame are restored.
 *
 * @param options - The example modules the file mounts, and the frame's height
 * @returns The harness
 */
export function sheetHarness(options: SheetHarnessOptions = {}): SheetHarness {
    const h = e3Harness(options.modules ?? { "sheet/sheet": ex }, { measure: false });
    let restoreFrame: () => void = () => {};
    beforeEach(() => { restoreFrame = boundFrame(options.frame ?? VIEWPORT); });
    afterEach(() => {
        restoreFrame();
        restoreFrame = () => {};
    });
    const mountOver = h.mount;
    // The page around a sheet: its locale, and the drag layer when it drags.
    const page = (o: MountOptions) => ({
        drag: o.drag === true,
        storageKey: o.storageKey ?? "sheet",
        wrap: (surface: ReactNode) => <I18nProvider locale="en-US">{o.wrap === undefined ? surface : o.wrap(surface)}</I18nProvider>,
    });
    return Object.assign(h, {
        mount: (example: Example, o: MountOptions = {}) => mountOver(example, { ...page(o), ...(o.program !== undefined && { program: o.program }) }),
        mountPayload: (payload: PayloadFunction, o: MountOptions = {}) =>
            mountOver({ fn: payload }, { ...page(o), view: <PayloadSheet payload={payload} storageKey={o.storageKey ?? "sheet"} /> }),
    });
}

/**
 * A region of the sheet's frame.
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
