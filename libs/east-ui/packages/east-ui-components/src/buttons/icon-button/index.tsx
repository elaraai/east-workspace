/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { IconButton as ChakraIconButton, type IconButtonProps } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { IconButton, Icon } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

library.add(fas, far, fab);

const iconButtonEqual = equalFor(IconButton.Types.IconButton);

/** East IconButton value type — label required on main; state + behaviour on main. */
export type IconButtonValue = ValueTypeOf<typeof IconButton.Types.IconButton>;

type IconValue = ValueTypeOf<typeof Icon.Types.Icon>;

interface ChakraVisualProps {
    variant?: IconButtonProps["variant"] | undefined;
    colorPalette?: IconButtonProps["colorPalette"] | undefined;
    size?: IconButtonProps["size"] | undefined;
    color?: string | undefined;
    bg?: string | undefined;
    borderColor?: string | undefined;
    hoverBackground?: string | undefined;
}

/**
 * Derive visual Chakra props from the `style` sub-struct. State
 * (`loading` / `disabled`) and behaviour (`onClick`) are read from main.
 */
export function toChakraIconButton(value: IconButtonValue): ChakraVisualProps {
    const style = getSomeorUndefined(value.style);
    if (!style) return {};
    return {
        variant: getSomeorUndefined(style.variant)?.type as IconButtonProps["variant"] | undefined,
        colorPalette: getSomeorUndefined(style.colorPalette)?.type as IconButtonProps["colorPalette"] | undefined,
        size: getSomeorUndefined(style.size)?.type as IconButtonProps["size"] | undefined,
        color: getSomeorUndefined(style.color),
        bg: getSomeorUndefined(style.background),
        borderColor: getSomeorUndefined(style.borderColor),
        hoverBackground: getSomeorUndefined(style.hoverBackground),
    };
}

/**
 * Props for `EastChakraIconButton`. Accepts any extra Chakra `<IconButton>`
 * props so containers like `<ButtonGroup>` can forward attributes injected
 * via `cloneElement` (notably `data-first` / `data-last` / `data-between`).
 */
export type EastChakraIconButtonProps = {
    value: IconButtonValue;
} & Omit<IconButtonProps, "onClick" | "children" | "aria-label" | "value">;

/**
 * Renders an East UI IconButton. `value.label` becomes `aria-label` on the
 * rendered button (required by §0.2). When `loading` is true and a
 * `loadingIcon` is present, the renderer swaps in the spinner icon instead
 * of the main one.
 */
export const EastChakraIconButton = memo(function EastChakraIconButton({ value, ...rest }: EastChakraIconButtonProps) {
    const visual = useMemo(() => toChakraIconButton(value), [value]);

    const loading = getSomeorUndefined(value.loading);
    const disabled = getSomeorUndefined(value.disabled);
    const loadingIcon = getSomeorUndefined(value.loadingIcon) as IconValue | undefined;

    const onClickFn = useMemo(() => getSomeorUndefined(value.onClick), [value.onClick]);
    const handleClick = useCallback(() => {
        if (onClickFn) queueMicrotask(() => onClickFn());
    }, [onClickFn]);

    const hoverCss = visual.hoverBackground
        ? { _hover: { bg: visual.hoverBackground } }
        : {};

    const activePrefix = loading && loadingIcon ? loadingIcon.prefix : value.prefix;
    const activeName = loading && loadingIcon ? loadingIcon.name : value.name;

    return (
        <ChakraIconButton
            {...rest}
            variant={visual.variant}
            colorPalette={visual.colorPalette}
            size={visual.size}
            color={visual.color}
            bg={visual.bg}
            borderColor={visual.borderColor}
            loading={loading}
            disabled={disabled}
            aria-label={value.label}
            onClick={onClickFn ? handleClick : undefined}
            {...hoverCss}
        >
            <FontAwesomeIcon icon={[activePrefix as IconPrefix, activeName as IconName]} />
        </ChakraIconButton>
    );
}, (prev, next) => iconButtonEqual(prev.value, next.value));
