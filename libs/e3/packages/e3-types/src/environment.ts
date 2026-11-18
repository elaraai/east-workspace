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
 * All fields hold object-store hashes, never inline file contents: each names
 * an object holding the file's bytes as a beast2 Blob, which rides the
 * content-addressed object store and transfer machinery.
 */

import {
  ArrayType, OptionType, StringType, StructType, ValueTypeOf, VariantType, decodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue,
  type EastTypeValue,
} from '@elaraai/east';

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
 * A Python **workspace-member** environment (a uv workspace).
 *
 * Where {@link PythonEnvironmentType} captures one self-contained project,
 * whose locked dependencies are all its own, this captures members of a
 * workspace: the workspace root's manifest and lock, which pin everything,
 * and the code of exactly the members the environment is of and the local
 * packages they depend on. Materialized by installing, from the root lock,
 * the third-party dependencies of those members alone — what `uv export
 * --frozen --no-default-groups --package <member>` lists — then the
 * distributions `requires` names, then the members' own sdists. Nothing else
 * the workspace root or another member depends on is installed, and none of
 * a member's development groups.
 *
 * @remarks
 * - `pyproject`: object hash of the workspace **root** `pyproject.toml` blob.
 * - `lock`: object hash of the **root** `uv.lock` blob.
 * - `subjects`: the members the environment is of, by the names the lock
 *   gives them, sorted: a task's runner names one or more as its custom
 *   platform packages.
 * - `sdists`: the source distributions of the subjects and of every local
 *   package they depend on, each with its original filename, sorted by it.
 * - `requires`: the lock's registry distributions installed beside the
 *   subjects' own dependencies, sorted: the runtime's (`elaraai-east-py`,
 *   `elaraai-east-py-cli`) and those of the stock platform packages the
 *   task's runner names (`elaraai-east-py-std`), which a workspace commonly
 *   lists on its root alone. Each is named with the extras the workspace
 *   declares it with (`elaraai-east-py-datascience[lightning]`), and
 *   installed at the version the lock pins, with what it and those extras
 *   depend on.
 */
export const WorkspacePythonEnvironmentType = StructType({
  /** Object hash of the workspace root pyproject.toml blob */
  pyproject: StringType,
  /** Object hash of the root uv.lock blob */
  lock: StringType,
  /** The members the environment is of, by the lock's names, sorted */
  subjects: ArrayType(StringType),
  /** The closure's sdist blobs (original filename + object hash), sorted by filename */
  sdists: ArrayType(StructType({ filename: StringType, hash: StringType })),
  /** The lock's registry distributions installed beside the subjects' own, sorted */
  requires: ArrayType(StringType),
});
export type WorkspacePythonEnvironmentType = typeof WorkspacePythonEnvironmentType;
export type WorkspacePythonEnvironment = ValueTypeOf<typeof WorkspacePythonEnvironmentType>;

/**
 * An execution environment specification.
 *
 * Stored beast2-encoded in the object store; the **environment hash** is the
 * object hash of the encoded spec. A task/function with no environment
 * (`none`) runs on the stock runtime image as today.
 *
 * @remarks
 * A spec is package-borne: an export writes it, at the type of the e3 that
 * exported the package. It is read at this type alone
 * ({@link decodeEnvironmentSpec}): a spec an earlier release wrote, of a type
 * with other cases, is refused, and its package exported again
 * (`docs/conventions/WIRE_MIGRATION.md`). So a case added here changes the
 * bytes, and the hash, of every spec an export writes after it.
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
  /** Python workspace-member environment (a uv workspace) */
  workspace_python: WorkspacePythonEnvironmentType,
});
export type EnvironmentSpecType = typeof EnvironmentSpecType;
export type EnvironmentSpec = ValueTypeOf<typeof EnvironmentSpecType>;

const ENVIRONMENT_SPEC_TYPE = toEastTypeValue(EnvironmentSpecType);
const decodeSpec = decodeBeast2For(EnvironmentSpecType);

/** The names of this release's cases of a spec. */
const SPEC_CASES: ReadonlySet<string> = new Set(Object.keys(EnvironmentSpecType.cases));

/**
 * Decodes an environment's spec object, as this release writes it.
 *
 * @remarks
 * Whatever reads a spec reads it here, so a spec of another type is refused in
 * one set of words wherever it is read, by its type, before it is read. The
 * spec's type grows by cases, so the refusal names the fix by its cases:
 * - each a case this release names: an earlier SDK wrote it, of a type with
 *   fewer cases, which would decode at this one still; its package is
 *   exported again, as one whose file an older SDK stored raw is;
 * - a case this release does not name: a later SDK wrote it, which this
 *   release cannot read; e3 is upgraded to the release that exported it;
 * - no variant at all, or no beast2: it is no spec.
 *
 * @param data - The object's bytes
 * @param hash - The object's hash, which a refusal names
 * @returns The spec
 * @throws {Error} When the object is not a spec of this release's type, saying
 *   which of the three it is
 * @example
 * ```ts
 * const spec = decodeEnvironmentSpec(await storage.objects.read(repo, envHash), envHash);
 * ```
 */
export function decodeEnvironmentSpec(data: Uint8Array, hash: string): EnvironmentSpec {
  let type: EastTypeValue | null = null;
  try {
    type = readBeast2Type(data);
  } catch {
    // Not beast2 at all
  }
  if (type !== null && isTypeValueEqual(type, ENVIRONMENT_SPEC_TYPE)) return decodeSpec(data);
  if (type === null || type.type !== 'Variant' || type.value.length === 0) {
    throw new Error(`the object ${hash} is not an environment's spec`);
  }
  if (type.value.every(({ name }) => SPEC_CASES.has(name))) {
    throw new Error(`the environment ${hash} was exported by an older e3 SDK — re-export its package with the current one`);
  }
  const unknown = type.value.map(({ name }) => name).filter((name) => !SPEC_CASES.has(name));
  throw new Error(`the environment ${hash} was exported by a newer e3 SDK than this one, as its ${unknown.join(', ')} says — ` +
    'upgrade e3 to the release that exported its package');
}

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
    case 'workspace_python':
      return [spec.value.pyproject, spec.value.lock, ...spec.value.sdists.map((s) => s.hash)];
  }
}
