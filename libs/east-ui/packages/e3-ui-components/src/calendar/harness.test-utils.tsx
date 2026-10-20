/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's examples on e3 itself (#1375): the operations module
 * deployed to e3-web, each test's records a workspace of their own, every read
 * a real one through the records' indexes and every Save a real patch commit.
 * What a test counts it reads from the request log (`h.requests`).
 *
 * @packageDocumentation
 */

import { decodeBeast2For, encodeBeast2For, none, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import type { E3Request } from "../e3-web.test-utils.js";
import { act, e3Harness, settle, type E3Harness, type Example, type MountOptions } from "../e3-web-mount.test-utils.js";
import { eventKey } from "./model.js";
import "./index.js";
export { act, settle, slot, width, programOf } from "../e3-web-mount.test-utils.js";

/** A source's narrowing: each field's choice, as the rail writes it. */
export type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** The Calendar's harness: e3 with the operations module deployed, and an example opened over a store of its own. */
export interface CalendarHarness extends E3Harness {
    /**
     * An example mounted over a store of its own, where each source's narrowing is kept.
     *
     * @param example - The example
     * @param options - A program in its place, where its sessions are kept
     * @returns Its container, its store and its unmount
     */
    open(example: Example, options?: MountOptions): Promise<{ container: HTMLElement; store: UIStore; unmount: () => void }>;
}

/**
 * The Calendar's records on e3: the operations module's package deployed once
 * for the file, a workspace of its own for each test.
 *
 * @returns The harness
 */
export function calendarHarness(): CalendarHarness {
    const h = e3Harness({ "calendar/calendar": ex }, { main: "data-calendar-main" });
    return Object.assign(h, {
        async open(example: Example, options: MountOptions = {}) {
            const store = new UIStore(); StateRuntime.initializeStore(store);
            const mounted = await h.mount(example, { storageKey: "calendar-test", ...options });
            return { container: mounted.container, store, unmount: mounted.unmount };
        },
    });
}

export const event = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-event=${JSON.stringify(eventKey({ kind, key }))}]`)!;
export const card = (container: HTMLElement, kind: string, key: string) => container.querySelector<HTMLElement>(`[data-calendar-card=${JSON.stringify(eventKey({ kind, key }))}]`)!;

/**
 * Whether a request searched an index for a key or a range from it, by the
 * key's East text (`2026-10-01`, `"job1"`).
 *
 * @param request - The request
 * @param index - The index; the record's own keys when omitted
 * @param text - What the key's or the range's lower bound's text starts with
 * @returns Whether it did
 */
export function searched(request: E3Request, index: string | undefined, text: string): boolean {
    if (request.kind !== "find" || (request.query.get("index") ?? undefined) !== index) return false;
    const keys = [...request.query.getAll("key"), ...request.query.getAll("from")];
    return keys.some((key) => key.startsWith(text));
}

/**
 * A source's narrowing as the store keeps it.
 *
 * @param store - The example's store
 * @param example - The example's name (`calendarOperations`)
 * @param source - The source (`job`)
 * @returns Each field's choice
 */
export const narrowing = (store: UIStore, example: string, source: string): Where =>
    decodeBeast2For(RecordSliceStateType)(store.read(`ex.${example}.${source}`)!).where;
/**
 * A source's narrowing written whole, as the rail writes it.
 *
 * @param store - The example's store
 * @param example - The example's name
 * @param source - The source
 * @param where - Each field's choice
 */
export async function narrow(store: UIStore, example: string, source: string, where: Where) {
    const key = `ex.${example}.${source}`;
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}
