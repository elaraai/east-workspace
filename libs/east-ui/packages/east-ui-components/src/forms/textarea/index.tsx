/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState } from "react";
import { Textarea as ChakraTextarea, type TextareaProps } from "@chakra-ui/react";
import { equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Textarea } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useValueSync } from "../../hooks/useValueSync";
import { useGrowWithText } from "../../primitives/grow-with-text.js";

// Pre-define equality function at module level
const textareaEqual = equivalentFor(Textarea.Types.Textarea);
const textareaDataEqual = equalFor(Textarea.Types.Textarea);

/** East Textarea value type */
export type TextareaValue = ValueTypeOf<typeof Textarea.Types.Textarea>;

/**
 * Converts an East UI Textarea value to Chakra UI Textarea props.
 * Pure function - easy to test independently.
 */
export function toChakraTextarea(value: TextareaValue): TextareaProps {
    const rows = getSomeorUndefined(value.rows);
    const maxLength = getSomeorUndefined(value.maxLength);
    const style = getSomeorUndefined(value.style);
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const resizeTag = style ? getSomeorUndefined(style.resize)?.type : undefined;
    const colour = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const focusBorderColor = style ? getSomeorUndefined(style.focusBorderColor) : undefined;

    return {
        value: value.value,
        placeholder: getSomeorUndefined(value.placeholder),
        variant: variantTag,
        size: sizeTag,
        resize: resizeTag,
        rows: rows !== undefined ? Number(rows) : undefined,
        disabled: getSomeorUndefined(value.disabled),
        readOnly: getSomeorUndefined(value.readOnly),
        required: getSomeorUndefined(value.required),
        ...(getSomeorUndefined(value.invalid) ? { "aria-invalid": true } : {}),
        maxLength: maxLength !== undefined ? Number(maxLength) : undefined,
        autoresize: getSomeorUndefined(value.autoresize),
        color: colour,
        bg: background,
        borderColor,
        ...(focusBorderColor ? { _focus: { borderColor: focusBorderColor, boxShadow: `0 0 0 1px ${focusBorderColor}` } } : {}),
    };
}

export interface EastChakraTextareaProps {
    value: TextareaValue;
}

/**
 * Renders an East UI Textarea value using Chakra UI Textarea component. One
 * that grows (`autoresize`) is as tall as its text, never under its rows and
 * never resized by hand, through the shared `useGrowWithText`
 * (east-workspace#1779) — never Ark's own `autoresize`, which takes the box's
 * value over and handed a value its host set back to its `onChange` as typing.
 */
export const EastChakraTextarea = memo(function EastChakraTextarea({ value }: EastChakraTextareaProps) {
    const [props, setProps] = useState(toChakraTextarea(value));
    const [box, setBox] = useState<HTMLTextAreaElement | null>(null);

    // Extract callbacks
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onBlurFn = useMemo(() => getSomeorUndefined(value.onBlur), [value.onBlur]);
    const onFocusFn = useMemo(() => getSomeorUndefined(value.onFocus), [value.onFocus]);

    useValueSync(value, textareaDataEqual, () => setProps(toChakraTextarea(value)));

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value;
        setProps(prev => ({ ...prev, value: next }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(next));
        }
    }, [onChangeFn]);

    const handleBlur = useCallback(() => {
        if (onBlurFn) {
            queueMicrotask(() => onBlurFn());
        }
    }, [onBlurFn]);

    const handleFocus = useCallback(() => {
        if (onFocusFn) {
            queueMicrotask(() => onFocusFn());
        }
    }, [onFocusFn]);

    // Grown here, its height alone set; Chakra's box given no `autoresize` of its own.
    const { autoresize, ...shown } = props;
    const grows = autoresize ?? false;
    useGrowWithText(box, props.value, grows);

    return (
        <ChakraTextarea
            {...shown}
            {...(grows && shown.resize === undefined && { resize: "none" })}
            ref={setBox}
            onChange={handleChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
        />
    );
}, (prev, next) => textareaEqual(prev.value, next.value));
