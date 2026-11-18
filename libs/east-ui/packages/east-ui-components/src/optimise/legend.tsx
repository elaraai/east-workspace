/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The legend's `Elara change` (#1409; `Optimise Spec.md` §6, §8) — a 14 × 8
 * swatch of the dirty fill with the steady ring and glow, and the words 8px
 * on, as the design's legend item lays them out (the recipe's `legendItem`) —
 * one more unit of a builder's footer legend during the highlight, in the
 * builder's own legend style over that, cut whole as the rail's fit cuts its
 * others (`data-footer-unit`, `data-footer-cut`).
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { optimiseMessages, type OptimiseMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** A slot recipe's style, as a builder holds its slots: Chakra's style object, or one read as a plain record. */
type SlotStyle = SystemStyleObject | Readonly<Record<string, unknown>>;

/** Props of {@link OptimiseLegendItem}. */
export interface OptimiseLegendItemProps {
    /** The builder's own legend item style: the rail's footer item and its legend item slots. */
    readonly css?: SlotStyle | readonly SlotStyle[] | undefined;
    /** Whether the rail's fit cut it: `footerCut(index, fit)`. */
    readonly cut?: "" | undefined;
    /** The words: the shared table unless given. */
    readonly messages?: OptimiseMessages | undefined;
}

/**
 * The legend's `Elara change` — see the module docs. Place it after the
 * builder's own legend units while the highlight is on.
 *
 * @param props - The builder's legend style, and whether the fit cut the item
 * @returns The unit
 */
export function OptimiseLegendItem({ css, cut, messages = optimiseMessages }: OptimiseLegendItemProps) {
    const recipe = useSlotRecipe({ key: "optimise" });
    const styles = useMemo(() => recipe({}) as Styles, [recipe]);
    // Its own layout first, whatever the footer gives it; the builder's legend style over it.
    const own = css === undefined ? [] : Array.isArray(css) ? css : [css];
    return (
        <Box as="span" css={[styles.legendItem, ...own] as SystemStyleObject[]} data-footer-unit="" data-footer-cut={cut} data-optimise-legend="">
            <Box as="span" css={styles.legendSwatch} aria-hidden="true" data-optimise-swatch="" />
            {messages.legend()}
        </Box>
    );
}
