/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Clipboard platform — fire-and-forget text copy.
 *
 * `Clipboard.copy(text)` writes a string to the system clipboard. Backed by
 * `navigator.clipboard.writeText` in the browser; safe to call from any
 * East callback (`onClick`, `onChange`, etc.).
 *
 * @packageDocumentation
 */

import { East, StringType, NullType } from "@elaraai/east";

const clipboard_copy = East.platform(
    "clipboard_copy",
    [StringType],
    NullType,
    { optional: true },
);

/**
 * Clipboard platform calls.
 *
 * @example
 * ```ts
 * import { East, NullType, StringType } from "@elaraai/east";
 * import { Button, Clipboard, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, ($) => {
 *     const onClick = $.const(East.function([], NullType, ($) => {
 *         $(Clipboard.copy("hello world"));
 *     }));
 *     return Button.Root("Copy", { onClick });
 * });
 * ```
 */
export const Clipboard = {
    /**
     * Copy a string to the system clipboard.
     *
     * @param text - The string to copy
     * @returns A platform call returning `null`
     *
     * @remarks
     * Backed by `navigator.clipboard.writeText`. Fire-and-forget — failures
     * (e.g. permission-denied, non-secure context) are logged and swallowed
     * so callers do not need to handle rejection.
     */
    copy: clipboard_copy,
} as const;
