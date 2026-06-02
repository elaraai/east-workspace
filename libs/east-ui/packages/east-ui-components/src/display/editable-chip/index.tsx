/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
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

export interface EastChakraEditableChipProps {
    value: EditableChipValue;
    storageKey: string;
}

/**
 * Renders an East UI EditableChip — a chip-shaped trigger for a
 * consumer-provided picker / popover, styled through the `editableChip`
 * slot recipe.
 *
 * @remarks
 * The default trailing icon is `faPen` (pencil) to signal "editable"
 * without looking like a Select (which uses chevron-down). Consumers
 * override via `value.trigger`.
 *
 * The `onClick` callback is scheduled via `queueMicrotask` so the
 * Reactive cycle doesn't double-fire under StrictMode.
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

    const recipe = useSlotRecipe({ key: "editableChip" });
    const styles = recipe({ size: sizeTag });

    const rootCss = useMemo(() => {
        const borderRadius = style ? getSomeorUndefined(style.borderRadius) : undefined;
        const color = style ? getSomeorUndefined(style.color) : undefined;
        const background = style ? getSomeorUndefined(style.background) : undefined;
        const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
        return {
            ...styles.root,
            ...(borderRadius !== undefined ? { borderRadius } : {}),
            ...(color !== undefined ? { color } : {}),
            ...(background !== undefined ? { background } : {}),
            ...(borderColor !== undefined ? { borderColor } : {}),
        };
    }, [styles, style]);

    const triggerCss = useMemo(() => {
        const triggerIconColor = style ? getSomeorUndefined(style.triggerIconColor) : undefined;
        return { ...styles.trigger, ...(triggerIconColor !== undefined ? { color: triggerIconColor } : {}) };
    }, [styles, style]);

    const triggerIcon = trigger
        ? [trigger.prefix as IconPrefix, trigger.name as IconName] as [IconPrefix, IconName]
        : faPen;

    const interactive = !!onClickFn && !disabled;

    const chipBody = (
        <>
            <EastChakraComponent value={value.label} storageKey={`${storageKey}.label`} />
            <Box as="span" css={triggerCss}>
                <FontAwesomeIcon icon={triggerIcon} aria-hidden />
            </Box>
        </>
    );

    if (!interactive) {
        return (
            <Box css={rootCss} cursor={disabled ? "not-allowed" : "default"} opacity={disabled ? 0.5 : undefined}>
                {chipBody}
            </Box>
        );
    }

    return (
        <Button unstyled css={rootCss} onClick={handleClick}>
            {chipBody}
        </Button>
    );
}, (prev, next) => editableChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
