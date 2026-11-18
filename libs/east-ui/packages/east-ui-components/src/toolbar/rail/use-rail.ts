/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rail engine's state (#1673): which cluster's editor is held open, the
 * forms each cluster folds through, and how many of its fields are set.
 *
 * A cluster's editor is the terminal surface: every affordance of the cluster,
 * complete however far the cluster has folded. While it is open the cluster is
 * held — its popover hangs from its trigger — and keeps the chip steps it had
 * as the editor opened (#1231): a clause added there would put a chip's step
 * before the held form, and the form it holds would be another one, the
 * trigger growing under its popover.
 *
 * The rail is made again only when what it is made from moves (#1398, CL9):
 * the model, the clusters' affordances, and the editor held open. A host that
 * keeps its model the same object while its choices and its words hold hands
 * its toolbar the same rail at every render.
 *
 * @packageDocumentation
 */

import { useMemo, useState } from "react";
import { railForms, railSet, type RailAffordance, type RailCluster, type RailForm } from "./forms.js";

/** What the engine reads of a rail's model. */
export interface RailSource {
    /** The version that invalidates measured forms. */
    readonly version: unknown;
    /** How many chips the rail's filter shows; only a filter with chips that fold on their own gives one. */
    readonly filterChips?: number | undefined;
    /** Each affordance, by its kind. */
    readonly describe: (kind: string) => RailAffordance;
}

/** The editor held open: its cluster, and how many chips the cluster's filter had as it opened. */
export interface RailHeld {
    /** The cluster's key. */
    readonly key: string;
    /** The chips its filter showed as the editor opened. */
    readonly chips: number;
}

/** One cluster of a rail, as its visual layer draws it. */
export interface RailClusterState {
    /** The cluster. */
    readonly cluster: RailCluster;
    /** Its forms, widest first. */
    readonly forms: ReadonlyArray<RailForm>;
    /** Each step's rank: `ranks[i]` takes form `i` to form `i + 1`. */
    readonly ranks: ReadonlyArray<number>;
    /** Its last form — every affordance folded: what a phone's Filters button holds. */
    readonly every: RailForm;
    /** Whether its editor is held open. */
    readonly held: boolean;
    /** How many of its affordances narrow now. */
    readonly set: number;
    /** Opens its editor, holding the cluster at the chips its filter shows now; or closes it. */
    readonly setOpen: (open: boolean) => void;
}

/**
 * The chips a cluster's filter shows: the model's, where the cluster holds
 * the filter.
 */
function chipsOf(model: RailSource, cluster: RailCluster): number {
    return cluster.kinds.includes("filter") ? (model.filterChips ?? 0) : 0;
}

/**
 * A rail's clusters, each with its forms — what {@link useRail} keeps while
 * they hold. A cluster with no affordance is left out.
 *
 * @param model - The rail's model; `undefined` is a rail with no controls
 * @param clusters - The clusters, in the order the host lays them out
 * @param held - The editor held open, when one is
 * @param hold - Told the editor to hold open, or `null` to close it
 * @returns Each cluster that holds an affordance
 */
export function railClusters(
    model: RailSource | undefined,
    clusters: ReadonlyArray<RailCluster>,
    held: RailHeld | null,
    hold: (held: RailHeld | null) => void,
): RailClusterState[] {
    if (model === undefined) return [];
    return clusters.filter((cluster) => cluster.kinds.length > 0).map((cluster): RailClusterState => {
        const live = chipsOf(model, cluster);
        const mine = held !== null && held.key === cluster.key;
        // A held cluster keeps the chip steps it opened with (#1231).
        const { forms, ranks } = railForms(cluster, model.describe, mine ? held.chips : live);
        return {
            cluster,
            forms,
            ranks,
            every: forms[forms.length - 1]!,
            held: mine,
            set: railSet(cluster, model.describe),
            setOpen: (open) => hold(open ? { key: cluster.key, chips: live } : null),
        };
    });
}

/**
 * A rail's state: its clusters' forms, and the editor held open.
 *
 * @param model - The rail's model; `undefined` is a rail with no controls
 * @param clusters - The clusters, in the order the host lays them out
 * @returns Each cluster that holds an affordance — the same array while the model, the clusters' affordances and the held editor hold
 */
export function useRail(model: RailSource | undefined, clusters: ReadonlyArray<RailCluster>): ReadonlyArray<RailClusterState> {
    const [held, setHeld] = useState<RailHeld | null>(null);
    // The clusters as what they hold: a host's new array of the same clusters makes nothing again.
    const shape = clusters.map((cluster) => `${cluster.key}\u0001${cluster.side ?? ""}\u0001${cluster.kinds.join("\u0002")}`).join("\u0000");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the clusters are read by `shape`, what they hold
    return useMemo(() => railClusters(model, clusters, held, setHeld), [model, shape, held]);
}
