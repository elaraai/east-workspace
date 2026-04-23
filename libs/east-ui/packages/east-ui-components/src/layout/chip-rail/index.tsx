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
import { Flex as ChakraFlex, Separator as ChakraSeparator } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { ChipRail } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { useDensity, type Density } from "../../contracts/density";

const chipRailEqual = equalFor(ChipRail.Types.ChipRail);

/** East ChipRail value type. */
export type ChipRailValue = ValueTypeOf<typeof ChipRail.Types.ChipRail>;

/** Density → Chakra gap token. */
function densityToGap(density: Density): string {
    switch (density) {
        case "condensed": return "1";
        case "compact": return "2";
        case "comfortable": return "3";
    }
}

export interface EastChakraChipRailProps {
    value: ChipRailValue;
    storageKey: string;
}

export const EastChakraChipRail = memo(function EastChakraChipRail({ value, storageKey }: EastChakraChipRailProps) {
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density = (localDensity ?? inheritedDensity) as Density;
    const gap = densityToGap(density);

    const separatorTag = useMemo(() => getSomeorUndefined(value.separator)?.type, [value.separator]);
    const overflowTag = useMemo(() => getSomeorUndefined(value.overflow)?.type, [value.overflow]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const separatorColor = style ? getSomeorUndefined(style.separatorColor) : undefined;

    const isScroll = overflowTag === "scroll";

    const chips = value.chips.map((chip, index) => {
        const key = `${storageKey}.chip.${index}`;
        const needSep = index > 0 && separatorTag && separatorTag !== "none";
        return (
            <Fragment key={key}>
                {needSep && (
                    separatorTag === "line"
                        ? <ChakraSeparator orientation="vertical" borderColor={separatorColor} />
                        : <span style={{ color: separatorColor ?? "inherit", userSelect: "none" }}>·</span>
                )}
                <EastChakraComponent value={chip} storageKey={key} />
            </Fragment>
        );
    });

    return (
        <ChakraFlex
            gap={gap}
            alignItems="center"
            flexWrap={isScroll ? "nowrap" : "wrap"}
            overflowX={isScroll ? "auto" : undefined}
            background={background}
        >
            {chips}
        </ChakraFlex>
    );
}, (prev, next) => chipRailEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
