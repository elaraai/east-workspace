/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Button as ChakraButton, type ButtonProps, Box as ChakraBox } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Button, Icon } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const buttonEqual = equalFor(Button.Types.Button);

/** East Button value type — rich label + icon slots + main-level state/behaviour. */
export type ButtonValue = ValueTypeOf<typeof Button.Types.Button>;

type IconValue = ValueTypeOf<typeof Icon.Types.Icon>;

interface ChakraVisualProps {
    variant?: ButtonProps["variant"] | undefined;
    colorPalette?: ButtonProps["colorPalette"] | undefined;
    size?: ButtonProps["size"] | undefined;
    color?: string | undefined;
    bg?: string | undefined;
    borderColor?: string | undefined;
    hoverBackground?: string | undefined;
}

/**
 * Derive the visual Chakra props from the `style` sub-struct.
 * State (`loading` / `disabled`) is read from main elsewhere.
 */
export function toChakraButton(value: ButtonValue): ChakraVisualProps {
    const style = getSomeorUndefined(value.style);
    if (!style) return {};
    return {
        variant: getSomeorUndefined(style.variant)?.type as ButtonProps["variant"] | undefined,
        colorPalette: getSomeorUndefined(style.colorPalette)?.type as ButtonProps["colorPalette"] | undefined,
        size: getSomeorUndefined(style.size)?.type as ButtonProps["size"] | undefined,
        color: getSomeorUndefined(style.color),
        bg: getSomeorUndefined(style.background),
        borderColor: getSomeorUndefined(style.borderColor),
        hoverBackground: getSomeorUndefined(style.hoverBackground),
    };
}

/**
 * Props for `EastChakraButton`.
 *
 * @remarks
 * Accepts any extra Chakra `<Button>` props alongside `value` + `storageKey`
 * so containers can forward attributes injected via `cloneElement` —
 * notably `<ButtonGroup>` relies on this so Chakra's `<Group attached>`
 * can add `data-first` / `data-last` / `data-between` / `data-group-item`
 * + inline `style` vars to the rendered DOM `<button>`.
 */
export type EastChakraButtonProps = {
    value: ButtonValue;
    storageKey?: string;
} & Omit<ButtonProps, "onClick" | "children" | "value">;

/**
 * Renders an East UI Button. Label is a UIComponentType (dispatched through
 * `EastChakraComponent`). Icon slots (`startIcon` / `endIcon`) render before
 * / after the label. When `loading` is true the renderer prefers
 * `loadingText` over the label and swaps in `loadingIcon` if provided.
 */
export const EastChakraButton = memo(function EastChakraButton({ value, storageKey, ...rest }: EastChakraButtonProps) {
    const visual = useMemo(() => toChakraButton(value), [value]);

    const loading = getSomeorUndefined(value.loading);
    const disabled = getSomeorUndefined(value.disabled);
    const loadingText = getSomeorUndefined(value.loadingText);
    const startIcon = getSomeorUndefined(value.startIcon) as IconValue | undefined;
    const endIcon = getSomeorUndefined(value.endIcon) as IconValue | undefined;
    const loadingIcon = getSomeorUndefined(value.loadingIcon) as IconValue | undefined;

    const onClickFn = useMemo(() => getSomeorUndefined(value.onClick), [value.onClick]);
    const handleClick = useCallback(() => {
        if (onClickFn) queueMicrotask(() => onClickFn());
    }, [onClickFn]);

    const hoverCss = visual.hoverBackground
        ? { _hover: { bg: visual.hoverBackground } }
        : {};

    const showLoadingContent = loading === true;
    const effectiveStartIcon = showLoadingContent && loadingIcon ? loadingIcon : startIcon;

    return (
        <ChakraButton
            {...rest}
            variant={visual.variant}
            colorPalette={visual.colorPalette}
            size={visual.size}
            color={visual.color}
            bg={visual.bg}
            borderColor={visual.borderColor}
            loading={loading}
            disabled={disabled}
            onClick={onClickFn ? handleClick : undefined}
            {...hoverCss}
        >
            {effectiveStartIcon && (
                <ChakraBox as="span" display="inline-flex" alignItems="center">
                    <FontAwesomeIcon
                        icon={[effectiveStartIcon.prefix as IconPrefix, effectiveStartIcon.name as IconName]}
                    />
                </ChakraBox>
            )}
            {showLoadingContent && loadingText !== undefined
                ? loadingText
                : <EastChakraComponent value={value.label} storageKey={`${storageKey ?? ""}.label`} />
            }
            {endIcon && (
                <ChakraBox as="span" display="inline-flex" alignItems="center">
                    <FontAwesomeIcon icon={[endIcon.prefix as IconPrefix, endIcon.name as IconName]} />
                </ChakraBox>
            )}
        </ChakraButton>
    );
}, (prev, next) => buttonEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
