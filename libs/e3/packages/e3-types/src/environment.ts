/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution environment types for e3.
 *
 * An environment spec describes everything a worker needs to materialize the
 * runtime environment a task or function executes in — beyond the stock
 * runtime image. It is stored as a content-addressed object; tasks and
 * functions reference it by hash (`environment` field), so identical
 * environments dedupe and the environment hash transitively folds the user's
 * implementation code (via lockfile + sdist/tarball hashes) into execution
 * cache identity.
 *
 * All fields hold object-store hashes, never inline file contents: the blobs
 * ride the existing content-addressed object store and transfer machinery.
 */

import { ArrayType, OptionType, StringType, StructType, ValueTypeOf, VariantType } from '@elaraai/east';

/**
 * A Python (uv) project environment.
 *
 * Materialized by creating a venv from the locked dependency set
 * (`uv sync --frozen`) and installing the project's own sdists into it.
 *
 * @remarks
 * - `pyproject`: object hash of the project's `pyproject.toml` blob.
 * - `lock`: object hash of the `uv.lock` blob — pins the full closure.
 * - `sdists`: the project's own source distributions (`uv build --sdist`) —
 *   the user's platform-function implementation code — installed in order
 *   after the sync. Each entry carries the original filename because
 *   Python installers derive the package name from `name-version.tar.gz`
 *   and reject a renamed file.
 */
export const PythonEnvironmentType = StructType({
  /** Object hash of the pyproject.toml blob */
  pyproject: StringType,
  /** Object hash of the uv.lock blob */
  lock: StringType,
  /** Project sdist blobs (original filename + object hash), in install order */
  sdists: ArrayType(StructType({ filename: StringType, hash: StringType })),
});
export type PythonEnvironmentType = typeof PythonEnvironmentType;
export type PythonEnvironment = ValueTypeOf<typeof PythonEnvironmentType>;

/**
 * A Node (npm/pnpm) project environment.
 *
 * Materialized by installing the locked dependency set and then the
 * project's own packed tarballs (`npm pack`).
 *
 * @remarks
 * - `packageJson`: object hash of the project's `package.json` blob.
 * - `lock`: object hash of the lockfile blob (`package-lock.json` or
 *   `pnpm-lock.yaml`).
 * - `tarballs`: object hashes of `npm pack` tarballs of the project's own
 *   package(s), installed in order.
 */
export const NodeEnvironmentType = StructType({
  /** Object hash of the package.json blob */
  packageJson: StringType,
  /** Object hash of the lockfile blob */
  lock: StringType,
  /** Object hashes of npm-pack tarball blobs, in install order */
  tarballs: ArrayType(StringType),
});
export type NodeEnvironmentType = typeof NodeEnvironmentType;
export type NodeEnvironment = ValueTypeOf<typeof NodeEnvironmentType>;

/**
 * A user-controlled container image environment.
 *
 * The catch-all tier for CUDA bases, system libraries, or custom native
 * runtimes. Executed by running the task's argv inside the referenced image.
 *
 * @remarks
 * `digest` must be a full immutable digest reference
 * (`repo@sha256:<64 hex>`); mutable tags are rejected at definition time so
 * the environment hash cannot silently drift.
 */
export const ImageEnvironmentType = StructType({
  /** Full image digest reference: `repo@sha256:<64 hex chars>` */
  digest: StringType,
});
export type ImageEnvironmentType = typeof ImageEnvironmentType;
export type ImageEnvironment = ValueTypeOf<typeof ImageEnvironmentType>;

/**
 * A prebuilt-file ("tools") environment for C and custom runners.
 *
 * e3 never builds anything for this kind: the developer builds their binary
 * (or any prebuilt artifact) however they like, and capture folds the named
 * files' bytes into the environment hash and materializes them onto the
 * runner's PATH. Rebuilding a captured file changes its blob hash → the
 * environment hash → the tasks that use it re-run. This closes the
 * pre-existing hole where a custom-runner binary resolved from PATH was
 * never part of the cache key, so a rebuild silently served stale outputs.
 *
 * @remarks
 * - `files`: the captured files, sorted by `path` so capture order never
 *   affects the environment hash.
 *   - `path`: environment-dir-relative POSIX path; v1 writers emit
 *     `bin/<basename>` (materialization writes it there and adds `bin` to
 *     PATH). Validated at materialization: no absolute paths, no `..`, no
 *     empty segments.
 *   - `hash`: object hash of the file's bytes. No mode is stored:
 *     materialization always applies a fixed mode, so an exec-bit-only
 *     change does not alter the environment yet also cannot go stale.
 */
export const ToolsEnvironmentType = StructType({
  /** Captured files (env-relative path + object hash), sorted by path */
  files: ArrayType(StructType({ path: StringType, hash: StringType })),
});
export type ToolsEnvironmentType = typeof ToolsEnvironmentType;
export type ToolsEnvironment = ValueTypeOf<typeof ToolsEnvironmentType>;

/**
 * A Node **workspace-member** environment (npm or pnpm workspaces).
 *
 * Where {@link NodeEnvironmentType} captures one self-contained project,
 * this captures one member of a workspace together with the transitive
 * closure of the local workspace packages it depends on — so editing a
 * member's code re-runs only the environments whose closure contains it.
 * Materialized by reconstructing a minimal workspace of exactly the closure
 * members and running the frozen install against the verbatim root lock.
 *
 * @remarks
 * - `packageJson`: object hash of the workspace **root** `package.json` blob.
 * - `lock`: object hash of the **root** lockfile blob (content-sniffed as
 *   today; npm in v1, pnpm once the pnpm capture path ships).
 * - `config`: pnpm only — object hash of the capture-synthesized
 *   `pnpm-workspace.yaml` blob; `none` for npm.
 * - `subject`: workspace-relative POSIX path of the environment's own
 *   member. Must satisfy `members.some((m) => m.path === subject)` — this is
 *   enforced at capture and re-validated at materialization (BEAST2 typed
 *   decode is structural only and cannot check it).
 * - `members`: the dependency closure sorted by `path`; each carries its
 *   package `name` (read from the member's `package.json` at capture) and
 *   the object `hash` of its `npm pack` tarball.
 */
export const WorkspaceNodeEnvironmentType = StructType({
  /** Object hash of the workspace root package.json blob */
  packageJson: StringType,
  /** Object hash of the root lockfile blob */
  lock: StringType,
  /** pnpm only: object hash of the synthesized pnpm-workspace.yaml; none for npm */
  config: OptionType(StringType),
  /** Workspace-relative POSIX path of this environment's own member */
  subject: StringType,
  /** Dependency closure (path + package name + tarball hash), sorted by path */
  members: ArrayType(StructType({ path: StringType, name: StringType, tarball: StringType })),
});
export type WorkspaceNodeEnvironmentType = typeof WorkspaceNodeEnvironmentType;
export type WorkspaceNodeEnvironment = ValueTypeOf<typeof WorkspaceNodeEnvironmentType>;

/**
 * An execution environment specification.
 *
 * Stored beast2-encoded in the object store; the **environment hash** is the
 * object hash of the encoded spec. A task/function with no environment
 * (`none`) runs on the stock runtime image as today.
 *
 * @remarks
 * BEAST2 encodes a variant's tag as the index of its case in the
 * **alphabetically sorted** case list, so the case order is load-bearing: a
 * repo persists specs by that order, and reordering the cases in a later
 * edit would re-tag every case after the insertion point and mis-decode
 * already-stored specs. New cases must therefore be added so the sorted
 * order only grows at the end (`tools` and `workspace_node` sort after the
 * original three). The frozen-order guard test in `environment.spec.ts`
 * turns an accidental reorder into a red test.
 */
export const EnvironmentSpecType = VariantType({
  /** Python (uv) project environment */
  python: PythonEnvironmentType,
  /** Node project environment */
  node: NodeEnvironmentType,
  /** Custom container image environment */
  image: ImageEnvironmentType,
  /** Prebuilt-file environment for C / custom runners */
  tools: ToolsEnvironmentType,
  /** Node workspace-member environment (npm/pnpm workspaces) */
  workspace_node: WorkspaceNodeEnvironmentType,
});
export type EnvironmentSpecType = typeof EnvironmentSpecType;
export type EnvironmentSpec = ValueTypeOf<typeof EnvironmentSpecType>;

/**
 * Lists the object-store hashes an environment spec references.
 *
 * Every reachability walker (package export closure, GC) must include these
 * so environment blobs transfer with the package and survive collection.
 *
 * @param spec - The environment spec to walk
 * @returns The referenced blob hashes (empty for `image` environments)
 */
export function environmentSpecObjectHashes(spec: EnvironmentSpec): string[] {
  switch (spec.type) {
    case 'python':
      return [spec.value.pyproject, spec.value.lock, ...spec.value.sdists.map((s) => s.hash)];
    case 'node':
      return [spec.value.packageJson, spec.value.lock, ...spec.value.tarballs];
    case 'image':
      return [];
    case 'tools':
      return spec.value.files.map((f) => f.hash);
    case 'workspace_node':
      return [
        spec.value.packageJson,
        spec.value.lock,
        ...(spec.value.config.type === 'some' ? [spec.value.config.value] : []),
        ...spec.value.members.map((m) => m.tarball),
      ];
  }
}
