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
    /**
     * Constructs a Toast value.
     *
     * @param status - Semantic classification driving default palette + icon
     * @param title - Toast title text
     * @param options - Optional description / actions / duration / style
     * @returns An East expression of type `ToastType`
     *
     * @remarks
     * Construction is pure — use `Toast.emit(...)` inside a Reactive /
     * async platform context to push a built toast through the host's
     * `<Toaster />` singleton.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Toast } from "@elaraai/east-ui";
     *
     * const t = Toast.make("success", "Saved", { duration: 5000n });
     * ```
     */
    make: createToast,
    /**
     * Emits a Toast through the host's Toaster singleton.
     *
     * @param toastValue - Toast value produced by `Toast.make(...)`
     * @returns A platform call that resolves to null
     *
     * @remarks
     * The platform function is marked `optional: true`; call it from an
     * async / Reactive context so the containing function is promoted to
     * `AsyncFunction` cleanly.
     */
    emit: toast_emit,
    Types: {
        /**
         * East StructType for a Toast value — the serialisable IR used by
         * platform emit calls.
         *
         * @remarks
         * Rich title/description slots are inlined as `StringType` so the
         * IR can be serialised and re-hydrated across runtime boundaries.
         * Exposed on the namespace so hosts can reference the IR type via
         * `Toast.Types.Toast` without reaching into module internals.
         *
         * @property status - Semantic classification (shared with Alert / Banner)
         * @property title - Toast title text
         * @property description - Optional description line
         * @property actions - Optional action buttons (up to three)
         * @property duration - Duration in milliseconds (none ⇒ persistent)
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Toast: ToastType,
        /**
         * Semantic status classification for Toast — shared vocabulary with
         * Alert / Banner.
         *
         * @remarks
         * Drives default paired-icon injection and colour palette per §0.3.
         *
         * @property info - Informational / neutral notice
         * @property success - Confirmation of a successful action
         * @property warning - Non-blocking caution
         * @property error - Error / failure
         * @property neutral - Default / idle
         */
        Status: AlertStatusType,
        /**
         * East StructType for a Toast action button.
         *
         * @remarks
         * Each action carries a label, an onClick callback, and an optional
         * visual variant. Up to three actions per toast per §0.3.
         *
         * @property label - Button label text
         * @property onClick - Callback invoked when the button fires
         * @property variant - Optional button visual preset
         */
        Action: ToastActionType,
        /**
         * East StructType holding every visual field for a Toast.
         *
         * @remarks
         * Mirror of `ToastStyleType` from `./types.js`. Covers the four
         * colour slots (text, background, border, icon). Renderers apply
         * these alongside the default palette driven by `status`.
         *
         * @property color - Explicit text colour override
         * @property background - Explicit background colour override
         * @property borderColor - Explicit border colour override
         * @property iconColor - Explicit icon colour override
         */
        Style: ToastStyleType,
    },
} as const;

// Unused markers (kept imports clean)
void FunctionType;
void IntegerType;
