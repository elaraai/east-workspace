/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Button, HStack, Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { EditableChip } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const editableChipEqual = equalFor(EditableChip.Types.EditableChip);

/** East EditableChip value type. */
export type EditableChipValue = ValueTypeOf<typeof EditableChip.Types.EditableChip>;

const SIZE_MAP: Record<string, "xs" | "sm" | "md" | "lg"> = {
    xs: "xs",
    sm: "sm",
    md: "md",
    lg: "lg",
};

export interface EastChakraEditableChipProps {
    value: EditableChipValue;
    storageKey: string;
}

/**
 * Renders an East UI EditableChip using Chakra v3 `Button` with a
 * `variant="subtle"` visual and a trailing chevron icon.
 *
 * @remarks
 * When `value.trigger` is absent, renderer defaults to `faChevronDown`.
 * Callbacks use the east-ui controlled-component pattern: onClick
 * scheduled via `queueMicrotask` so the Reactive cycle doesn't double-
 * fire under StrictMode.
 */
export const EastChakraEditableChip = memo(function EastChakraEditableChip({ value, storageKey }: EastChakraEditableChipProps) {
    const trigger = useMemo(() => getSomeorUndefined(value.trigger), [value.trigger]);
    const disabled = useMemo(() => getSomeorUndefined(value.disabled), [value.disabled]);
    const onClickFn = useMemo(() => getSomeorUndefined(value.onClick), [value.onClick]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const handleClick = useCallback(() => {
        if (onClickFn) {
            queueMicrotask(() => onClickFn());
        }
    }, [onClickFn]);

    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "sm" : "sm";
    const size = SIZE_MAP[sizeTag] ?? "sm";
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const triggerIconColor = style ? getSomeorUndefined(style.triggerIconColor) : undefined;

    const triggerIcon = trigger
        ? [trigger.prefix as IconPrefix, trigger.name as IconName] as [IconPrefix, IconName]
        : faChevronDown;

    return (
        <Button
            variant="subtle"
            size={size}
            disabled={disabled}
            onClick={onClickFn ? handleClick : undefined}
            color={color}
            background={background}
            borderColor={borderColor}
            borderWidth={borderColor ? "1px" : undefined}
        >
            <HStack gap="1.5" align="center">
                <EastChakraComponent value={value.label} storageKey={`${storageKey}.label`} />
                <Box color={triggerIconColor ?? "fg.muted"}>
                    <FontAwesomeIcon icon={triggerIcon} aria-hidden />
                </Box>
            </HStack>
        </Button>
    );
}, (prev, next) => editableChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
