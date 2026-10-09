/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/** One OCI layer of a published environment. */
export interface EnvLayerDescriptor {
  /** Registry digest (`sha256:…`) — the content address of the blob. */
  digest: string;
  sizeBytes: number;
  mediaType: string;
}

/** The manifest published beside the layer blobs (JSON, small). */
export interface EnvLayerManifest {
  envHash: string;
  e3Version: string;
  /** The tier base image ref the env was built FROM. */
  baseImage: string;
  /** The rack tier vocabulary word derived from the base image. */
  baseTier: string;
  /** The env's OWN layers (delta above the base), in application order. */
  layers: EnvLayerDescriptor[];
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
