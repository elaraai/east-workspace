/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `Pick` namespace — choosing which of a component's declared things show.
 *
 * @remarks
 * Assembled HERE rather than beside the contract, for the same reason `Slice`
 * is: `Pick.Panel` needs `UIComponentType`, and `component.ts` imports the
 * contract. Splitting the namespace from the vocabulary is what keeps
 * `contracts/pick.ts` importable by `component.ts` with no cycle.
 *
 * @packageDocumentation
 */

import {
    createPickState,
    createPickBind,
    pickActive,
    pickVisible,
    pickItems,
    PickStateType,
    PickItemType,
    PickStateHandleType,
    PickBindType,
    PickPanelType,
    PickHandleType,
} from "../contracts/pick.js";
import { createPickPanel } from "./panel/index.js";

export { type PickPanelOptions, createPickPanel } from "./panel/index.js";

/**
 * The `Pick` namespace.
 *
 * @remarks
 * Bind a list with {@link Pick.bind}, feed the survivors to the component with
 * {@link Pick.active}, and render the library with {@link Pick.Panel}. The
 * handle is what decouples them: the panel never imports the component, and the
 * component never learns a panel exists.
 *
 * @example
 * ```tsx
 * const shown = $.let(Pick.bind("ops.series", all, { id: s => s.key, title: s => s.name }));
 * <Pick.Panel value={shown} title="Series" />
 * <Plan axis={axis} data={ops} series={Pick.active(shown)} />
 * ```
 */
export const Pick = {
    /** Build a state seed — the ids switched off. */
    state: createPickState,
    /** Bind a list of things to a persisted pick. */
    bind: createPickBind,
    /** The items still switched on, in declaration order. */
    active: pickActive,
    /** The derivation alone — items minus a hidden list, no state binding. */
    visible: pickVisible,
    /** The library entries alone — described, with no state binding. */
    items: pickItems,
    /** The library panel — one row per thing, with an eye. */
    Panel: createPickPanel,
    /** East types — the contract, for `$.const` / `$.let` annotations. */
    Types: {
        /** The ids switched off (an empty list shows everything). */
        State: PickStateType,
        /** One pickable thing as the panel sees it. */
        Item: PickItemType,
        /** The state binding — `State.bind`'s shape at {@link PickStateType}. */
        StateHandle: PickStateHandleType,
        /** The non-generic contract a component's IR holds. */
        Bind: PickBindType,
        /** The `Pick.Panel` component payload. */
        Panel: PickPanelType,
        /** The author's handle, at an item type. */
        Handle: PickHandleType,
    },
} as const;
