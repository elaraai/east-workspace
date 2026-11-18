/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that carries stored dataflow runs into the form in
 * which each node of a run's graph says what it loads: a load node, the load
 * of a composite record's source a dataset of the package feeds, names its
 * record and source, and a task names none.
 *
 * A stored state's beast2 header names the whole state type, and a decode
 * refuses a header whose type differs, so every run an earlier release stored
 * is rewritten, each node of its graph loading nothing: no earlier release
 * ran a load.
 *
 * Both forms are frozen copies, which nothing but this upgrade, and the step
 * before it, reads: the step reads what the releases before it wrote and
 * writes what it shipped, however the state changes after.
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StringType, StructType, encodeBeast2For, none, some, toEastTypeValue, type ValueTypeOf } from '@elaraai/east';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { DataflowStateWithForceTasksType } from './dataflow-force-tasks.js';
import { isStoredForm, storedFormReader } from './forms.js';
import { workStoredRunsInParts } from './parts.js';

/** A run's graph, as this upgrade writes it: each node with what it loads. */
const FrozenGraphWithLoadsType = StructType({
  tasks: ArrayType(StructType({
    name: StringType,
    hash: StringType,
    inputs: ArrayType(StringType),
    output: StringType,
    dependsOn: ArrayType(StringType),
    load: OptionType(StructType({ record: StringType, source: StringType })),
  })),
});

/**
 * A run's stored state as this upgrade writes it, frozen: the form the step
 * before it wrote, each node of its graph saying what it loads.
 *
 * @internal
 */
export const DataflowStateWithGraphLoadsType = StructType({
  ...DataflowStateWithForceTasksType.fields,
  graph: OptionType(FrozenGraphWithLoadsType),
});

/** A stored run in the form before this upgrade: the one the step before it wrote. */
type StateBeforeGraphLoads = ValueTypeOf<typeof DataflowStateWithForceTasksType>;
/** A stored run in the form this upgrade writes. */
type StateWithGraphLoads = ValueTypeOf<typeof DataflowStateWithGraphLoadsType>;

const WITH_TYPE = toEastTypeValue(DataflowStateWithGraphLoadsType);
const encodeWith = encodeBeast2For(DataflowStateWithGraphLoadsType);

/** The name a repository's record keeps once the upgrade is applied. */
export const DATAFLOW_GRAPH_LOADS = 'dataflow-graph-loads';

/** A stored run in the form before this upgrade, or null for bytes of any
 *  other form, or that do not decode. */
const beforeGraphLoads = storedFormReader(DataflowStateWithForceTasksType);

/** A run of the form before this upgrade, in the form it writes: each node of
 *  its graph loading nothing. */
function withGraphLoads(state: StateBeforeGraphLoads): StateWithGraphLoads {
  const graph: StateWithGraphLoads['graph'] = state.graph.type === 'some'
    ? some({ tasks: state.graph.value.tasks.map((task) => ({ ...task, load: none })) })
    : none;
  return { ...state, graph };
}

/**
 * Rewrites every dataflow run a repository stores in the form in which each
 * node of a run's graph says what it loads: every node of a run an earlier
 * release stored loads nothing.
 *
 * @remarks
 * Every run is read as it is stored, a workspace at a time
 * ({@link workStoredRunsInParts}), and written back through the stored run's
 * own `replace`. A run already in the form this upgrade writes is left as it
 * is; and so is one in neither form, which a crash or a failing disk left, and
 * which a read refuses as it did before.
 */
export const dataflowGraphLoads: RepositoryUpgrade = {
  name: DATAFLOW_GRAPH_LOADS,
  apply: (storage, repo, at, until) => workStoredRunsInParts(storage, repo, at, until, async (stored) => {
    if (isStoredForm(stored.bytes, WITH_TYPE)) return;
    const earlier = beforeGraphLoads(stored.bytes);
    if (earlier !== null) await stored.replace(encodeWith(withGraphLoads(earlier)));
  }),
};
