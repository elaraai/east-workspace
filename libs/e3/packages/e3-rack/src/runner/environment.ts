/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { buildEnvironmentLayers, type StorageBackend } from '@elaraai/e3-core';
import { ENV_LAYER_MEDIA_TYPE, envManifestKey, envManifestName, type EnvLayerManifest } from '../server/env-publication.js';

/**
 * What happens to an environment a run's work declares, before a rack is
 * leased the work:
 * - `building`: no layers are kept of it for the platform yet, and the
 *   launching machine installs it for the platform and packs it;
 * - `built`: it did, in `ms`: `layers` layers of `bytes` bytes in all, `fresh`
 *   of them new to the repository.
 *
 * An environment whose layers the repository keeps already says nothing.
 */
export type RackEnvironmentEvent =
  | { kind: 'building'; envHash: string; platform: string }
  | { kind: 'built'; envHash: string; platform: string; ms: number; layers: number; bytes: number; fresh: number };

/** What an environment's layers are built for. */
export interface EnvLayerTarget {
  /** The platform the rack runs environments on, as e3-core names one */
  platform: string;
  /** The tier of the lease that needs them */
  tier: string;
  /** The e3 release the run's work is built with */
  e3Version: string;
}

/**
 * Makes sure a launching machine's repository keeps an environment's layers
 * for a rack's platform, and answers the manifest that names them.
 *
 * @remarks
 * The environment is installed for the platform with the frozen installs a
 * local run uses, and nothing is compiled for it; it is packed as layers and
 * kept under the repository's `rack/env-layers`, where its session serves
 * them to the hub. One build runs at a time for an environment, platform and
 * release; a second run that needs it waits for the first. A repository that
 * keeps the manifest already builds nothing, and no event is told.
 *
 * @param storage - The repository's storage, which holds the environment's
 *   spec and files
 * @param repo - Repository path
 * @param envHash - The environment spec's hash
 * @param target - The platform, the tier and the e3 release
 * @param onEvent - Told a build starts, and what it came to
 * @returns The manifest
 * @throws {EnvironmentTargetRefused} For an environment no install makes for
 *   another platform, with its reason (e3-core)
 * @throws {Error} For a failed install
 * @example
 * const manifest = await publishEnvLayers(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28', tier: 'py', e3Version: E3_RACK_VERSION });
 */
export async function publishEnvLayers(
  storage: StorageBackend, repo: string, envHash: string, target: EnvLayerTarget, onEvent?: (event: RackEnvironmentEvent) => void,
): Promise<EnvLayerManifest> {
  const name = envManifestName(envManifestKey(envHash, target.e3Version, target.platform));
  if (name === null) throw new Error(`No environment is published for the e3 release '${target.e3Version}' and the platform '${target.platform}'`);
  const { manifest, built } = await buildEnvironmentLayers(storage, repo, envHash, { platform: target.platform }, name,
    (layers): string => JSON.stringify({
      envHash, e3Version: target.e3Version, baseImage: `rack-tier:${target.tier}`, baseTier: target.tier,
      layers: layers.map((layer) => ({ digest: layer.digest, sizeBytes: layer.sizeBytes, mediaType: ENV_LAYER_MEDIA_TYPE })),
    } satisfies EnvLayerManifest),
    { onBuilding: () => onEvent?.({ kind: 'building', envHash, platform: target.platform }) });
  if (built !== null) {
    onEvent?.({ kind: 'built', envHash, platform: target.platform, ms: built.ms, layers: built.layers.length,
      bytes: built.layers.reduce((sum, layer) => sum + layer.sizeBytes, 0), fresh: built.fresh });
  }
  return JSON.parse(manifest) as EnvLayerManifest;
}
