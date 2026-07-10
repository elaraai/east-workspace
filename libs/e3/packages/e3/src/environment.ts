/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution environment declarations for tasks and functions — the pure half.
 *
 * An environment declaration names the project whose dependency closure a
 * task/function needs at execution time — a Python (uv) project directory, a
 * Node project directory, or a pinned container image. Declarations are
 * validated at definition time (here — cheap, filesystem-free checks only)
 * and resolved to a content-addressed `EnvironmentSpec` at package export
 * time by {@link captureEnvironment} in `./environment-capture.js`.
 *
 * This module is deliberately free of `node:*` imports: it sits on the
 * browser-safe `@elaraai/e3/browser` surface via `task.ts` / `function.ts`
 * (definition-time validation), per the #99 guarantee that UI libraries can
 * import the authoring builders without dragging Node built-ins into a
 * browser bundle. Everything that touches the filesystem or spawns processes
 * lives in `environment-capture.ts`, which only the Node-only main entry
 * re-exports.
 */

/**
 * An execution environment declaration on `e3.task` / `e3.function`.
 *
 * - `python`: `project` is a directory containing `pyproject.toml` and
 *   `uv.lock`. At export the manifest + lockfile are captured and
 *   `uv build --sdist` packages the project itself.
 * - `node`: `project` is a directory containing `package.json` and a
 *   lockfile. At export the manifest + lockfile are captured and `npm pack`
 *   packages the project itself.
 * - `image`: a full immutable digest reference (`repo@sha256:<64 hex>`);
 *   validated at definition time — mutable tags are rejected.
 * - `tools`: `files` names ≥1 prebuilt file (a compiled binary, or any
 *   artifact) to capture as content-addressed blobs and place on the
 *   runner's PATH. e3 never builds these — the developer builds them
 *   however they like. The C story: embed east-c in your binary, run it via
 *   a `custom` runner, and attach `{ tools: { files: ['./build/runner'] } }`
 *   so a rebuild changes the environment hash and re-runs its tasks.
 *
 * Relative `project`/`files` paths resolve against the exporting process's
 * working directory.
 */
export type EnvironmentDecl =
  | { python: { project: string } }
  | { node: { project: string } }
  | { image: { digest: string } }
  | { tools: { files: [string, ...string[]] } };

const IMAGE_DIGEST_RE = /@sha256:[0-9a-f]{64}$/;

/**
 * Validates an environment declaration at definition time.
 *
 * Cheap, filesystem-free checks only — everything that needs the project on
 * disk happens at export time in {@link captureEnvironment}.
 *
 * @param decl - The declaration to validate
 * @param owner - The declaring task/function name, for error messages
 * @throws {Error} if an `image` reference is not a full sha256 digest, or a
 *   `tools` declaration is empty, names a directory, or has duplicate basenames
 */
export function validateEnvironmentDecl(decl: EnvironmentDecl, owner: string): void {
  if ('image' in decl) {
    if (!IMAGE_DIGEST_RE.test(decl.image.digest)) {
      throw new Error(
        `Environment for '${owner}': image reference must be a full digest ` +
        `('repo@sha256:<64 hex chars>'), got '${decl.image.digest}' — tags are mutable and ` +
        `would let the environment drift under a fixed hash`,
      );
    }
  } else if ('tools' in decl) {
    const files = decl.tools.files;
    if (files.length === 0) {
      throw new Error(`Environment for '${owner}': tools.files must name at least one file`);
    }
    const basenames = new Set<string>();
    for (const f of files) {
      if (f.endsWith('/') || f.endsWith('\\')) {
        throw new Error(`Environment for '${owner}': tools file '${f}' looks like a directory — list files individually`);
      }
      // The env has one flat bin dir; case-insensitive because win32/macOS
      // filesystems collapse case.
      const base = f.replace(/[/\\]+$/, '').split(/[/\\]/).pop()!.toLowerCase();
      if (basenames.has(base)) {
        throw new Error(`Environment for '${owner}': tools files collide on basename '${base}' — each captured file needs a distinct name`);
      }
      basenames.add(base);
    }
  }
}
