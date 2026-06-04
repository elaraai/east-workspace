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
} from "../buttons/index.js";
import { Text as TextFactory } from "../typography/text/index.js";
import { joinText, hasKeys, type TextChild } from "./combinators.js";
import type { UIElement } from "./runtime.js";

// Keys that stay top-level on `options`; everything else folds into `style`.
const BUTTON_TOP_LEVEL: ReadonlySet<string> = new Set([
    "startIcon",
    "endIcon",
    "loadingText",
    "loadingIcon",
    "loading",
    "disabled",
    "onClick",
]);

/** Visual-style props accepted flat on `<Button>` (the nested `style` bag). */
export type ButtonStyleProps = NonNullable<ButtonOptions["style"]>;

/** Props for the `<Button>` tag: flat style + top-level options + label child. */
export type ButtonProps = ButtonStyleProps &
    Omit<ButtonOptions, "style"> & { children?: TextChild };

function isExpr(x: unknown): x is Expr {
    return x instanceof Expr;
}

/** `<Button>` — action button with flat style props. Maps to `Button.Root`. */
export function Button(props: ButtonProps): UIElement {
    const { children, ...rest } = props as { children?: TextChild } &
        Record<string, unknown>;

    const options: Record<string, unknown> = {};
    const style: Record<string, unknown> = {};
    for (const key of Object.keys(rest)) {
        if (BUTTON_TOP_LEVEL.has(key)) options[key] = rest[key];
        else style[key] = rest[key];
    }
    if (hasKeys(style)) options.style = style;

    const joined: unknown = joinText(children);
    let label: ButtonLabelInput;
    if (typeof joined === "string") {
        label = joined;
    } else if (isExpr(joined) && (Expr.type(joined) as { type?: string }).type === "String") {
        label = TextFactory.Root(joined as ExprType<StringType>);
    } else {
        label = joined as ButtonLabelInput;
    }

    return ButtonFactory.Root(
        label,
        (hasKeys(options) ? options : undefined) as ButtonOptions | undefined,
    );
}
