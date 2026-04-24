/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, Fragment } from "react";
import { Kbd as ChakraKbd, HStack, Text as ChakraText } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Kbd } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const kbdEqual = equalFor(Kbd.Types.Kbd);

/** East Kbd value type. */
export type KbdValue = ValueTypeOf<typeof Kbd.Types.Kbd>;

export interface EastChakraKbdProps {
    value: KbdValue;
}

/**
 * Renders an East UI Kbd using Chakra v3 `Kbd` — one per key, with a
 * `+` separator between keys in a multi-key chord.
 */
export const EastChakraKbd = memo(function EastChakraKbd({ value }: EastChakraKbdProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const variant = style ? (getSomeorUndefined(style.variant)?.type as string | undefined) : undefined;
    const size = style ? (getSomeorUndefined(style.size)?.type as string | undefined) : undefined;
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const shadowColor = style ? getSomeorUndefined(style.shadowColor) : undefined;

    const keys = value.keys;

    return (
        <HStack gap="1" align="center" display="inline-flex">
            {keys.map((key: string, i: number) => (
                <Fragment key={i}>
                    {i > 0 && <ChakraText as="span" color="fg.muted">+</ChakraText>}
                    <ChakraKbd
                        variant={variant === "solid" ? "raised" : (variant as "outline" | "subtle" | "plain" | "raised" | undefined)}
                        size={(size === "xs" || size === "xl" || size === "2xl" ? "sm" : size) as "sm" | "md" | "lg" | undefined}
                        colorPalette={colorPalette}
                        color={color}
                        background={background}
                        borderColor={borderColor}
                        boxShadow={shadowColor ? `0 2px 0 ${shadowColor}` : undefined}
                    >
                        {key}
                    </ChakraKbd>
                </Fragment>
            ))}
        </HStack>
    );
}, (prev, next) => kbdEqual(prev.value, next.value));
