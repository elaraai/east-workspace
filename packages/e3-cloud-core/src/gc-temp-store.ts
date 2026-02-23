/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for GC temporary storage.
 *
 * The mark and sweep phases need to share a reachable set between
 * Lambda invocations. On AWS this is S3; on Azure it could be Blob Storage.
 */
export interface GcTempStore {
  /** Write the reachable hash set for a GC run, returns opaque key for retrieval */
  writeReachableSet(gcId: string, hashes: Set<string>): Promise<string>;
  /** Read the reachable hash set back */
  readReachableSet(key: string): Promise<Set<string>>;
  /** Delete temp files for a GC run, returns number of files deleted */
  cleanupTempFiles(gcId: string): Promise<number>;
}
