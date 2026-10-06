/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Pick.Panel` — the component half of the pick contract (#590).
 *
 * The factory lives here rather than beside the contract in `contracts/pick.ts`
 * for the reason every component factory does: it needs `UIComponentType`, and
 * `component.ts` imports the contract. Keeping the contract free of the
 * component type is what lets the arm reference `PickPanelType` by name instead
 * of hand-syncing an inline copy.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    StructType,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { PickBindType, type PickHandle } from "../../contracts/pick.js";

/** Options for `Pick.Panel`. */
export interface PickPanelOptions<I extends EastType> {
    /** The handle from `Pick.bind`. */
    value: PickHandle<I>;
    /**
     * The author's noun for what is being picked — `"Series"` / `"Columns"` /
     * `"Layers"`. Required, because the contract holds identified things and
     * genuinely cannot know what they are.
     */
    title: SubtypeExprOrValue<StringType>;
}

/**
 * Creates a `Pick.Panel` — the library of a component's declared things, one
 * row each, with an eye to switch it off.
 *
 * @remarks
 * Only the handle's non-generic `pick` field is stored. That projection is the
 * whole mechanism: the item type stops here, so a single `UIComponentType` arm
 * serves every adopter and the panel mounts anywhere — beside the component, in
 * a `Drawer`, behind a toolbar chip — without importing it.
 *
 * Mount it inside the SAME `Reactive.Root` that binds the handle and renders the
 * component. A reactive body is a free function and cannot capture a `$.let`
 * handle from an enclosing scope, so a panel that is its own root would have to
 * re-bind with its own copy of the item list.
 *
 * @typeParam I - The item type being picked over
 * @param options - The handle and the author's noun ({@link PickPanelOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * <Reactive>{$ => {
 *     const all = $.const(LIBRARY, ArrayType(ITEM));
 *     const shown = $.let(Pick.bind("ops.series", all, { id: x => x.key, title: x => x.name }));
 *     return (
 *         <HStack gap="4" align="start">
 *             <Pick.Panel value={shown} title="Series" />
 *             <Plan axis={axis} data={ops} series={Pick.active(shown)} />
 *         </HStack>
 *     );
 * }}</Reactive>
 * ```
 */
export function createPickPanel<I extends EastType>(
    options: PickPanelOptions<I>,
): ExprType<UIComponentType> {
    const handle = options.value as unknown as ExprType<StructType<{ pick: PickBindType }>>;
    // Pin the exact East type so the arm's field unifies — the handle's TS face
    // is erased through `I` (the `Schematic` `itemHover` / `Plan` resolver idiom).
    return East.value(variant("PickPanel", {
        pick:  East.value(handle.pick, PickBindType),
        title: options.title,
    }), UIComponentType);
}
