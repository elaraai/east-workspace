/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's DOM tests' shared harness (#1246–#1249), on e3 itself
 * (#1376): the Flowchart's example module deployed to e3-web, each test a
 * workspace of its own, every read a real one and every Save a real commit. A
 * test's flows are the depot's record (`depotFlows`) as another session's
 * commit leaves them ({@link FlowchartHarness.commitFlows}); the flowchart
 * over it, bound with its patch mutation as an app binds one
 * ({@link FlowchartHarness.mountRecord}), under the page's drag layer where a
 * test drags (#1249); a payload a test builds, through the Flowchart's
 * renderer under the providers a surface mounts
 * ({@link FlowchartHarness.mountPayload}). The library's records are the
 * examples', read and paged through their indexes on e3 (#1346). What a test
 * counts it reads from the request log (`h.requests`); and the waits and
 * presses its tests share.
 *
 * Each test runs alone (#1280, `test-runs.test-utils.ts`): a test file takes
 * `act` from here, never from Testing Library.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { fireEvent, within, type RenderResult } from "@testing-library/react";
import { East, type BlockBuilder, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, e3Harness, settle, type E3Harness } from "../e3-web-mount.test-utils.js";
// The flowchart is an extension: its renderer registers as it loads.
import { EastChakraFlowchart } from "./index.js";

/** The `act` the harness's tests take: each scope its test's work, until it closes (#1280). */
export { act, settle };

type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;

/** A paged Library's row, as tall as its card (#1346). */
const PAGED_ROW_PX = 56;

/** The frame's toolbar, where the history item is. */
export const toolbar = () => within(document.querySelector("[data-frame-slot='toolbar']") as HTMLElement);

/**
 * Presses one of the history item's buttons, by its words, as a pointer does.
 *
 * @param name - The button's accessible name
 */
export async function press(name: string): Promise<void> {
    const button = toolbar().getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/**
 * Whether one of the history item's buttons is on.
 *
 * @param name - The button's accessible name
 * @returns Whether it is enabled
 */
export const enabled = (name: string): boolean => !(toolbar().getByRole("button", { name }) as HTMLButtonElement).disabled;

/** A flowchart's payload as a test builds it: an East function returning `Flowchart.Payload`'s value. */
export interface PayloadFunction {
    /** Its IR: what is compiled under the runtimes a surface installs, and what its reads are derived from. */
    toIR(): EastIR<[], typeof Flowchart.Types.Payload>;
}

/** How a test mounts a flowchart. */
export interface MountOptions {
    /** Under the drag layer an app mounts once at its root, as the showcase does: its library's cards drag, and its canvas takes them (#1249). */
    readonly drag?: boolean;
    /** Where its view and sessions are kept. */
    readonly storageKey?: string;
}

/** What a Flowchart test reads and writes through: e3, the depot's record of flows on it, and the flowcharts mounted over them. */
export interface FlowchartHarness extends E3Harness {
    /**
     * Commits the depot's flows as another session would, then settles: a
     * test's flows before its flowchart mounts, or another writer's under it.
     *
     * @param flows - The flows, as the commit leaves them
     */
    commitFlows(flows: Flows): Promise<void>;
    /** What e3 holds of the depot's flows now. */
    flows(): Promise<Flows>;
    /** The depot's flows' commits, newest first, by the mutation that made each. */
    commits(): Promise<string[]>;
    /**
     * The flowchart over the depot's record, as a surface mounts it: `<Flowchart>`
     * built over the record bound with its patch mutation, in a Reactive root,
     * rendered through its carrier once what it reads whole has loaded.
     *
     * @param props - Its props beside `record` — or what makes them in the surface's body, where it binds other records; the Flows tab listed, by default
     * @param options - Whether the page holds a drag layer, and where it keeps its sessions
     * @returns The render
     */
    mountRecord(props?: object | (($: BlockBuilder<UIComponentType>) => object), options?: MountOptions): Promise<RenderResult>;
    /**
     * A flowchart's payload as a test builds it, through the Flowchart's
     * renderer: built under the runtimes a surface installs, once what it reads
     * whole has loaded.
     *
     * @param payload - The East function that builds it
     * @param options - Whether the page holds a drag layer, and where it keeps its sessions
     * @returns The render
     */
    mountPayload(payload: PayloadFunction, options?: MountOptions): Promise<RenderResult>;
}

/** A payload, built under the runtimes a surface installs, rendered by the Flowchart's renderer as given. */
function PayloadFlowchart({ payload, storageKey }: { payload: PayloadFunction; storageKey: string }) {
    const value = useMemo(() => payload.toIR().compile(getRegisteredPlatformImplementations())(), [payload]);
    return <EastChakraFlowchart value={value} storageKey={storageKey} />;
}

/**
 * Installs the harness around each test of the file: e3 with the Flowchart's
 * examples deployed, started once; a workspace of its own and a fresh store for
 * each test; and, for each, what jsdom cannot lay out — a viewport for the
 * real Library virtualizer, rather than virtualization switched off in the
 * production adapter, and each row of a paged Flows tab (#1346) its card's
 * height, as a browser draws it: jsdom's 0 would mount every row of a record of
 * thousands, each measured afresh.
 *
 * @returns The harness
 */
export function flowchartHarness(): FlowchartHarness {
    const h = e3Harness({ "flowchart/flowchart": ex }, { measure: false });
    let restoreRows: () => void = () => {};
    beforeEach(() => {
        // Spied each test: the harness restores every spy as a test ends.
        const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
        const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
            return this.closest("[data-flowchart-flows]") === null ? height.get!.call(this) : 480;
        });
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
            return this.closest("[data-flowchart-flows]") === null ? width.get!.call(this) : 272;
        });
        const rect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (this instanceof HTMLElement && this.dataset["slot"] === "virtualRow" && this.closest("[data-library-paged]") !== null) {
                return { x: 0, y: 0, top: 0, left: 0, right: 272, bottom: PAGED_ROW_PX, width: 272, height: PAGED_ROW_PX, toJSON: () => ({}) } as DOMRect;
            }
            return rect.call(this);
        };
        restoreRows = () => { Element.prototype.getBoundingClientRect = rect; };
    });
    afterEach(() => {
        restoreRows();
        restoreRows = () => {};
    });
    const mountOver = h.mount;
    return Object.assign(h, {
        commitFlows: (flows: Flows) => h.patch(ex.depotFlows, flows),
        flows: () => h.read(ex.depotFlows),
        commits: async () => (await h.history(ex.depotFlows)).commits.map((commit) => commit.mutation),
        mountRecord: (props: object | (($: BlockBuilder<UIComponentType>) => object) = { library: [Flowchart.library.flows()] }, options: MountOptions = {}) => {
            const flowchart = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const flows = $.let(Record.bind(ex.depotFlows, [ex.depotFlowsPatch]));
                return Flowchart({ record: flows, ...(typeof props === "function" ? props($) : props) });
            }))) };
            return mountOver(flowchart, { drag: options.drag === true, storageKey: options.storageKey ?? "flowchart-record" });
        },
        mountPayload: (payload: PayloadFunction, options: MountOptions = {}) => {
            const storageKey = options.storageKey ?? "flowchart-payload";
            return mountOver({ fn: payload }, { drag: options.drag === true, storageKey, view: <PayloadFlowchart payload={payload} storageKey={storageKey} /> });
        },
    });
}
