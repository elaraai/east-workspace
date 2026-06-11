/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    StringType,
    NullType,
    FunctionType,
    StructType,
} from "@elaraai/east";

// ============================================================================
// Hotkey Type
// ============================================================================

/**
 * East StructType for `Hotkey` — invisible primitive binding a
 * keyboard chord to a callback for the duration of its mount
 * lifetime.
 *
 * @remarks
 * The `chord` string supports the following modifier tokens (case
 * insensitive): `mod` (⌘ on macOS, Ctrl elsewhere), `ctrl`, `cmd`,
 * `shift`, `alt` / `option`. Tokens are joined with `+`, with the
 * non-modifier key last — e.g. `"mod+k"`, `"shift+ctrl+f"`,
 * `"esc"`.
 *
 * Each `Hotkey` instance binds independently while mounted.
 * Multi-instance scope is the author's choice — share a `State.bind`
 * key across regions to share state, or use distinct keys to keep
 * them separate.
 *
 * Lives in `types.ts` (a leaf with no `component.ts` import) so
 * `component.ts` can reference it without a circular dependency.
 *
 * @property chord - Keyboard chord string (e.g. `"mod+k"`)
 * @property onTrigger - Callback fired when the chord is pressed
 */
export const HotkeyType = StructType({
    chord: StringType,
    onTrigger: FunctionType([], NullType),
});

/**
 * Type alias for the Hotkey struct.
 */
export type HotkeyType = typeof HotkeyType;
