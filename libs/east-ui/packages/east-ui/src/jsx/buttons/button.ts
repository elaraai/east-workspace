/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button JSX tag. Button's factory nests visual style under `options.style`,
 * so the flat JSX props are split: behaviour/state/content keys stay top-level
 * and the rest fold into `style`. The label is the tag's children, typed as the
 * factory's own `ButtonLabelInput` and forwarded verbatim — the factory coerces
 * a string to `Text.Root` and takes any `UIComponentType` as a rich label.
 */

import {
    Button as ButtonFactory,
    type ButtonOptions,
    type ButtonLabelInput,
} from "../../buttons/button/index.js";
import { hasKeys } from "../combinators.js";
import type { UIElement } from "../runtime.js";

// Keys that stay top-level on `options`; everything else folds into `style`.
// Typed against ButtonOptions so a renamed/removed option key fails the build.
const BUTTON_TOP_LEVEL: ReadonlySet<keyof Omit<ButtonOptions, "style">> = new Set([
    "startIcon",
    "endIcon",
    "loadingText",
    "loadingIcon",
    "loading",
    "disabled",
    "onClick",
] as const);

/** Visual-style props accepted flat on `<Button>` (the nested `style` bag). */
export type ButtonStyleProps = NonNullable<ButtonOptions["style"]>;

/** Props for the `<Button>` tag: flat style + top-level options + label child. */
export type ButtonProps = ButtonStyleProps &
    Omit<ButtonOptions, "style"> & { children: ButtonLabelInput };

/** `<Button>` — action button with flat style props. Maps to `Button.Root`. */
export function Button(props: ButtonProps): UIElement {
    const { children, ...rest } = props as { children: ButtonLabelInput } &
        Record<string, unknown>;

    const options: Record<string, unknown> = {};
    const style: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
        if ((BUTTON_TOP_LEVEL as ReadonlySet<string>).has(key)) options[key] = rest[key];
        else style[key] = rest[key];
    }
    if (hasKeys(style)) options.style = style;

    return ButtonFactory.Root(
        children,
        (hasKeys(options) ? options : undefined) as ButtonOptions | undefined,
    );
}
