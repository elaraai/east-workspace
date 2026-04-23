/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Reduced motion (§0.2): this renderer via `usePrefersReducedMotion`
 *   - Token resolution:       `../style/motion.ts`, `../style/animation.ts`
 */

import { memo, useMemo } from "react";
import { Box as ChakraBox, type BoxProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { toTransition, type TransitionToken, type MotionDurationToken, type MotionEasingToken } from "../../style/motion.js";
import { toAnimationProps, type AnimationPresetToken } from "../../style/animation.js";
import { usePrefersReducedMotion } from "../../contracts/reduced-motion.js";

// Pre-define the equality function at module level
const boxEqual = equalFor(Box.Types.Box);

/** East Box value type */
export type BoxValue = ValueTypeOf<typeof Box.Types.Box>;

/**
 * Converts an East UI Box value to Chakra UI Box props.
 * Pure function - easy to test independently.
 *
 * Animation + reduced-motion handling lives in the component (needs a hook);
 * this function covers the static + tokenised subset only.
 *
 * @param value - The East Box value
 * @returns Chakra Box props
 */
export function toChakraBox(value: BoxValue): BoxProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    // Tokenised fields resolve via Chakra directly: token names pass through as
    // strings (e.g. `zIndex="sticky"`, `boxShadow="md"`, `cursor="help"`) and
    // the theme resolves them.
    const positionTag = style ? getSomeorUndefined(style.position)?.type : undefined;
    const zIndexTag = style ? getSomeorUndefined(style.zIndex)?.type : undefined;
    const boxShadowTag = style ? getSomeorUndefined(style.boxShadow)?.type : undefined;
    const cursorTag = style ? getSomeorUndefined(style.cursor)?.type : undefined;
    const fontFamilyTag = style ? getSomeorUndefined(style.fontFamily)?.type : undefined;
    const fontVariantNumericTag = style ? getSomeorUndefined(style.fontVariantNumeric)?.type : undefined;
    const transitionTag = style
        ? (getSomeorUndefined(style.transition)?.type as TransitionToken | undefined)
        : undefined;

    // Build a CSS `transition` shorthand from the named preset. Duration +
    // easing default to `"fast"` / `"standard"` — the theme owns the values.
    const transition = transitionTag
        ? toTransition(
            transitionTag,
            "fast" satisfies MotionDurationToken,
            "standard" satisfies MotionEasingToken,
        )
        : undefined;

    return {
        display: style ? getSomeorUndefined(style.display)?.type : undefined,
        width: style ? getSomeorUndefined(style.width) : undefined,
        height: style ? getSomeorUndefined(style.height) : undefined,
        minHeight: style ? getSomeorUndefined(style.minHeight) : undefined,
        minWidth: style ? getSomeorUndefined(style.minWidth) : undefined,
        maxHeight: style ? getSomeorUndefined(style.maxHeight) : undefined,
        maxWidth: style ? getSomeorUndefined(style.maxWidth) : undefined,
        // Padding struct -> individual props
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        // Margin struct -> individual props
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
        background: style ? getSomeorUndefined(style.background) : undefined,
        color: style ? getSomeorUndefined(style.color) : undefined,
        borderRadius: style ? getSomeorUndefined(style.borderRadius) : undefined,
        border: style ? getSomeorUndefined(style.border) : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
        borderWidth: style ? getSomeorUndefined(style.borderWidth) : undefined,
        flexDirection: style ? getSomeorUndefined(style.flexDirection)?.type : undefined,
        justifyContent: style ? getSomeorUndefined(style.justifyContent)?.type : undefined,
        alignItems: style ? getSomeorUndefined(style.alignItems)?.type : undefined,
        gap: style ? getSomeorUndefined(style.gap) : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        position: positionTag,
        top: style ? getSomeorUndefined(style.top) : undefined,
        right: style ? getSomeorUndefined(style.right) : undefined,
        bottom: style ? getSomeorUndefined(style.bottom) : undefined,
        left: style ? getSomeorUndefined(style.left) : undefined,
        zIndex: zIndexTag,
        boxShadow: boxShadowTag,
        transform: style ? getSomeorUndefined(style.transform) : undefined,
        transition,
        cursor: cursorTag,
        opacity: style ? getSomeorUndefined(style.opacity) : undefined,
        fontFamily: fontFamilyTag,
        fontVariantNumeric: fontVariantNumericTag,
    };
}

export interface EastChakraBoxProps {
    value: BoxValue;
    storageKey: string;
}

/**
 * Renders an East UI Box value using Chakra UI Box component.
 *
 * Animation is wired here (not inside `toChakraBox`) because it depends on
 * the `prefers-reduced-motion` media-query hook. When the user has opted
 * into reduced motion, the animation is skipped entirely per §0.2.
 */
export const EastChakraBox = memo(function EastChakraBox({ value, storageKey }: EastChakraBoxProps) {
    const props = useMemo(() => toChakraBox(value), [value]);
    const reducedMotion = usePrefersReducedMotion();

    // §0.2 — animation degrades to `none` under `prefers-reduced-motion`.
    const animation = useMemo(() => {
        if (reducedMotion) return null;
        const style = getSomeorUndefined(value.style);
        const tag = style
            ? (getSomeorUndefined(style.animation)?.type as AnimationPresetToken | undefined)
            : undefined;
        return tag ? toAnimationProps(tag) : null;
    }, [value.style, reducedMotion]);

    return (
        <ChakraBox
            {...props}
            animationName={animation?.animationName}
            animationDuration={animation?.animationDuration}
            animationTimingFunction={animation?.animationTimingFunction}
            animationIterationCount={animation?.animationIterationCount}
        >
            {value.children.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </ChakraBox>
    );
}, (prev, next) => boxEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
