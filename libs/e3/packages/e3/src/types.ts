/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Types for e3 package definitions.
 *
 * Terminology:
 * - **Dataset**: A location holding a value (leaf node in the data tree)
 * - **Data tree**: A location containing datasets or nested trees (branch node)
 * - **Path**: An address pointing to a dataset or tree
 * - **Structure**: The shape of the data tree (what trees/datasets exist and their types)
 * - **Task**: A transformation that reads input datasets and produces an output dataset
 */

import type { CallableFunctionExpr, EastType, EastIR, AsyncEastIR, ValueTypeOf, variant } from '@elaraai/east';
import type { MutationForm, TreePath } from '@elaraai/e3-types';
import type { DatasetSource } from './input.js';
import type { Runner } from './runner.js';
import type { EnvironmentDecl } from './environment.js';

/**
 * A tree definition.
 *
 * Trees are branch nodes in the data tree that contain datasets or nested trees.
 * In MVP, we have two fixed trees: `.inputs` and `.outputs`.
 */
export interface DataTreeDef {
  readonly kind: 'datatree';
  /** Tree name (final segment of the path) */
  readonly name: string;
  /** Full path in the data tree */
  readonly path: TreePath;
  /** Dependencies: all trees this tree depends on */
  readonly deps: Set<DataTreeDef>;
}

/**
 * A dataset definition.
 *
 * Datasets are locations in the data tree that hold values. They can be:
 * - Input datasets at `.inputs.${name}` (created by e3.input)
 * - Output datasets at `.outputs.${name}` (created by tasks)
 *
 * @typeParam T - The East type of the dataset value
 */
export interface DatasetDef<T extends EastType = EastType, Path extends TreePath = TreePath> {
  readonly kind: 'dataset';
  /** Dataset name (final segment of the path) */
  readonly name: string;
  /** Full path in the data tree */
  readonly path: Path;
  /** East type of the dataset value */
  readonly type: T;
  /**
   * An inline initial value that travels IN the package.
   *
   * @remarks
   * Not the input surface any more — `e3.input` writes {@link source}. This
   * stays for the two internal inline-value uses: a task's `function_ir`
   * dataset (an `EastIR` bundle) and `record()`'s initial state. Neither is
   * path-initialisable.
   */
  readonly default?: ValueTypeOf<T>;
  /**
   * Where the initial value comes from, for an input declared with
   * `e3.input(name, type, source)`.
   *
   * @remarks
   * A `value` source is exported exactly like {@link default} was. A `file`
   * source leaves the package ref `unassigned` and records a descriptor in
   * `PackageObjectType.sources`, which deploy resolves — the bytes never travel
   * in the bundle.
   */
  readonly source?: DatasetSource<T>;
  /** Whether this dataset can be written to by users */
  readonly writable: boolean;
  /** Dependencies: all trees, datasets and tasks this dataset depends on */
  readonly deps: Set<DataTreeDef | DatasetDef | TaskDef>;
}

/**
 * A task definition.
 *
 * Tasks are transformations that read from input datasets and write to an
 * output dataset. When input datasets change, the task re-runs automatically.
 *
 * @typeParam TOutput - The East type of the output dataset
 */
export interface TaskDef<TOutput extends EastType = EastType, Path extends TreePath = TreePath> {
  readonly kind: 'task';
  /** Task name */
  readonly name: string;
  /** Command construction function — an EastIR bundle carrying both the IR
   *  and its source map so export serialization can preserve source locations. */
  readonly command: EastIR<[string[], string], string[]>;
  /** Input datasets this task reads from */
  readonly inputs: DatasetDef[];
  /** Output dataset this task writes to (at `.outputs.${name}`) */
  readonly output: DatasetDef<TOutput, Path>;
  /** Dependencies: all trees, datasets and tasks this task depends on */
  readonly deps: Set<DataTreeDef | DatasetDef | TaskDef>;
  /** Task kind: "data" (default), "ui", or future extensions */
  readonly taskKind?: string;
  /** Opaque extension metadata (beast2-encoded) */
  readonly metadata?: Uint8Array;
  /**
   * The typed runner this task resolves to. Undefined for custom-command
   * tasks (customTask) — export serializes that as `runner: none` so
   * orchestrators route it to a full environment.
   */
  readonly runner?: Runner;
  /**
   * Execution environment declaration; resolved to a content-addressed
   * EnvironmentSpec at export time. Undefined ⇒ the stock runtime image.
   */
  readonly environment?: EnvironmentDecl;
}

/**
 * A function definition.
 *
 * Functions are named, typed callables stored in a package and invoked by
 * name with argument values (CLI / HTTP API). Unlike a task, a function is
 * not wired to datasets, is not part of the dataflow graph, and triggers no
 * recomputation. Its result is returned inline to the caller and nothing is
 * persisted.
 *
 * @typeParam Inputs - The East types of the positional parameters
 * @typeParam Output - The East type of the return value
 */
export interface FunctionDef<
  Inputs extends readonly EastType[] = readonly EastType[],
  Output extends EastType = EastType,
> {
  readonly kind: 'function';
  /** Function name (unique within the package) */
  readonly name: string;
  // EastIR/AsyncEastIR constrain their first param to a MUTABLE any[]; a readonly
  // generic is rejected (TS2344). Type the field loosely and cast fn.toIR(),
  // exactly as task.ts does for its function_ir.
  readonly body: EastIR<any, any> | AsyncEastIR<any, any>;
  /** Positional parameter types (the East function's signature) */
  readonly inputTypes: Inputs;
  /** Return type */
  readonly outputType: Output;
  /** Runtime the body runs on; defaults to DEFAULT_RUNNER */
  readonly runner: Runner;
  /**
   * Execution environment declaration; resolved to a content-addressed
   * EnvironmentSpec at export time. Undefined ⇒ the stock runtime image.
   */
  readonly environment?: EnvironmentDecl;
  // NO deps, NO datasets, NO trees — not in the dataflow graph
}

/**
 * A record definition.
 *
 * A record is a root dataset whose writes go through {@link MutationDef
 * mutations} rather than blind replace. It *is a* {@link DatasetDef} (so it is
 * accepted everywhere a dataset is — task inputs, `e3.ui` reads — and flows
 * through the structure/ref/deploy machinery), mounted at `.records.${name}`
 * with `writable: false` so raw `e3 set` is rejected. The required initial
 * value rides `DatasetDef.default`; deploy mints the genesis commit from it.
 *
 * @typeParam T - The East type of the record state
 */
export interface RecordDef<T extends EastType = EastType, Path extends TreePath = TreePath>
  extends DatasetDef<T, Path> {
  /** Discriminant distinguishing a record from a plain dataset. */
  readonly recordKind: 'record';
  /** Mutations that may write this record, by name. */
  readonly mutations: Record<string, MutationDef>;
  /** Secondary indexes over this record, by name. */
  readonly indexes: Record<string, RecordIndexDef>;
}

/**
 * A secondary index over a record — a second canonical collection whose sort
 * order IS a query order.
 *
 * A record is paged and patched in its primary key order and nothing else, but
 * the views over one have more than one order: by an attribute of the row, by
 * a related entity a row names many of, by time across every key. An index
 * closes that without a new storage structure — it is a collection
 * `Dict<{ik, k}, P>` stored as a segment manifest exactly like the primary,
 * maintained inside the same commit, and read with the same paging machinery.
 *
 * Passed to `e3.package` like a mutation; it is collected onto its record.
 *
 * @typeParam Name - The index name (literal type)
 * @typeParam T - The owning record's state type
 * @typeParam IK - The index key an entry sorts under
 * @typeParam P - The covering projection's type (`NullType` when there is none)
 */
export interface RecordIndexDef<
  Name extends string = string,
  T extends EastType = EastType,
  IK extends EastType = EastType,
  P extends EastType = EastType,
> {
  readonly kind: 'recordIndex';
  /** Index name — unique on the record, and never `primary`, which names the
   *  record's own collection wherever an index is selected. */
  readonly name: Name;
  /** The record this index is over. */
  readonly record: RecordDef<T>;
  /** `(K, V) -> IK`, or `(K, V) -> Set<IK>` when {@link multi}. Kept as the
   *  expression so export can compose it into the generated programs. */
  readonly keyFn: CallableFunctionExpr<any, any>;
  /** `(K, V) -> P`, the covering projection; absent when the index carries no
   *  value. */
  readonly valueFn?: CallableFunctionExpr<any, any>;
  /** Declared with `keys` rather than `key`: one entry per element of the
   *  returned set, so a row naming five resources appears under five keys. */
  readonly multi: boolean;
  /** `IK`. */
  readonly keyType: IK;
  /** `P`; `NullType` when the index carries no value. */
  readonly valueType: P;
  /** Runtime the index's functions run on; defaults to DEFAULT_RUNNER. */
  readonly runner: Runner;
}

/**
 * A mutation definition — the write half of the function machinery (CQRS;
 * {@link FunctionDef} is the read half).
 *
 * A mutation is a pure East reducer `(State, ...Args) => State` that runs
 * server-side in a compare-and-swap retry loop. Its output type is the owning
 * record's type, so there is no separate return type. Passed to `e3.package`
 * like a function; it is collected onto its record.
 *
 * @typeParam Name - The mutation name (literal type)
 * @typeParam T - The owning record's state type
 * @typeParam Args - The EXTRA positional parameter types (after the state)
 */
export interface MutationDef<
  Name extends string = string,
  T extends EastType = EastType,
  Args extends readonly EastType[] = readonly EastType[],
> {
  readonly kind: 'mutation';
  /** Mutation name (unique within the owning record) — a literal type so
   *  consumers (e.g. `Record.bind`) can key a typed handle field by it. */
  readonly name: Name;
  /** The record this mutation writes. */
  readonly record: RecordDef<T>;
  /** Which write form this is: a reducer over the whole state, a body writing
   *  through an `edit` capability, or a client-supplied patch. */
  readonly form: MutationForm;
  // Typed loosely + cast like FunctionDef.body / task function_ir (TS2344 on
  // a readonly first generic param of EastIR).
  /** The author's body; absent for the `patch` form, which has none. */
  readonly body?: EastIR<any, any> | AsyncEastIR<any, any>;
  /** The EXTRA positional parameter types (the state type comes from the record). */
  readonly argTypes: Args;
  /** The body as an expression, kept beside its IR so export can compose it
   *  into the generated program rather than re-deriving it from the IR. */
  readonly fn?: CallableFunctionExpr<any, any>;
  /** Runtime the reducer runs on; defaults to DEFAULT_RUNNER. */
  readonly runner: Runner;
}

/**
 * An item that can be passed to e3.package().
 */
export type PackageItem = DataTreeDef | DatasetDef | TaskDef;

/**
 * Extracts the dataset definitions from a package item (such as an input dataset, or task output)
 */
export type DatasetsOf<Item extends PackageItem | PackageDef<any>> =
  Item extends PackageDef<infer Ds> ? Ds :
  Item extends DatasetDef<infer T, infer P> ? DatasetAtPath<P, T> :
  Item extends TaskDef<infer T, infer P> ? DatasetAtPath<P, T> :
  Item extends DataTreeDef ? unknown :
  never;

export type DatasetAtPath<Path extends TreePath, T extends EastType, FullPath extends TreePath = Path> =
  Path extends [infer First, ...infer Rest extends TreePath] ?
    First extends variant<"field", infer Name extends string> ?
      { [K in Name]: DatasetAtPath<Rest, T, FullPath> }
      : never
  : DatasetDef<T, FullPath>

/** Convert a union of types to their intersection (distributed conditional trick). */
type UnionToIntersection<U> =
  (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** Merge all Datasets from the listed package items.
 *
 * Uses `TItems[number]` to derive the union of element types in O(1) recursion,
 * then intersects via `UnionToIntersection`. Avoids deep recursive intersections
 * that hit TS2589 at large item counts (e.g. 100+ tasks in one package).
 *
 * For non-tuple arrays (e.g. `TaskDef[]` from a spread), `TItems[number]` is the
 * element type and `DatasetsOf` falls through to its non-tuple-path branch.
 * The empty-tuple case widens to `Record<string, unknown>`.
 */
export type MergeDatasets<TItems extends (PackageItem | PackageDef<any>)[]> =
  TItems extends readonly [] ? Record<string, unknown>
  : UnionToIntersection<DatasetsOf<TItems[number]>>;


/**
 * A package definition.
 *
 * Packages bundle datasets and tasks into a deployable unit.
 * Provides discoverable access to contents via typed properties.
 *
 * @typeParam TInputs - Input dataset types
 * @typeParam TOutputs - Output dataset types
 * @typeParam TTasks - Task definitions
 *
 * @example
 * ```ts
 * // Access package contents
 * const inputDataset = pkg.datasets.inputs.myInput;
 * const outputDataset = pkg.datasets.outputs.myOutput;
 * const task = pkg.tasks.myTask;
 * ```
 */
export interface PackageDef<Datasets extends Record<string, any>> {
  readonly kind: 'package';
  /** Package name */
  readonly name: string;
  /** Package version */
  readonly version: string;
  /** Datasets organized by tree (inputs/outputs) */
  readonly datasets: Datasets;
  /** All contents of the package (trees, datasets, tasks) */
  readonly contents: Array<PackageItem>;
  /** Named functions, by name. Functions are not part of `contents` —
   *  they have no deps and never enter the data tree. */
  readonly functions: Record<string, FunctionDef>;
  /** Records, by name, each carrying its assembled mutations. A record's
   *  dataset is also in `contents` (records are datasets); this map is the
   *  separate channel for emitting the RecordObject + MutationObjects. */
  readonly records: Record<string, RecordDef>;
}
