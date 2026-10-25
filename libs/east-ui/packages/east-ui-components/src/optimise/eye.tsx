/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Elara eye (#1409; `Optimise Spec.md` §8) — the mark from the lockup's
 * geometry: a ring of 100 dots and an iris of 52, each as one path so each
 * takes its own colour, and the iris's echo, unseen until a run is out. The
 * eye button draws it, and so does the result's banner.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";

type Styles = Record<string, SystemStyleObject>;

/** The lockup's box: the dots' centres lie within it. */
const BOX = 82.9;

/** Each dot's radius. */
const DOT = 2.2;

/** The echo's radius: the iris's reach. */
const ECHO = 17;

/** The centres of the ring's 100 dots. */
const RING: readonly (readonly [number, number])[] = [
    [80.7, 51.2], [77.4, 54.5], [74.2, 57.8], [70.9, 61.1], [67.6, 64.3], [64.3, 67.6], [61.1, 70.9], [57.8, 74.1], [54.5, 77.4], [51.3, 80.7],
    [80.7, 44.7], [77.4, 48], [74.2, 51.2], [70.9, 54.5], [67.6, 57.8], [64.3, 61.1], [61.1, 64.3], [57.8, 67.6], [54.5, 70.9], [51.3, 74.1],
    [48, 77.4], [44.7, 80.7], [80.7, 38.2], [77.4, 41.4], [74.2, 44.7], [44.7, 74.1], [41.4, 77.4], [38.2, 80.7], [80.7, 31.6], [77.4, 34.9],
    [74.2, 38.2], [38.2, 74.1], [34.9, 77.4], [31.6, 80.7], [77.4, 28.3], [74.2, 31.6], [31.6, 74.1], [28.4, 77.4], [74.2, 25.1], [70.9, 28.3],
    [28.4, 70.9], [25.1, 74.1], [70.9, 21.8], [67.6, 25.1], [25.1, 67.6], [21.8, 70.9], [67.6, 18.5], [64.3, 21.8], [21.8, 64.3], [18.5, 67.6],
    [64.3, 15.3], [61.1, 18.5], [18.5, 61.1], [15.3, 64.3], [61.1, 12], [57.8, 15.3], [15.3, 57.8], [12, 61.1], [57.8, 8.7], [54.5, 12],
    [12, 54.5], [8.7, 57.8], [8.7, 51.2], [5.5, 54.5], [8.7, 44.7], [5.5, 48], [2.2, 51.2], [8.7, 38.2], [5.5, 41.4], [2.2, 44.7],
    [28.4, 12], [25.1, 15.3], [21.8, 18.5], [18.5, 21.8], [15.3, 25.1], [12, 28.3], [8.7, 31.6], [5.5, 34.9], [2.2, 38.2], [25.1, 8.7],
    [21.8, 12], [18.5, 15.3], [15.3, 18.5], [12, 21.8], [8.7, 25.1], [5.5, 28.3], [2.2, 31.6], [54.5, 5.4], [51.3, 8.7], [51.3, 2.2],
    [48, 5.4], [44.7, 8.7], [44.7, 2.2], [41.4, 5.4], [38.2, 8.7], [38.2, 2.2], [34.9, 5.4], [31.6, 8.7], [31.6, 2.2], [28.4, 5.4],
];

/** The centres of the iris's 52 dots. */
const IRIS: readonly (readonly [number, number])[] = [
    [57.8, 48], [54.5, 51.2], [51.3, 54.5], [48, 57.8], [57.8, 41.4], [54.5, 44.7], [51.3, 48], [48, 51.2], [44.7, 54.5], [41.4, 57.8],
    [57.8, 34.9], [54.5, 38.2], [51.3, 41.4], [48, 44.7], [44.7, 48], [41.4, 51.2], [38.2, 54.5], [34.9, 57.8], [54.5, 31.6], [51.3, 34.9],
    [48, 38.2], [44.7, 41.4], [41.4, 44.7], [38.2, 48], [34.9, 51.2], [31.6, 54.5], [51.3, 28.3], [48, 31.6], [44.7, 34.9], [41.4, 38.2],
    [38.2, 41.4], [34.9, 44.7], [31.6, 48], [28.4, 51.2], [48, 25.1], [44.7, 28.3], [41.4, 31.6], [38.2, 34.9], [34.9, 38.2], [31.6, 41.4],
    [28.4, 44.7], [25.1, 48], [41.4, 25.1], [38.2, 28.3], [34.9, 31.6], [31.6, 34.9], [28.4, 38.2], [25.1, 41.4], [34.9, 25.1], [31.6, 28.3],
    [28.4, 31.6], [25.1, 34.9],
];

/**
 * The dots as one path: each a circle of two arcs, so the path fills as one
 * shape in one colour.
 *
 * @param dots - The dots' centres
 * @returns The path's data
 */
function pathOf(dots: readonly (readonly [number, number])[]): string {
    const d = DOT * 2;
    return dots.map(([x, y]) => `M${(x - DOT).toFixed(2)} ${y}a${DOT} ${DOT} 0 1 0 ${d} 0a${DOT} ${DOT} 0 1 0-${d} 0`).join("");
}

const RING_PATH = pathOf(RING);
const IRIS_PATH = pathOf(IRIS);

/** How many dots the ring has, and the iris: what the geometry is held to. */
export const ELARA_EYE_DOTS = { ring: RING.length, iris: IRIS.length } as const;

/** The mark's sizes, in px: 16 in the eye button and the banner, 14 in a small button. */
export type ElaraEyeSize = 14 | 16;

/** Props of {@link ElaraEye}. */
export interface ElaraEyeProps {
    /** Its size: 16 in the eye button and the banner, 14 in a small button. */
    readonly size: ElaraEyeSize;
}

/**
 * The Elara eye — see the module docs. Decorative: what it stands in is
 * named by its host. Its colour is its host's (`currentColor`); the host's
 * recipe gives the iris its own (`[data-eye-iris]`), and the echo
 * (`[data-eye-echo]`) its run. Its size is the recipe's, by `data-eye-size`.
 *
 * @param props - Its size
 * @returns The mark
 */
export function ElaraEye({ size }: ElaraEyeProps) {
    const recipe = useSlotRecipe({ key: "optimise" });
    const styles = useMemo(() => recipe({}) as Styles, [recipe]);
    return (
        <chakra.svg css={styles.eye} data-eye="" data-eye-size={size} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
            <path data-eye-ring="" d={RING_PATH} />
            <circle data-eye-echo="" cx={BOX / 2} cy={BOX / 2} r={ECHO} />
            <path data-eye-iris="" d={IRIS_PATH} />
        </chakra.svg>
    );
}
