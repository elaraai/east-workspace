/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Box, Button, HStack } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen } from "@fortawesome/free-solid-svg-icons";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { EditableChip } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const editableChipEqual = equalFor(EditableChip.Types.EditableChip);

/** East EditableChip value type. */
export type EditableChipValue = ValueTypeOf<typeof EditableChip.Types.EditableChip>;

const SIZE_PADDING: Record<string, { px: string; py: string; fontSize: string }> = {
    xs: { px: "1.5", py: "0", fontSize: "xs" },
    sm: { px: "2", py: "0.5", fontSize: "sm" },
    md: { px: "2.5", py: "1", fontSize: "sm" },
    lg: { px: "3", py: "1.5", fontSize: "md" },
    xl: { px: "3.5", py: "2", fontSize: "md" },
};

export interface EastChakraEditableChipProps {
    value: EditableChipValue;
    storageKey: string;
}

/**
 * Renders an East UI EditableChip as a chip-sized clickable `<Box>`
 * matching MetricChip proportions — NOT a Chakra Button.
 *
 * @remarks
 * The default trailing icon is `faPen` (pencil) to signal "editable"
 * without looking like a Select (which uses chevron-down). Consumers
 * can override via `value.trigger` (e.g. calendar icon for a date
 * chip, location pin for a location picker, etc.).
 *
 * Semantics — EditableChip is the **trigger** for a consumer-provided
 * picker / popover / dialog. The `onClick` callback is what the
 * pattern-layer (ContextSelector / AssumptionsBar) hooks into to open
 * the actual picker UI. The chip itself just shows the current label +
 * an "editable" affordance.
 *
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
        if (onClickFn && !disabled) {
            queueMicrotask(() => onClickFn());
        }
    }, [onClickFn, disabled]);

    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "sm" : "sm";
    const sizeProps = SIZE_PADDING[sizeTag] ?? SIZE_PADDING["sm"]!;
    const borderRadius = (style && getSomeorUndefined(style.borderRadius)) ?? "md";
    const color = (style && getSomeorUndefined(style.color)) ?? "fg";
    const background = (style && getSomeorUndefined(style.background)) ?? "gray.100";
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const triggerIconColor = (style && getSomeorUndefined(style.triggerIconColor)) ?? "fg.muted";

    const triggerIcon = trigger
        ? [trigger.prefix as IconPrefix, trigger.name as IconName] as [IconPrefix, IconName]
        : faPen;

    const interactive = !!onClickFn && !disabled;

    const chipBody = (
        <HStack gap="1.5" align="center">
            <EastChakraComponent value={value.label} storageKey={`${storageKey}.label`} />
            <Box color={triggerIconColor} fontSize="xs">
                <FontAwesomeIcon icon={triggerIcon} aria-hidden />
            </Box>
        </HStack>
    );

    if (!interactive) {
        return (
            <Box
                display="inline-flex"
                alignItems="center"
                borderRadius={borderRadius}
                borderWidth={borderColor ? "1px" : "0"}
                borderStyle="solid"
                borderColor={borderColor}
                bg={background}
                color={color}
                px={sizeProps.px}
                py={sizeProps.py}
                fontSize={sizeProps.fontSize}
                fontWeight="medium"
                cursor={disabled ? "not-allowed" : undefined}
                opacity={disabled ? 0.5 : undefined}
            >
                {chipBody}
            </Box>
        );
    }

    return (
        <Button
            unstyled
            display="inline-flex"
            alignItems="center"
            borderRadius={borderRadius}
            borderWidth={borderColor ? "1px" : "0"}
            borderStyle="solid"
            borderColor={borderColor}
            bg={background}
            color={color}
            px={sizeProps.px}
            py={sizeProps.py}
            fontSize={sizeProps.fontSize}
            fontWeight="medium"
            cursor="pointer"
            _hover={{ bg: "gray.200" }}
            _active={{ bg: "gray.300" }}
            onClick={handleClick}
        >
            {chipBody}
        </Button>
    );
}, (prev, next) => editableChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
