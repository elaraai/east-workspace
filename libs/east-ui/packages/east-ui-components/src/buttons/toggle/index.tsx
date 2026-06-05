/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect } from "react";
import { Button as ChakraButton, type ButtonProps, Box as ChakraBox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Toggle, Icon } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const toggleEqual = equalFor(Toggle.Types.Toggle);

export type ToggleValue = ValueTypeOf<typeof Toggle.Types.Toggle>;

type IconValue = ValueTypeOf<typeof Icon.Types.Icon>;

/**
 * Props for `EastChakraToggle`. Accepts any extra Chakra `<Button>` props
 * so containers like `<ButtonGroup>` can forward attributes injected via
 * `cloneElement` (`data-first` / `data-last` / `data-between`).
 */
export type EastChakraToggleProps = {
    value: ToggleValue;
    storageKey?: string;
} & Omit<ButtonProps, "onClick" | "children" | "value" | "aria-pressed">;

/**
 * Renders an East UI Toggle as a Chakra `<Button>` with `aria-pressed` +
 * `data-pressed`. On click the renderer invokes `onChange(!pressed)` —
 * callers own the state via `State.bind` inside `Reactive.Root`.
 */
export const EastChakraToggle = memo(function EastChakraToggle({ value, storageKey, ...rest }: EastChakraToggleProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const disabled = getSomeorUndefined(value.disabled);
    const icon = getSomeorUndefined(value.icon) as IconValue | undefined;

    const [pressed, setPressed] = useState<boolean>(value.pressed);
    useEffect(() => { setPressed(value.pressed); }, [value.pressed]);

    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const handleClick = useCallback(() => {
        const next = !pressed;
        setPressed(next);
        if (onChangeFn) queueMicrotask(() => onChangeFn(next));
    }, [onChangeFn, pressed]);

    const buttonProps = useMemo(() => {
        const out: Record<string, unknown> = {};
        if (style) {
            const v = getSomeorUndefined(style.variant)?.type;
            const sz = getSomeorUndefined(style.size)?.type;
            if (v !== undefined) out.variant = v;
            if (sz !== undefined) out.size = sz;
        }
        const unpressedBg = style ? getSomeorUndefined(style.background) : undefined;
        const unpressedColor = style ? getSomeorUndefined(style.color) : undefined;
        const pressedBg = style ? getSomeorUndefined(style.pressedBackground) : undefined;
        const pressedColor = style ? getSomeorUndefined(style.pressedColor) : undefined;
        const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;

        const activeBg = pressed ? (pressedBg ?? unpressedBg) : unpressedBg;
        const activeColor = pressed ? (pressedColor ?? unpressedColor) : unpressedColor;

        if (activeBg !== undefined) out.bg = activeBg;
        if (activeColor !== undefined) out.color = activeColor;
        if (borderColor !== undefined) out.borderColor = borderColor;
        if (disabled !== undefined) out.disabled = disabled;
        return out as ButtonProps;
    }, [style, pressed, disabled]);

    return (
        <ChakraButton
            {...rest}
            {...buttonProps}
            aria-pressed={pressed}
            data-pressed={pressed || undefined}
            onClick={handleClick}
        >
            {icon && (
                <ChakraBox as="span" display="inline-flex" alignItems="center">
                    <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} />
                </ChakraBox>
            )}
            <EastChakraComponent value={value.label} storageKey={`${storageKey ?? ""}.label`} />
        </ChakraButton>
    );
}, (prev, next) => toggleEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
