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

import { ArrayType, StringType, StructType, ValueTypeOf, VariantType } from '@elaraai/east';

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
 * An execution environment specification.
 *
 * Stored beast2-encoded in the object store; the **environment hash** is the
 * object hash of the encoded spec. A task/function with no environment
 * (`none`) runs on the stock runtime image as today.
 */
export const EnvironmentSpecType = VariantType({
  /** Python (uv) project environment */
  python: PythonEnvironmentType,
  /** Node project environment */
  node: NodeEnvironmentType,
  /** Custom container image environment */
  image: ImageEnvironmentType,
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
  }
}
