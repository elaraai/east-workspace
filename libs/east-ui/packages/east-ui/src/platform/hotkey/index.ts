/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    NullType,
    FunctionType,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { HotkeyType } from "./types.js";

export { HotkeyType } from "./types.js";

// ============================================================================
// Hotkey Factory
// ============================================================================

/**
 * Creates a `Hotkey` — invisible keydown listener bound for the
 * mount lifetime of the component.
 *
 * @param chord - Keyboard chord string
 * @param onTrigger - Callback fired when the chord is pressed
 * @returns An East expression representing the Hotkey component
 *
 * @example
 * ```ts
 * import { East, BooleanType, NullType } from "@elaraai/east";
 * import { CommandPalette, Hotkey, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, (_$) => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const openBind = $.let(State.bind([BooleanType], "cmdk.open", false));
 *         const open = $.let(openBind.read(), BooleanType);
 *         const trigger = $.const(East.function([], NullType, ($) => {
 *             $(openBind.write(true));
 *         }));
 *         const onOpenChange = $.const(East.function([BooleanType], NullType, ($, next) => {
 *             $(openBind.write(next));
 *         }));
 *         return Stack.VStack([
 *             Hotkey.Root("mod+k", trigger),
 *             CommandPalette.Root(
 *                 [{ id: "x", label: "Example", action: trigger }],
 *                 { open, onOpenChange },
 *             ),
 *         ]);
 *     }));
 * });
 * ```
 */
function createHotkey(
    chord: SubtypeExprOrValue<StringType>,
    onTrigger: SubtypeExprOrValue<FunctionType<[], NullType>>,
): ExprType<UIComponentType> {
    return East.value(variant("Hotkey", {
        chord,
        onTrigger,
    }), UIComponentType);
}

interface HotkeyNamespace {
    Root: typeof createHotkey;
    Types: {
        Hotkey: typeof HotkeyType;
    };
}

/**
 * `Hotkey` namespace — invisible keyboard-chord listener primitive.
 *
 * @remarks
 * Use `Hotkey.Root(chord, onTrigger)` to bind. Mount lifecycle owns
 * the listener registration. Compose with `Reactive.Root` +
 * `State.bind` to drive controlled-open state on overlays like
 * `CommandPalette`, `Dialog`, `Drawer`.
 */
export const Hotkey: HotkeyNamespace = {
    /**
     * Creates a `Hotkey` binding. See {@link createHotkey}.
     */
    Root: createHotkey,
    Types: {
        /**
         * East StructType for the `Hotkey` value.
         *
         * @property chord - Keyboard chord string (e.g. `"mod+k"`)
         * @property onTrigger - Callback fired when the chord is pressed
         */
        Hotkey: HotkeyType,
    },
};
