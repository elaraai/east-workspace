/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Spinner as ChakraSpinner, type SpinnerProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Spinner } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const spinnerEqual = equalFor(Spinner.Types.Spinner);

export type SpinnerValue = ValueTypeOf<typeof Spinner.Types.Spinner>;

export interface EastChakraSpinnerProps {
    value: SpinnerValue;
}

export function toChakraSpinner(value: SpinnerValue): SpinnerProps {
    const style = getSomeorUndefined(value.style);
    if (!style) return {};
    const props: SpinnerProps = {};
    const size = getSomeorUndefined(style.size)?.type;
    const colorPalette = getSomeorUndefined(style.colorPalette)?.type;
    const thickness = getSomeorUndefined(style.thickness);
    const speed = getSomeorUndefined(style.speed);
    const color = getSomeorUndefined(style.color);
    const trackColor = getSomeorUndefined(style.trackColor);
    if (size !== undefined) props.size = size;
    if (colorPalette !== undefined) props.colorPalette = colorPalette;
    if (thickness !== undefined) props.borderWidth = thickness;
    if (speed !== undefined) props.animationDuration = speed;
    if (color !== undefined) props.color = color;
    if (trackColor !== undefined) props.borderBottomColor = trackColor;
    return props;
}

/**
 * Renders an East UI Spinner using Chakra v3's Spinner component.
 *
 * @remarks
 * Purely visual — no content or behaviour. Styling flows through the `style`
 * sub-struct into Chakra props.
 */
export const EastChakraSpinner = memo(function EastChakraSpinner({ value }: EastChakraSpinnerProps) {
    const props = useMemo(() => toChakraSpinner(value), [value]);
    return <ChakraSpinner {...props} />;
}, (prev, next) => spinnerEqual(prev.value, next.value));
