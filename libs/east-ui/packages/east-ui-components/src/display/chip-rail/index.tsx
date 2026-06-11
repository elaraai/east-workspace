/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Density cascade (§1.1): this renderer via `useDensity()`
 *
 * Overflow:
 *   - `wrap` (default): chips wrap to additional rows via `flexWrap: "wrap"`
 *   - `scroll`:         chips stay on one line, rail scrolls horizontally
 *                       (`overflowX: "auto"`, `flexWrap: "nowrap"`)
 */

import { memo, Fragment, useMemo } from "react";
import { Flex as ChakraFlex, Separator as ChakraSeparator, Box as ChakraBox, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { ChipRail } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useDensity, DensityProvider, type Density } from "../../contracts/density";

const chipRailEqual = equalFor(ChipRail.Types.ChipRail);

/** East ChipRail value type. */
export type ChipRailValue = ValueTypeOf<typeof ChipRail.Types.ChipRail>;

export interface EastChakraChipRailProps {
    value: ChipRailValue;
    storageKey: string;
}

export const EastChakraChipRail = memo(function EastChakraChipRail({ value, storageKey }: EastChakraChipRailProps) {
    const recipe = useSlotRecipe({ key: "chipRail" });
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density: Density = localDensity ?? inheritedDensity ?? "comfortable";
    const styles = recipe({ density });

    const labels = useMemo(() => getSomeorUndefined(value.labels), [value.labels]);
    const labeled = labels !== undefined;

    const separatorTag = useMemo(() => getSomeorUndefined(value.separator)?.type, [value.separator]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const overflowTag = useMemo(
        () => (style ? getSomeorUndefined(style.overflow)?.type : undefined),
        [style],
    );
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const separatorColor = style ? getSomeorUndefined(style.separatorColor) : undefined;

    const isScroll = overflowTag === "scroll";

    const chips = value.chips.map((chip, index) => {
        const key = `${storageKey}.chip.${index}`;
        const rendered = <EastChakraComponent value={chip} storageKey={key} />;

        // Labeled mode: each chip gets a caption column; separators are dropped
        // because the caption already names the dimension.
        if (labeled) {
            const caption = labels[index] ?? "";
            return (
                <ChakraBox key={key} css={styles.item} flexShrink={0}>
                    <ChakraBox css={styles.label}>{caption || " "}</ChakraBox>
                    {rendered}
                </ChakraBox>
            );
        }

        const needSep = index > 0 && separatorTag && separatorTag !== "none";
        return (
            <Fragment key={key}>
                {needSep && (
                    separatorTag === "line"
                        ? <ChakraSeparator
                              orientation="vertical"
                              borderColor={separatorColor}
                              height="1em"
                              alignSelf="center"
                              flexShrink={0}
                          />
                        : <ChakraBox
                              as="span"
                              color={separatorColor ?? "inherit"}
                              userSelect="none"
                              flexShrink={0}
                          >·</ChakraBox>
                )}
                <ChakraBox flexShrink={0}>
                    {rendered}
                </ChakraBox>
            </Fragment>
        );
    });

    return (
        <DensityProvider value={density}>
            <ChakraFlex
                css={styles.root}
                flexWrap={isScroll ? "nowrap" : "wrap"}
                overflowX={isScroll ? "auto" : undefined}
                background={background}
            >
                {chips}
            </ChakraFlex>
        </DensityProvider>
    );
}, (prev, next) => chipRailEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
