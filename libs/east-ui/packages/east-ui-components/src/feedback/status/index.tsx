/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useEffect, useState } from "react";
import {
    Box as ChakraBox,
    HStack as ChakraHStack,
    useSlotRecipe,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Status } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

const statusEqual = equalFor(Status.Types.Status);

export type StatusValue = ValueTypeOf<typeof Status.Types.Status>;

export interface EastChakraStatusProps {
    value: StatusValue;
    storageKey?: string;
}

/* Status dot ↦ muted semantic-token palette (pattern_spec/spec.css `.dot.*`).
 *
 * Spec rule: status = dot + WORD, never a tinted background. We render a
 * bare 8 px circle whose colour comes from the spec's muted hues, and a
 * label rendered in `caption.eyebrow` (mono / 10 / 600 / 0.18 em / uppercase). */
const DOT_COLOR: Record<StatusValue["value"]["type"], string> = {
    success: "fg.success",
    warning: "fg.warning",
    danger:  "fg.danger",
    info:    "fg.info",
    neutral: "fg.muted",
};

/**
 * Renders an East UI Status indicator. Per pattern_spec convention this is
 * "dot + word, no tint" — a coloured 8 px circle paired with a mono
 * uppercase label. No background, no padding, no border on the wrapper.
 *
 * @remarks
 * `pulsing` enables a CSS pulse animation on the indicator dot unless the
 * user has `prefers-reduced-motion: reduce`. Animation duration matches
 * the spec's `.dot.run` (1.6 s); use `value.style.live` (not modelled here)
 * for the slower 2.4 s ring pulse if needed.
 *
 * The paired icon has already been injected in the IR factory (§0.3); we
 * just render it here between the dot and the label.
 */
export const EastChakraStatus = memo(function EastChakraStatus({ value, storageKey }: EastChakraStatusProps) {
    /* Consume the `status` slot recipe upstream — root/indicator/label
     * styles flow from `theme/slot-recipes/status.ts` (registered under
     * `slotRecipes.status` in the system). The renderer only contributes
     * the data + content; chrome lives in the theme. */
    const statusRecipe = useSlotRecipe({ key: "status" });

    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const pulsing = getSomeorUndefined(value.pulsing) ?? false;

    const [reducedMotion, setReducedMotion] = useState<boolean>(false);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReducedMotion(mq.matches);
        const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
        mq.addEventListener("change", listener);
        return () => mq.removeEventListener("change", listener);
    }, []);

    const statusTag = value.value.type;
    const sizeTag = style ? (getSomeorUndefined(style.size)?.type as "sm" | "md" | "lg" | undefined) : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const dotColorOverride = style ? getSomeorUndefined(style.dotColor) : undefined;
    const shouldPulse = pulsing && !reducedMotion;

    /* Resolve slot styles from the upstream `status` slot recipe. */
    const styles = statusRecipe({
        status: statusTag,
        size: sizeTag ?? "md",
        pulsing: shouldPulse,
    });

    return (
        <ChakraHStack
            css={styles.root}
            {...(color !== undefined ? { color } : {})}
        >
            <ChakraBox
                as="span"
                css={styles.indicator}
                {...(dotColorOverride !== undefined ? { bg: dotColorOverride } : {})}
            />
            {icon ? (
                <ChakraBox as="span" display="inline-flex" alignItems="center" color={dotColorOverride ?? DOT_COLOR[statusTag]}>
                    <FontAwesomeIcon
                        icon={[icon.prefix as IconPrefix, icon.name as IconName]}
                    />
                </ChakraBox>
            ) : null}
            <ChakraBox css={styles.label}>
                <EastChakraComponent
                    value={value.label}
                    storageKey={`${storageKey ?? ""}.label`}
                />
            </ChakraBox>
        </ChakraHStack>
    );
}, (prev, next) => statusEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
