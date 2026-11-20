/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { buildEnvironmentLayers, environmentFitsTier, type StorageBackend, type TierManifest } from '@elaraai/e3-core';
import { ENV_LAYER_MEDIA_TYPE, envManifestKey, envManifestName, type EnvLayerManifest, type EnvLayerOver } from '../server/env-publication.js';

/**
 * What happens to an environment a run's work declares, before a rack is
 * leased the work:
 * - `building`: no layers are kept of it for the platform yet, and the
 *   launching machine installs it for the platform and packs it: over the
 *   tier `over` names, when it is built over one;
 * - `built`: it did, in `ms`: `layers` layers of `bytes` bytes in all, `fresh`
 *   of them new to the repository; built over a tier, `fromTier` of its
 *   packages were left to the tier's image: the distributions it holds the
 *   same, or East's node packages it holds and what only they need.
 *
 * An environment whose layers the repository keeps already says nothing.
 */
export type RackEnvironmentEvent =
  | { kind: 'building'; envHash: string; platform: string; over?: string }
  | { kind: 'built'; envHash: string; platform: string; ms: number; layers: number; bytes: number; fresh: number; over?: string; fromTier?: number };

/** What an environment's layers are built for. */
export interface EnvLayerTarget {
  /** The platform the rack runs environments on, as e3-core names one */
  platform: string;
  /** The tier of the lease that needs them */
  tier: string;
  /** The e3 release the run's work is built with */
  e3Version: string;
  /**
   * The image of {@link tier} a rack boots the environment over, by its
   * manifest and the manifest's digest: the layers are then built over it,
   * when the environment fits it (e3-core's `environmentFitsTier`), and
   * whole otherwise.
   */
  over?: { digest: string; manifest: TierManifest };
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
 * Given the image of the tier a rack boots it over, an environment that fits
 * it is built over it: a python environment whose lock takes that image's
 * Python, without an interpreter and without each distribution the image
 * holds the same; a node one that npm locked, over an image that holds
 * East's node packages, without those its lock resolved from the registry
 * at the versions the image holds, and what only they need. Its manifest
 * says so (`over`), under a key of its own, and a rack composes it only over
 * that image. Any other environment is built whole, as for a rack that names
 * no image.
 *
 * @param storage - The repository's storage, which holds the environment's
 *   spec and files
 * @param repo - Repository path
 * @param envHash - The environment spec's hash
 * @param target - The platform, the tier, the e3 release, and the tier's
 *   image when the rack names it
 * @param onEvent - Told a build starts, and what it came to
 * @param signal - Ends a wait for another build of the same layers: a run
 *   that is stopped stops waiting
 * @returns The manifest: with `over`, when the layers were built over the tier
 * @throws {EnvironmentTargetRefused} For an environment no install makes for
 *   another platform, with its reason (e3-core)
 * @throws {Error} For a failed install
 * @example
 * const manifest = await publishEnvLayers(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28', tier: 'py', e3Version: E3_RACK_VERSION });
 */
export async function publishEnvLayers(
  storage: StorageBackend, repo: string, envHash: string, target: EnvLayerTarget, onEvent?: (event: RackEnvironmentEvent) => void,
  signal?: AbortSignal,
): Promise<EnvLayerManifest> {
  // Over the tier's image only an environment that fits it: any other is
  // built whole, once, under the key every rack of the platform shares
  const tier = target.over !== undefined && await environmentFitsTier(storage, repo, envHash, target.over.manifest) ? target.over : undefined;
  const over: EnvLayerOver | undefined = tier === undefined ? undefined : { tier: target.tier, manifest: tier.digest };
  const name = envManifestName(envManifestKey(envHash, target.e3Version, target.platform, over));
  if (name === null) throw new Error(`No environment is published for the e3 release '${target.e3Version}' and the platform '${target.platform}'`);
  const said = { envHash, platform: target.platform, ...(over !== undefined && { over: over.tier }) };
  const { manifest, built } = await buildEnvironmentLayers(storage, repo, envHash, { platform: target.platform, ...(tier !== undefined && { over: tier.manifest }) }, name,
    (layers): string => JSON.stringify({
      envHash, e3Version: target.e3Version, baseImage: `rack-tier:${target.tier}`, baseTier: target.tier,
      layers: layers.map((layer) => ({ digest: layer.digest, sizeBytes: layer.sizeBytes, mediaType: ENV_LAYER_MEDIA_TYPE })),
      ...(over !== undefined && { over }),
    } satisfies EnvLayerManifest),
    { onBuilding: () => onEvent?.({ kind: 'building', ...said }), ...(signal !== undefined && { signal }) });
  if (built !== null) {
    onEvent?.({ kind: 'built', ...said, ms: built.ms, layers: built.layers.length,
      bytes: built.layers.reduce((sum, layer) => sum + layer.sizeBytes, 0), fresh: built.fresh, ...(built.fromTier !== null && { fromTier: built.fromTier }) });
  }
  return JSON.parse(manifest) as EnvLayerManifest;
}
