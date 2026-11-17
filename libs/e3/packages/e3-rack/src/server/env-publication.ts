/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An environment published as layers a rack composes over a tier's image.
 *
 * A deployment publishes an environment as the layers of an image it built
 * from the tier's. A launching machine publishes one with no image and no
 * registry: it installs the environment for the rack's platform, packs it as
 * layers of its own (e3-core's `buildEnvironmentLayers`), and keeps them
 * beside its repository. Both are named by the same manifest, and a rack
 * composes either the same way.
 *
 * A launching machine builds an environment whole, with an interpreter of
 * its own, or over the tier a rack boots it over, without what that tier's
 * image holds: the manifest says which (`over`), and the two are kept under
 * keys of their own.
 */

/** The media type of each layer of an environment: a gzip tar. */
export const ENV_LAYER_MEDIA_TYPE = 'application/vnd.oci.image.layer.v1.tar+gzip';

/** One OCI layer of a published environment. */
export interface EnvLayerDescriptor {
  /** Registry digest (`sha256:…`) — the content address of the blob. */
  digest: string;
  sizeBytes: number;
  mediaType: string;
}

/** The tier an environment's layers were built over. */
export interface EnvLayerOver {
  /** The tier, by the rack tier vocabulary's word */
  tier: string;
  /** The digest of the tier image's manifest (`sha256:<hex>`): a rack
   *  composes the layers only over a tier whose image has that manifest */
  manifest: string;
}

/** The manifest published beside the layer blobs (JSON, small). */
export interface EnvLayerManifest {
  envHash: string;
  e3Version: string;
  /** The tier base image ref the env was built FROM; `rack-tier:<tier>` for
   *  one a launching machine packed, which was built from no image. */
  baseImage: string;
  /** The rack tier vocabulary word derived from the base image; for one a
   *  launching machine packed, the tier of the lease it was first packed for.
   *  A rack composes over the tier its lease names. */
  baseTier: string;
  /** The env's OWN layers (delta above the base), in application order. */
  layers: EnvLayerDescriptor[];
  /** The tier a launching machine built the layers over, when it did: they
   *  hold no interpreter and nothing that tier's image holds. Absent, they
   *  are the whole environment. */
  over?: EnvLayerOver;
}

/** Cloud-side "this env is rack-fetchable" record (NEW row key — stored
 *  structs cannot grow fields, so this is its own kind). */
export interface EnvIndexRecord {
  envHash: string;
  e3Version: string;
  baseImage: string;
  baseTier: string;
  /** Object key of the manifest in the data bucket. */
  manifestKey: string;
  layerCount: number;
  publishedAtMs: number;
}

/** Finds environment publications compatible with a runtime release. */
export interface EnvIndexStore {
  /** Publishes the metadata for an available environment. */
  put(record: EnvIndexRecord): Promise<void>;
  /** Reads one environment publication for the requested release. */
  get(envHash: string, e3Version: string): Promise<EnvIndexRecord | null>;
}

/** Data-bucket key of a published layer blob (content-addressed, shared
 *  across envs — identical layers publish once). */
export function envLayerBlobKey(digest: string): string {
  return `env-layers/blobs/${digest.replace(':', '-')}`;
}

/**
 * Key of the manifest of an environment's layers, as built with an e3 release
 * for a platform: beside its blobs. A launching machine keeps both under its
 * repository's `rack/` directory, by these keys. Layers built over a tier are
 * kept under a key that names the tier and its image's manifest, so another
 * image of the tier is another build.
 *
 * @param envHash - The environment spec's hash
 * @param e3Version - The e3 release the layers were built with
 * @param platform - The platform they were installed for, as e3-core names
 *   one (`x86_64-manylinux_2_28`)
 * @param over - The tier they were built over, when they were
 * @returns The key
 * @example
 * const key = envManifestKey(envHash, '1.0.108', 'x86_64-manylinux_2_28');
 * const small = envManifestKey(envHash, '1.0.108', 'x86_64-manylinux_2_28', { tier: 'py-datascience', manifest: digest });
 */
export function envManifestKey(envHash: string, e3Version: string, platform: string, over?: EnvLayerOver): string {
  const tier = over === undefined ? '' : `-${over.tier}-${over.manifest.replace(/^sha256:/, '').slice(0, 12)}`;
  return `env-layers/manifests/${envHash}-${e3Version}-${platform}${tier}.json`;
}

/**
 * A manifest's file name, from its key: what a repository keeps it by.
 *
 * @param manifestKey - A key {@link envManifestKey} made
 * @returns The name, or null for a key that is not a manifest's
 */
export function envManifestName(manifestKey: string): string | null {
  return /^env-layers\/manifests\/([^/]+\.json)$/.exec(manifestKey)?.[1] ?? null;
}

/**
 * A layer's digest, from its blob's key.
 *
 * @param blobKey - A key {@link envLayerBlobKey} made
 * @returns The digest, `sha256:<hex>`, or null for a key that is not a layer's
 */
export function envLayerDigest(blobKey: string): string | null {
  const hex = /^env-layers\/blobs\/sha256-([0-9a-f]{64})$/.exec(blobKey)?.[1];
  return hex === undefined ? null : `sha256:${hex}`;
}
