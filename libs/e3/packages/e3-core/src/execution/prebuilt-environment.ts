/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An environment built ahead of the call that declares it, placed where
 * e3-core looks for it.
 *
 * e3-core materializes a declared environment at `<repo>/envs/<hash>`, and
 * takes a directory already there as built (`materializeEnvironment`). A host
 * that holds an environment built before the call — a container image that
 * installed one as it was built, a rack's guest whose image was composed with
 * one — names it in two variables: `E3_BAKED_ENV_HASH`, the environment's
 * hash, and `E3_BAKED_ENV_DIR`, the directory it is in. Before a call that
 * declares that environment, its runner links `<repo>/envs/<hash>` to the
 * directory, and e3-core installs nothing.
 */

import { access, mkdir, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isObjectHash } from '../objects.js';

/** The variable a host names its pre-built environment's hash in. */
export const PREBUILT_ENV_HASH_VAR = 'E3_BAKED_ENV_HASH';

/** The variable a host names its pre-built environment's directory in. */
export const PREBUILT_ENV_DIR_VAR = 'E3_BAKED_ENV_DIR';

/** An environment built ahead of the call that declares it. */
export interface PrebuiltEnvironment {
  /** The environment's hash: the hash of its spec object. */
  readonly hash: string;
  /** The absolute directory it is in. */
  readonly dir: string;
}

/**
 * The environment a host holds pre-built, as its variables name it.
 *
 * @param env - The process's environment variables
 * @returns The pre-built environment, or undefined when the host names none
 * @throws {Error} When only one of the two variables is set, the hash is not
 *   an object hash, or the directory is not absolute: the host was set up
 *   wrongly
 *
 * @example
 * ```ts
 * const prebuilt = prebuiltEnvironment(process.env);
 * if (prebuilt !== undefined && prebuilt.hash === task.environment) await linkPrebuiltEnvironment(repo, prebuilt);
 * ```
 */
export function prebuiltEnvironment(env: Readonly<Record<string, string | undefined>>): PrebuiltEnvironment | undefined {
  const hash = env[PREBUILT_ENV_HASH_VAR];
  const dir = env[PREBUILT_ENV_DIR_VAR];
  if (hash === undefined && dir === undefined) return undefined;
  if (hash === undefined || dir === undefined) {
    const [set, unset] = hash === undefined ? [PREBUILT_ENV_DIR_VAR, PREBUILT_ENV_HASH_VAR] : [PREBUILT_ENV_HASH_VAR, PREBUILT_ENV_DIR_VAR];
    throw new Error(`${set} is set and ${unset} is not: a pre-built environment is named by both`);
  }
  if (!isObjectHash(hash)) {
    throw new Error(`${PREBUILT_ENV_HASH_VAR} '${hash}' is not an object hash`);
  }
  if (!isAbsolute(dir)) {
    throw new Error(`${PREBUILT_ENV_DIR_VAR} '${dir}' is not an absolute path`);
  }
  return { hash, dir };
}

/**
 * Links the path e3-core materializes an environment at, `<repo>/envs/<hash>`
 * resolved against the working directory, to the directory it was built in
 * ahead of the call.
 *
 * @remarks
 * - What is already at the path is kept: a link an earlier call made, or the
 *   environment built there.
 * - The directory must exist. e3-core takes a link that leads nowhere as an
 *   environment not yet built, and could not then install one in its place.
 * - On Windows the link is a junction, which needs no privilege.
 *
 * @param repo - The repository the call runs for
 * @param prebuilt - The environment built ahead
 * @returns The link's path, absolute, as e3-core names it
 * @throws {Error} When the directory does not exist, or the link cannot be
 *   made
 *
 * @example
 * ```ts
 * await linkPrebuiltEnvironment(repo, { hash: envHash, dir: '/var/task/.e3-env' });
 * const bins = await materializeEnvironment(storage, repo, envHash); // installs nothing
 * ```
 */
export async function linkPrebuiltEnvironment(repo: string, prebuilt: PrebuiltEnvironment): Promise<string> {
  // Where materializeEnvironment looks, named as it names it: an absolute
  // path, whatever the repository's.
  const envDir = resolve(repo, 'envs', prebuilt.hash);
  await access(prebuilt.dir);
  await mkdir(dirname(envDir), { recursive: true });
  try {
    await symlink(prebuilt.dir, envDir, 'junction');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return envDir;
}
