/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback } from "react";
import { Tag as ChakraTag, type TagRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Tag } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useDensity } from "../../contracts/density";

const tagEqual = equalFor(Tag.Types.Tag);

/** East Tag value type. */
export type TagValue = ValueTypeOf<typeof Tag.Types.Tag>;

/**
 * Converts an East UI Tag value into Chakra `TagRootProps`.
 *
 * @remarks
 * Per the main/style type-shape convention, the main struct carries `label`
 * + state (`closable`) + behaviour (`onClose`). Every visual field lives in
 * `value.style`.
 */
export function toChakraTag(value: TagValue): TagRootProps {
    const style = getSomeorUndefined(value.style);
    if (style === undefined) return {};

    const padding = getSomeorUndefined(style.padding);
    const margin = getSomeorUndefined(style.margin);

    return {
        variant: getSomeorUndefined(style.variant)?.type as TagRootProps["variant"] | undefined,
        colorPalette: getSomeorUndefined(style.colorPalette)?.type,
        size: getSomeorUndefined(style.size)?.type,
        opacity: getSomeorUndefined(style.opacity),
        color: getSomeorUndefined(style.color),
        background: getSomeorUndefined(style.background),
        borderRadius: getSomeorUndefined(style.borderRadius),
        borderWidth: getSomeorUndefined(style.borderWidth)?.type,
        borderStyle: getSomeorUndefined(style.borderStyle)?.type,
        borderColor: getSomeorUndefined(style.borderColor),
        overflow: getSomeorUndefined(style.overflow)?.type,
        overflowX: getSomeorUndefined(style.overflowX)?.type,
        overflowY: getSomeorUndefined(style.overflowY)?.type,
        width: getSomeorUndefined(style.width),
        height: getSomeorUndefined(style.height),
        minWidth: getSomeorUndefined(style.minWidth),
        minHeight: getSomeorUndefined(style.minHeight),
        maxWidth: getSomeorUndefined(style.maxWidth),
        maxHeight: getSomeorUndefined(style.maxHeight),
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
    };
}

export interface EastChakraTagProps {
    value: TagValue;
}

/** Renders an East UI Tag value using Chakra v3 `Tag`. */
export const EastChakraTag = memo(function EastChakraTag({ value }: EastChakraTagProps) {
    const props = useMemo(() => toChakraTag(value), [value]);
    const closable = useMemo(() => getSomeorUndefined(value.closable), [value.closable]);
    const onCloseFn = useMemo(() => getSomeorUndefined(value.onClose), [value.onClose]);
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density = localDensity ?? inheritedDensity;

    const handleClose = useCallback(() => {
        if (onCloseFn) {
            queueMicrotask(() => onCloseFn());
        }
    }, [onCloseFn]);

    return (
        <ChakraTag.Root {...props} {...(density !== undefined ? ({ density } as TagRootProps) : {})}>
            <ChakraTag.Label>{value.label}</ChakraTag.Label>
            {closable && (
                <ChakraTag.CloseTrigger onClick={onCloseFn ? handleClose : undefined} />
            )}
        </ChakraTag.Root>
    );
}, (prev, next) => tagEqual(prev.value, next.value));
