/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { CloseButton as ChakraCloseButton, type CloseButtonProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { CloseButton } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const closeButtonEqual = equalFor(CloseButton.Types.CloseButton);

export type CloseButtonValue = ValueTypeOf<typeof CloseButton.Types.CloseButton>;

/**
 * Props for `EastChakraCloseButton`. Accepts any extra Chakra `<CloseButton>`
 * props so containers like `<ButtonGroup>` can forward attributes injected
 * via `cloneElement` (`data-first` / `data-last` / `data-between`).
 */
export type EastChakraCloseButtonProps = {
    value: CloseButtonValue;
} & Omit<CloseButtonProps, "onClick" | "children" | "aria-label" | "value">;

/**
 * Renders an East UI CloseButton using Chakra v3's `<CloseButton>`.
 *
 * @remarks
 * `aria-label` defaults to `"Close"` when `value.label` is absent. State +
 * behaviour come from main; visual presentation comes from `value.style`.
 */
export const EastChakraCloseButton = memo(function EastChakraCloseButton({ value, ...rest }: EastChakraCloseButtonProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const disabled = useMemo(() => getSomeorUndefined(value.disabled), [value.disabled]);

    const onClickFn = useMemo(() => getSomeorUndefined(value.onClick), [value.onClick]);
    const handleClick = useCallback(() => {
        if (onClickFn) queueMicrotask(() => onClickFn());
    }, [onClickFn]);

    const props = useMemo(() => {
        const out: Record<string, unknown> = { "aria-label": label ?? "Close" };
        if (disabled !== undefined) out.disabled = disabled;
        if (style) {
            const v = getSomeorUndefined(style.variant)?.type;
            const sz = getSomeorUndefined(style.size)?.type;
            const c = getSomeorUndefined(style.color);
            const bg = getSomeorUndefined(style.background);
            const bc = getSomeorUndefined(style.borderColor);
            const hover = getSomeorUndefined(style.hoverBackground);
            if (v !== undefined) out.variant = v;
            if (sz !== undefined) out.size = sz;
            if (c !== undefined) out.color = c;
            if (bg !== undefined) out.bg = bg;
            if (bc !== undefined) out.borderColor = bc;
            if (hover !== undefined) out._hover = { bg: hover };
        }
        return out as CloseButtonProps;
    }, [style, disabled, label]);

    return <ChakraCloseButton {...rest} {...props} onClick={onClickFn ? handleClick : undefined} />;
}, (prev, next) => closeButtonEqual(prev.value, next.value));
