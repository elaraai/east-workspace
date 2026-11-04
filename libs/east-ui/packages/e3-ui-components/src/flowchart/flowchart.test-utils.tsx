/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's DOM tests' shared harness (#1502–#1505), on e3 itself: the
 * Flowchart's example module deployed to e3-web — the depot's four records,
 * its states, transitions, lanes and decisions, and the library's cards — each
 * test a workspace of its own, every read a real one and every Save a real
 * commit. A test commits a record's rows as another session would (`h.patch`)
 * and reads what e3 holds (`h.read`, {@link FlowchartHarness.commits}); it
 * mounts one of the examples as a surface mounts it
 * ({@link FlowchartHarness.mountExample}), a flowchart it builds over the
 * records, bound as an app binds them ({@link FlowchartHarness.mountFlowchart}),
 * or a payload it builds, through the Flowchart's renderer under the providers
 * a surface mounts ({@link FlowchartHarness.mountPayload}) — under the page's
 * drag layer where a test drags. What a test counts it reads from the request
 * log (`h.requests`); and the waits and presses its tests share.
 *
 * Each test runs alone (`test-runs.test-utils.ts`): a test file takes `act`
 * from here, never from Testing Library.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { fireEvent, within, type RenderResult } from "@testing-library/react";
import { East, type BlockBuilder, type EastIR } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, e3Harness, settle, type E3Harness, type Example } from "../e3-web-mount.test-utils.js";
// The flowchart is an extension: its renderer registers as it loads.
import { EastChakraFlowchart } from "./index.js";

/** The `act` the harness's tests take: each scope its test's work, until it closes. */
export { act, settle };

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

/** A flowchart's props, as a test gives them over the records it binds. */
export type FlowchartTestProps = Parameters<typeof Flowchart>[0];

/** How a test mounts a flowchart. */
export interface FlowchartMountOptions {
    /** Under the drag layer an app mounts once at its root, as the showcase does: its library's cards drag, and its canvas takes them. */
    readonly drag?: boolean;
    /** Where its view and sessions are kept. */
    readonly storageKey?: string;
}

/** What a Flowchart test reads and writes through: e3, the depot's records on it, and the flowcharts mounted over them. */
export interface FlowchartHarness extends E3Harness {
    /**
     * A record's commits, newest first, by the mutation that made each.
     *
     * @param record - The record
     * @returns Each commit's mutation
     */
    commits(record: { readonly name: string }): Promise<string[]>;
    /**
     * One of the Flowchart's examples, as a surface mounts it, once what it
     * reads whole has loaded.
     *
     * @param example - The example
     * @param options - Whether the page holds a drag layer, and where it keeps its sessions
     * @returns The render
     */
    mountExample(example: Example, options?: FlowchartMountOptions): Promise<RenderResult>;
    /**
     * A flowchart a test builds over the records it binds, as a surface mounts
     * it: `<Flowchart>` in a Reactive root, its props made in the root's body,
     * rendered through its carrier once what it reads whole has loaded.
     *
     * @param props - What makes its props, in the body where it binds the records
     * @param options - Whether the page holds a drag layer, and where it keeps its sessions
     * @returns The render
     */
    mountFlowchart(props: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps, options?: FlowchartMountOptions): Promise<RenderResult>;
    /**
     * A flowchart's payload as a test builds it, through the Flowchart's
     * renderer: built under the runtimes a surface installs, once what it reads
     * whole has loaded.
     *
     * @param payload - The East function that builds it
     * @param options - Whether the page holds a drag layer, and where it keeps its sessions
     * @returns The render
     */
    mountPayload(payload: PayloadFunction, options?: FlowchartMountOptions): Promise<RenderResult>;
}

/** A payload, built under the runtimes a surface installs, rendered by the Flowchart's renderer as given. */
function PayloadFlowchart({ payload, storageKey }: { payload: PayloadFunction; storageKey: string }) {
    const value = useMemo(() => payload.toIR().compile(getRegisteredPlatformImplementations())(), [payload]);
    return <EastChakraFlowchart value={value} storageKey={storageKey} />;
}

/**
 * Installs the harness around each test of the file: e3 with the Flowchart's
 * examples deployed, started once; and a workspace of its own and a fresh
 * store for each test.
 *
 * @returns The harness
 */
export function flowchartHarness(): FlowchartHarness {
    const h = e3Harness({ "flowchart/flowchart": ex }, { measure: false });
    const mountOver = h.mount;
    return Object.assign(h, {
        commits: async (record: { readonly name: string }) => (await h.history(record)).commits.map((commit) => commit.mutation),
        mountExample: (example: Example, options: FlowchartMountOptions = {}) =>
            mountOver(example, { drag: options.drag === true, storageKey: options.storageKey ?? "flowchart-example" }),
        mountFlowchart: (props: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps, options: FlowchartMountOptions = {}) => {
            const flowchart = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => Flowchart(props($))))) };
            return mountOver(flowchart, { drag: options.drag === true, storageKey: options.storageKey ?? "flowchart-records" });
        },
        mountPayload: (payload: PayloadFunction, options: FlowchartMountOptions = {}) => {
            const storageKey = options.storageKey ?? "flowchart-payload";
            return mountOver({ fn: payload }, { drag: options.drag === true, storageKey, view: <PayloadFlowchart payload={payload} storageKey={storageKey} /> });
        },
    });
}
