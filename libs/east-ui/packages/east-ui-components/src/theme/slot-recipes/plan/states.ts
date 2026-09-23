/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lifecycle axis (`Plan Spec.md` §4.3) — how an element that carries a
 * run's state looks in each state, ONE vocabulary for every element that
 * carries one (#817): span bars, bucket tiles and cards chips. Each element
 * keeps its own RESTING look (observed / confirmed — its identity on the
 * canvas) and adjusts the rest where its size asks; the dashed proposal, the
 * struck removal, the ghost estimate and the greyed rejection are shared.
 *
 * A rollup band speaks a coarser dialect (a proposal and an estimate read the
 * same at 12px, and a band is never a removal), so it keeps its own looks.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** A lifecycle state, as the `data-state` attribute spells it. */
export type PlanLifecycleState = "obs" | "appr" | "prop" | "propRemoved" | "estimated" | "rejected";

/** The shared looks — everything but the resting pair. */
const SHARED: Record<Exclude<PlanLifecycleState, "obs" | "appr">, SystemStyleObject> = {
    // planned · proposed — dashed brand, italic.
    prop: {
        color: "brand.fg",
        borderWidth: "1.5px",
        borderStyle: "dashed",
        borderColor: "{colors.brand.600}",
        fontStyle: "italic",
    },
    // proposed removal — warn-dashed, struck through.
    propRemoved: {
        borderWidth: "1.5px",
        borderStyle: "dashed",
        borderColor: "{colors.status.warn}",
        textDecoration: "line-through",
    },
    // forecast ghost — transparent, a 1px dashed strong rule, subtle italic.
    estimated: {
        background: "transparent",
        color: "fg.subtle",
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "border.strong",
        fontStyle: "italic",
    },
    // declined — greyed dashed, kept in place for the diff.
    rejected: {
        background: "transparent",
        color: "fg.subtle",
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "{colors.gray.400}",
        textDecoration: "line-through",
    },
};

/** An element's own part of the lifecycle axis. */
export interface PlanLifecycleLooks extends Partial<Record<PlanLifecycleState, SystemStyleObject>> {
    /** The element's resting looks — observed and confirmed. */
    obs: SystemStyleObject;
    appr: SystemStyleObject;
    /** Added to every NON-resting state (a tile's tighter radius, say). */
    marked?: SystemStyleObject;
}

/**
 * An element's `data-state` rules: its resting looks, then the shared looks
 * with its own adjustments on top.
 *
 * @param looks - The element's resting looks and adjustments
 * @returns The `&[data-state='…']` rules, in lifecycle order
 */
export function lifecycleStates(looks: PlanLifecycleLooks): Record<`&[data-state='${PlanLifecycleState}']`, SystemStyleObject> {
    const { obs, appr, marked, ...own } = looks;
    return {
        "&[data-state='obs']": obs,
        "&[data-state='appr']": appr,
        "&[data-state='prop']": { ...SHARED.prop, ...marked, ...own.prop },
        "&[data-state='propRemoved']": { ...SHARED.propRemoved, ...marked, ...own.propRemoved },
        "&[data-state='estimated']": { ...SHARED.estimated, ...marked, ...own.estimated },
        "&[data-state='rejected']": { ...SHARED.rejected, ...marked, ...own.rejected },
    };
}
