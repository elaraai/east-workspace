/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row past the cap, shaded (#1039, #1438): a bucket's shade, and the heat a
 * row draws in place of its elements — what an event kind's resources' rows
 * and a nested series' rows draw past the cap alike.
 *
 * @packageDocumentation
 */

import { ArrayType, BooleanType, DateTimeType, East, FloatType, OptionType, StructType, none, some, variant } from "@elaraai/east";
import { PlanHeatCellType, PlanRowKindType, PlanWeightCellType } from "./types.js";

/**
 * One bucket of a resource's shading (#1039): the bucket's start, and its
 * value — the share of the bucket the resource's events book, `0` to `1`, for
 * a way of drawing that draws bars or chips; how many of its events touch the
 * bucket, for one that draws tiles or marks; `none` where nothing shows at
 * this resolution, the notice's no-data hatch.
 */
export const PlanEventShadeType = StructType({ at: DateTimeType, value: OptionType(FloatType) });

/** Type representing {@link PlanEventShadeType}. */
export type PlanEventShadeType = typeof PlanEventShadeType;

/**
 * A resource's row of a shaded way of drawing (#1039), `(its buckets, the
 * largest count its kind's shading holds, whether it draws bars or chips)` →
 * its heat: a booked-vs-free bar a bucket for one that draws bars or chips,
 * each bucket's share; how many for one that draws tiles or marks, from none
 * to the largest, printed compact in the viewer's locale; and the no-data
 * hatch where a bucket holds no value, its row heat whatever it draws. A
 * nested series' row past the cap shades by it too (#1438).
 *
 * @internal
 */
export const shadedKind = East.function([ArrayType(PlanEventShadeType), FloatType, BooleanType], PlanRowKindType, ($, shades, top, booked) => {
    const valued = $.let(shades.every(($2, shade) => shade.value.hasTag("some")));
    const most = $.let(none, OptionType(FloatType));
    $.if(East.greater(top, 0), ($2) => { $2.assign(most, some(top)); });
    const heat = $.let(East.value(variant("heat", {
        cells: variant("heat", {
            cells: shades.map(($2, shade) => East.value({ at: variant("time", shade.at), value: shade.value, label: none }, PlanHeatCellType)),
            scale: { min: some(0), max: most, warnAt: none },
            fold: variant("sum", null),
            format: some(variant("compact", { display: none })),
        }),
        aggregate: none,
        scale: none,
    }), PlanRowKindType), PlanRowKindType);
    $.if(booked.and(() => valued), ($2) => {
        $2.assign(heat, East.value(variant("heat", {
            cells: variant("weight", {
                cells: shades.map(($3, shade) => East.value({ at: variant("time", shade.at), fraction: shade.value.unwrap("some"), planned: false }, PlanWeightCellType)),
                fold: variant("mean", null),
                format: none,
            }),
            aggregate: none,
            scale: none,
        }), PlanRowKindType));
    });
    return heat;
});
