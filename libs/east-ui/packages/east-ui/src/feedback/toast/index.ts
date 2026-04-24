/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    NullType,
    FunctionType,
    StringType,
    IntegerType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    AlertStatusType,
    type AlertStatusLiteral,
} from "../alert/types.js";
import {
    ToastType,
    ToastActionType,
    ToastStyleType,
    buildToastAction,
    buildToastStyle,
    type ToastOptions,
    type ToastStatusLiteral,
} from "./types.js";

// Re-export types
export {
    ToastType,
    ToastStatusType,
    ToastActionType,
    ToastStyleType,
    type ToastStatusLiteral,
    type ToastStyle,
    type ToastOptions,
} from "./types.js";

// ============================================================================
// Toast Factory (IR value constructor)
// ============================================================================

/**
 * Creates a Toast value (IR). Combine with `Toast.emit(value)` to actually
 * show it; emitting requires the host to have mounted the `<Toaster />`
 * singleton and registered the `toast_emit` platform implementation.
 *
 * @param status - "info" / "warning" / "success" / "error" / "neutral"
 * @param title - Toast title
 * @param options - Optional description / actions / duration / style
 *
 * @example
 * ```ts
 * import { Toast } from "@elaraai/east-ui";
 *
 * $(Toast.emit(Toast.make("success", "Scenario saved", { duration: 4000n })));
 * ```
 */
function createToast(
    status: ToastStatusLiteral | SubtypeExprOrValue<AlertStatusType>,
    title: SubtypeExprOrValue<StringType>,
    options?: ToastOptions,
): ExprType<ToastType> {
    const statusValue = typeof status === "string"
        ? East.value(variant(status as AlertStatusLiteral, null), AlertStatusType)
        : status as ExprType<AlertStatusType>;

    const actionsValue = options?.actions && options.actions.length > 0
        ? options.actions.map(buildToastAction)
        : undefined;

    const styleValue = options?.style ? buildToastStyle(options.style) : undefined;

    return East.value({
        status: statusValue,
        title: title,
        description: options?.description !== undefined ? some(options.description) : none,
        actions: actionsValue ? some(actionsValue) : none,
        duration: options?.duration !== undefined ? some(options.duration) : none,
        style: styleValue ? some(styleValue) : none,
    }, ToastType);
}

// ============================================================================
// Toast.emit platform function
// ============================================================================

/**
 * Toast emit — async platform function that pushes a toast through the host's
 * `<Toaster />` singleton. The implementation is registered by
 * `@elaraai/east-ui-components` in `emitToastImpl`. Hosts must mount a
 * `<Toaster />` somewhere in their tree for toasts to be visible.
 *
 * @remarks
 * Returns `NullType` and does not block; fires and returns immediately.
 */
const toast_emit = East.platform("toast_emit", [ToastType], NullType, { optional: true });

/**
 * Toast primitive — side-effect feedback surface.
 *
 * @remarks
 * Toast is unique: it is not a rendered value. `Toast.make(...)` builds a
 * value; `Toast.emit(value)` is an async platform call that pushes the value
 * through the host's `<Toaster />` singleton.
 */
export const Toast = {
    /** Construct a Toast value. */
    make: createToast,
    /** Emit a Toast through the host's Toaster singleton. */
    emit: toast_emit,
    Types: {
        /** The concrete East type for Toast. */
        Toast: ToastType,
        /** Semantic status variant (shared with Alert / Banner). */
        Status: AlertStatusType,
        /** Action-button sub-struct. */
        Action: ToastActionType,
        /** Visual-only style struct. */
        Style: ToastStyleType,
    },
} as const;

// Unused markers (kept imports clean)
void FunctionType;
void IntegerType;
