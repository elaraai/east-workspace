/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Button JSX tag. Button's factory nests visual style under `options.style`,
 * so the flat JSX props are split: behaviour/state/content keys stay top-level
 * and the rest fold into `style`. The label is the tag's children — a string
 * (or interpolation), a dynamic string expression (wrapped in `Text.Root`), or
 * a single rich element (passed through as the `UIComponentType` label).
 */

import { Expr, type ExprType, type StringType } from "@elaraai/east";
import {
    Button as ButtonFactory,
    type ButtonOptions,
    type ButtonLabelInput,
} from "../../buttons/button/index.js";
import { Text as TextFactory } from "../../typography/text/index.js";
import { UIComponentType } from "../../component.js";
import { joinText, hasKeys, type TextChild } from "../combinators.js";
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
    Omit<ButtonOptions, "style"> & { children?: TextChild | UIElement };

/** `<Button>` — action button with flat style props. Maps to `Button.Root`. */
export function Button(props: ButtonProps): UIElement {
    const { children, ...rest } = props as { children?: TextChild | UIElement } &
        Record<string, unknown>;

    const options: Record<string, unknown> = {};
    const style: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
        if ((BUTTON_TOP_LEVEL as ReadonlySet<string>).has(key)) options[key] = rest[key];
        else style[key] = rest[key];
    }
    if (hasKeys(style)) options.style = style;

    // A single component child is the label; any other children are text
    // (Button.Root coerces a string to Text.Root; a string expression we wrap).
    const flat: unknown[] = [];
    const walk = (c: unknown): void => {
        if (c === null || c === undefined) return;
        if (Array.isArray(c)) {
            for (const x of c) walk(x);
            return;
        }
        flat.push(c);
    };
    walk(children);

    let label: ButtonLabelInput;
    if (
        flat.length === 1 &&
        flat[0] instanceof Expr &&
        (Expr.type(flat[0]) as { type?: string }).type === "Recursive"
    ) {
        label = flat[0] as ExprType<UIComponentType>;
    } else {
        const joined = joinText(children as TextChild);
        label = typeof joined === "string"
            ? joined
            : TextFactory.Root(joined as ExprType<StringType>);
    }

    return ButtonFactory.Root(
        label,
        (hasKeys(options) ? options : undefined) as ButtonOptions | undefined,
    );
}
