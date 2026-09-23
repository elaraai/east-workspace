/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Low-level tree and dataset operations for e3 repositories.
 *
 * Trees are persistent data structures with structural sharing (like git trees).
 * Each tree node contains DataRefs pointing to either other trees or dataset values.
 *
 * Tree operations require a Structure parameter which describes the shape of the
 * tree node. This enables proper encoding/decoding with the correct StructType
 * and supports future tree types (array, variant, etc.).
 *
 * Workspace operations use per-dataset ref files (DatasetRef) instead of tree
 * traversal. This enables concurrent writes without serialization.
 *
 * Low-level tree read/write operations remain for computing root hashes and
 * for package operations.
 */

import {
  decodeBeast2,
  decodeBeast2For,
  encodeBeast2For,
  printIdentifier,
  readBeast2ExtentsRanged,
  StructType,
  variant,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import { DataRefType, WorkspaceStateType, checkDatasetType, datasetAddress, decodePackageObject, encodeDatasetBlob, isCollectionRoot, manifestByteSize, manifestElementCount, type DataRef, type DatasetRef, type Structure, type TreePath, type VersionVector } from '@elaraai/e3-types';
import { openDatasetObject, readDatasetWhole } from './dataset-open.js';
import { packageRead } from './packages.js';
import {
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceLockError,
  DatasetRefConflictError,
  DatasetTypeMismatchError,
} from './errors.js';

// Bounded retries when a concurrent writer wins the per-path CAS. e3 set is a
// blind replace, so a conflict just means re-read the fresh revision and write
// again; a small cap is plenty since each loser re-attempts immediately.
const MAX_SET_DATASET_RETRIES = 5;
import type { StorageBackend, LockHandle } from './storage/interfaces.js';

/**
 * A tree object: mapping of field names to data references.
 *
 * This is a plain object (not a Map) because tree objects are encoded as
 * StructTypes with known field names derived from the Structure.
 */
export type TreeObject = Record<string, DataRef>;

/**
 * Build the EastType for a tree object based on its structure.
 *
 * For struct trees, creates a StructType with DataRefType for each field.
 * Future: will handle array, variant, and other tree types.
 *
 * @param structure - The structure describing this tree node
 * @returns The EastType for encoding/decoding the tree object
 */
function treeTypeFromStructure(structure: Structure): EastType {
  if (structure.type === 'struct') {
    const fields: Record<string, typeof DataRefType> = {};
    for (const fieldName of structure.value.keys()) {
      fields[fieldName] = DataRefType;
    }
    return StructType(fields);
  } else if (structure.type === 'value') {
    throw new Error('Cannot create tree type for a value structure - this is a dataset, not a tree');
  } else {
    throw new Error(`Unsupported structure type: ${(structure as Structure).type}`);
  }
}

/**
 * Read and decode a tree object from the object store.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - Hash of the tree object
 * @param structure - The structure describing this tree node's shape
 * @returns The decoded tree object (field name -> DataRef)
 * @throws If object not found, structure is not a tree, or decoding fails
 */
export async function treeRead(
  storage: StorageBackend,
  repo: string,
  hash: string,
  structure: Structure
): Promise<TreeObject> {
  const treeType = treeTypeFromStructure(structure);
  const data = await storage.objects.read(repo, hash);
  const decoder = decodeBeast2For(treeType);
  return decoder(Buffer.from(data)) as TreeObject;
}

/**
 * Encode and write a tree object to the object store.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param fields - Object mapping field names to DataRefs
 * @param structure - The structure describing this tree node's shape
 * @returns Hash of the written tree object
 * @throws If structure is not a tree or encoding fails
 */
export async function treeWrite(
  storage: StorageBackend,
  repo: string,
  fields: TreeObject,
  structure: Structure
): Promise<string> {
  const treeType = treeTypeFromStructure(structure);
  const encoder = encodeBeast2For(treeType);
  const data = encoder(fields);
  return storage.objects.write(repo, data);
}

/**
 * Read and decode a dataset value from the object store.
 *
 * The .beast2 format includes type information in the header, so values
 * can be decoded without knowing the schema in advance. A collection stored
 * as a segment manifest is spliced back into one blob first, so the decoded
 * value is the same whichever layout it was written in.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - Hash of the dataset value
 * @returns The decoded value and its type
 * @throws If object not found or not a valid beast2 object
 */
export async function datasetRead(
  storage: StorageBackend,
  repo: string,
  hash: string
): Promise<{ type: EastType; value: unknown }> {
  const data = await readDatasetWhole(storage, repo, hash);
  const result = decodeBeast2(Buffer.from(data));
  return { type: result.type as EastType, value: result.value };
}

/** Whether a dataset root type is a collection (Array/Set/Dict) — the kinds
 *  stored segmented + indexed so the paged read API can seek.
 *
 *  Re-exported from `@elaraai/e3-types`, which is where the rule now lives so
 *  that the package EXPORT path obeys it too (#584). */
export { isCollectionRoot };

/**
 * Encode and write a dataset value to the object store.
 *
 * Collection-rooted values go in as segment objects under a content-defined
 * boundary rule plus a manifest naming them, at every size — so the paged read
 * API decodes only the segments a window touches, and a write that changes one
 * row stores one new segment while the rest deduplicate by hash against what is
 * already there. Non-collection roots keep the whole-value encode.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param value - The value to encode
 * @param type - The East type for encoding (EastType or EastTypeValue)
 * @returns Hash of the written dataset object — the manifest, for a collection
 */
export async function datasetWrite(
  storage: StorageBackend,
  repo: string,
  value: unknown,
  type: EastType | EastTypeValue
): Promise<string> {
  const data = await encodeDatasetBlob(type, value, (bytes) => storage.objects.write(repo, bytes));
  return storage.objects.write(repo, data);
}

// =============================================================================
// High-level Operations (by path) - Package operations using tree traversal
// =============================================================================

/**
 * A dataset leaf as the deployed package's structure describes it.
 */
export interface DatasetLeaf {
  /** The type the dataset declares — what every door checks a write against. */
  readonly type: EastTypeValue;
  /** Whether a set is allowed here (task outputs are not writable). */
  readonly writable: boolean;
  /** `.inputs.table` — how every message names this dataset. */
  readonly address: string;
  /** `inputs/table` — the per-dataset ref file's path. */
  readonly refPath: string;
}

/**
 * Resolve a tree path against a workspace's deployed structure to the dataset
 * leaf it names.
 *
 * @remarks
 * The one navigation every write door shares: it is what makes
 * {@link workspaceSetDataset} and `datasetAdoptFile` agree on the declared
 * type, the writable flag, and the spelling of the path in their errors.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @returns The leaf's declared type, writability and addresses
 * @throws {WorkspaceNotFoundError} If the workspace does not exist
 * @throws {WorkspaceNotDeployedError} If the workspace has no package deployed
 * @throws If the path is empty, invalid, or names a tree rather than a dataset
 */
export async function workspaceResolveDataset(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath
): Promise<DatasetLeaf> {
  if (treePath.length === 0) {
    throw new Error('Cannot address a dataset at root path - root is always a tree');
  }
  const { rootStructure } = await getWorkspaceStructure(storage, repo, ws);

  let currentStructure = rootStructure;
  for (let i = 0; i < treePath.length; i++) {
    const segment = treePath[i]!;
    if (segment.type !== 'field') {
      throw new Error(`Unsupported path segment type: ${segment.type}`);
    }
    if (currentStructure.type !== 'struct') {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      throw new Error(`Cannot descend into non-struct at path '${pathSoFar}'`);
    }
    const childStructure = currentStructure.value.get(segment.value);
    if (!childStructure) {
      const pathSoFar = treePath.slice(0, i).map(s => s.value).join('.');
      const available = Array.from(currentStructure.value.keys()).join(', ');
      throw new Error(`Field '${segment.value}' not found at '${pathSoFar}'. Available: ${available}`);
    }
    currentStructure = childStructure;
  }

  if (currentStructure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  return {
    type: currentStructure.value.type as EastTypeValue,
    writable: currentStructure.value.writable,
    address: datasetAddress(treePath.map(s => s.value)),
    refPath: treePath.map(s => s.value).join('/'),
  };
}

/**
 * Options for setting a workspace dataset.
 */
export interface WorkspaceSetDatasetOptions {
  /**
   * External workspace lock to use. If provided, the caller is responsible
   * for releasing the lock after the operation. If not provided, workspaceSetDataset
   * will acquire and release a lock internally.
   */
  lock?: LockHandle;
}

/**
 * Update a dataset at a path within a workspace.
 *
 * Writes the value to the object store and updates the per-dataset ref file.
 * Uses shared structure lock to allow concurrent writes.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param value - The new value to write
 * @param type - The East type for encoding the value (EastType or EastTypeValue)
 * @param options - Optional settings including external lock
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceSetDataset(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  value: unknown,
  type: EastType | EastTypeValue,
  options: WorkspaceSetDatasetOptions = {}
): Promise<void> {
  if (treePath.length === 0) {
    throw new Error('Cannot set dataset at root path - root is always a tree');
  }

  // Acquire lock if not provided externally
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, ws, variant('dataset_write', null), { mode: 'shared' });
    if (!lock) {
      const state = await storage.locks.getState(repo, ws);
      throw new WorkspaceLockError(ws, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
    }
  }
  try {
    const leaf = await workspaceResolveDataset(storage, repo, ws, treePath);

    // Check writable flag
    if (!leaf.writable) {
      const pathStr = treePath.map(s => s.value).join('.');
      throw new Error(`Dataset at '${pathStr}' is not writable`);
    }

    // The type the caller encodes with must be the type the dataset declares.
    // Exact equality, not assignability: the runner decodes the object BY the
    // declared type and beast2 decoding is type-directed, so a merely
    // assignable blob still decodes wrong — and it would do so inside the
    // consuming task, naming neither this dataset nor the field that moved.
    // Checked before `datasetWrite`, so a refusal leaves the store untouched.
    const mismatch = checkDatasetType(`dataset '${leaf.address}'`, 'the value', leaf.type, type);
    if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);

    // Write the new dataset value to object store
    const newValueHash = await datasetWrite(storage, repo, value, type);

    const refPath = leaf.refPath;

    // A root input references its own current value in its version vector. The
    // dataflow reconstructs this from the value hash, so populating it here is
    // additive — but it finally writes the self-entry the reactive spec tracks.
    const selfKeypath = treePath.map(s => '.' + printIdentifier(s.value)).join('');
    const datasetRef: DatasetRef = variant('value', {
      hash: newValueHash,
      versions: new Map([[selfKeypath, newValueHash]]),
    });

    // Conditional write so a concurrent set on the same path cannot silently
    // drop this one mid-write. The replace is blind, so on a revision conflict
    // we just re-read the current revision and re-attempt.
    for (let attempt = 0; ; attempt++) {
      const existing = await storage.datasets.readVersioned(repo, ws, refPath);
      try {
        await storage.datasets.writeIf(repo, ws, refPath, datasetRef, existing?.revision ?? null);
        break;
      } catch (err) {
        if (err instanceof DatasetRefConflictError && attempt < MAX_SET_DATASET_RETRIES) continue;
        throw err;
      }
    }
  } finally {
    // Only release the lock if we acquired it internally
    if (!externalLock) {
      await lock.release();
    }
  }
}

// =============================================================================
// Workspace Helper Functions
// =============================================================================

/**
 * Read workspace state from file.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but not deployed
 */
async function readWorkspaceState(storage: StorageBackend, repo: string, ws: string) {
  const data = await storage.refs.workspaceRead(repo, ws);
  if (data === null) {
    throw new WorkspaceNotFoundError(ws);
  }
  if (data.length === 0) {
    throw new WorkspaceNotDeployedError(ws);
  }
  const decoder = decodeBeast2For(WorkspaceStateType);
  return decoder(data);
}

/**
 * Get root structure for a workspace.
 * Reads the deployed package object to get the structure.
 */
async function getWorkspaceStructure(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<{ rootStructure: Structure }> {
  const wsState = await readWorkspaceState(storage, repo, ws);

  // Read the deployed package object using the stored hash
  const pkgData = await storage.objects.read(repo, wsState.packageHash);
  const pkgObject = decodePackageObject(Buffer.from(pkgData));

  return {
    rootStructure: pkgObject.data.structure,
  };
}

// =============================================================================
// Workspace High-level Operations (by path) - Using per-dataset refs
// =============================================================================

/**
 * List field names at a tree path within a workspace's data tree.
 *
 * Uses the structure to determine available fields (no tree traversal needed).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the tree node
 * @returns Array of field names at the path
 * @throws If workspace not deployed, path invalid, or path points to a dataset
 */
export async function workspaceListTree(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath
): Promise<string[]> {
  const { rootStructure } = await getWorkspaceStructure(storage, repo, ws);

  // Navigate structure to find the target node
  let currentStructure = rootStructure;
  for (let i = 0; i < treePath.length; i++) {
    const segment = treePath[i]!;
    if (segment.type !== 'field') {
      throw new Error(`Unsupported path segment type: ${segment.type}`);
    }

    if (currentStructure.type !== 'struct') {
      const pathStr = treePath.slice(0, i).map(s => s.value).join('.');
      throw new Error(`Path '${pathStr}' points to a dataset, not a tree`);
    }

    const childStructure = currentStructure.value.get(segment.value);
    if (!childStructure) {
      throw new Error(`Field '${segment.value}' not found in structure`);
    }
    currentStructure = childStructure;
  }

  if (currentStructure.type !== 'struct') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a dataset, not a tree`);
  }

  return Array.from(currentStructure.value.keys());
}

/**
 * Read and decode a dataset value at a path within a workspace's data tree.
 *
 * Reads the per-dataset ref file to get the value hash, then decodes the value.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @returns The decoded dataset value
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceGetDataset(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath
): Promise<unknown> {
  if (treePath.length === 0) {
    throw new Error('Cannot get dataset at root path - root is always a tree');
  }

  // Validate path against structure
  const { rootStructure } = await getWorkspaceStructure(storage, repo, ws);
  let currentStructure = rootStructure;
  for (let i = 0; i < treePath.length; i++) {
    const segment = treePath[i]!;
    if (segment.type !== 'field') throw new Error(`Unsupported path segment type: ${segment.type}`);
    if (currentStructure.type !== 'struct') throw new Error(`Cannot descend into non-struct`);
    const child = currentStructure.value.get(segment.value);
    if (!child) throw new Error(`Field '${segment.value}' not found in structure`);
    currentStructure = child;
  }

  if (currentStructure.type !== 'value') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a tree, not a dataset`);
  }

  // Read the ref file
  const refPath = treePath.map(s => s.value).join('/');
  const ref = await storage.datasets.read(repo, ws, refPath);

  if (!ref || ref.type === 'unassigned') {
    throw new Error(`Dataset at path is unassigned (pending task output)`);
  }

  if (ref.type === 'null') {
    return null;
  }

  // Read and return the dataset value
  const result = await datasetRead(storage, repo, ref.value.hash);
  return result.value;
}

/**
 * Get the hash of a dataset at a path within a workspace's data tree.
 *
 * Reads the per-dataset ref file directly. No tree traversal needed.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @returns Object with ref type and hash (null for unassigned/null refs)
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceGetDatasetHash(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath
): Promise<{ refType: DataRef['type']; hash: string | null }> {
  if (treePath.length === 0) {
    throw new Error('Cannot get dataset at root path - root is always a tree');
  }

  // Read the ref file directly using the path
  const refPath = treePath.map(s => s.value).join('/');
  const ref = await storage.datasets.read(repo, ws, refPath);

  if (!ref || ref.type === 'unassigned') {
    return { refType: 'unassigned', hash: null };
  }

  if (ref.type === 'null') {
    return { refType: 'null', hash: null };
  }

  return { refType: 'value', hash: ref.value.hash };
}

/**
 * Set a dataset at a path within a workspace using a pre-computed hash.
 *
 * Writes a DatasetRef file directly. No tree path-copy needed.
 *
 * IMPORTANT: This function does NOT acquire a workspace lock. The caller must
 * hold a lock on the workspace before calling this function. This
 * is typically used by dataflowExecute which holds the lock for the entire
 * execution.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param valueHash - Hash of the dataset value already in the object store
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceSetDatasetByHash(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  valueHash: string,
  versions: VersionVector
): Promise<void> {
  if (treePath.length === 0) {
    throw new Error('Cannot set dataset at root path - root is always a tree');
  }

  // Write the DatasetRef directly
  const refPath = treePath.map(s => s.value).join('/');
  const datasetRef: DatasetRef = variant('value', { hash: valueHash, versions });
  await storage.datasets.write(repo, ws, refPath, datasetRef);
}

/**
 * Result of querying a single dataset's status.
 */
export interface DatasetStatusResult {
  /** Ref type: 'unassigned' | 'null' | 'value' */
  refType: DataRef['type'];
  /** Object hash (null for unassigned/null refs) */
  hash: string | null;
  /** East type of the dataset */
  datasetType: EastTypeValue;
  /** Size in bytes (null for unassigned) */
  size: number | null;
  /** Segment count of a stored collection, read from the blob's trailing
   *  index — `null` for a non-collection, an unassigned/null ref, or a
   *  backend without ranged reads. Costs two ranged reads, never the blob. */
  segments?: number | null;
  /** Element count (pairs for a Dict) of a stored collection, from the same
   *  index — so a re-pointed input is inspectable without decoding it. */
  rows?: number | null;
  /** Bytes the VALUE occupies in the store. For a collection held as a
   *  segment manifest that is the segments plus the manifest, which `size` —
   *  the dataset object's own bytes — is not: a manifest is a few dozen bytes
   *  per segment whatever the value weighs. The header object the manifest
   *  names is not counted; every segment carries those bytes already. `null`
   *  when the geometry was not asked for or could not be read. */
  storedBytes?: number | null;
}

/** Options for {@link workspaceGetDatasetStatus}. */
export interface WorkspaceGetDatasetStatusOptions {
  /**
   * Also read a stored collection's segment and element counts from its
   * trailing index.
   *
   * @remarks
   * Off by default, and deliberately: two ranged reads is nothing next to
   * decoding a blob, but this call sits in front of the paged-read and
   * key-search endpoints, which are held to reading exactly the frames they
   * decode. The geometry is for the places that DISPLAY a dataset.
   */
  geometry?: boolean;
}

/**
 * Get the status of a single dataset at a path within a workspace.
 *
 * Returns the ref type, hash, East type, and size without downloading the value.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param options - Whether to also read the stored collection's geometry
 * @returns Dataset status including ref type, hash, type, and size
 * @throws If workspace not deployed, path invalid, or path points to a tree
 */
export async function workspaceGetDatasetStatus(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  options: WorkspaceGetDatasetStatusOptions = {}
): Promise<DatasetStatusResult> {
  if (treePath.length === 0) {
    throw new Error('Cannot get dataset status at root path - root is always a tree');
  }

  const leaf = await workspaceResolveDataset(storage, repo, ws, treePath);
  const datasetType = leaf.type;

  // Read the ref file
  const ref = await storage.datasets.read(repo, ws, leaf.refPath);

  if (!ref || ref.type === 'unassigned') {
    return { refType: 'unassigned', hash: null, datasetType, size: null, segments: null, rows: null, storedBytes: null };
  }

  if (ref.type === 'null') {
    return { refType: 'null', hash: null, datasetType, size: 0, segments: null, rows: null, storedBytes: null };
  }

  // value ref - get size from object store
  const { size } = await storage.objects.stat(repo, ref.value.hash);
  const geometry = options.geometry
    ? await datasetGeometry(storage, repo, ref.value.hash, datasetType, size)
    : { segments: null, rows: null, storedBytes: null };
  return { refType: 'value', hash: ref.value.hash, datasetType, size, ...geometry };
}

/**
 * Segment and element counts of a stored collection.
 *
 * One small object read for a manifest, which carries both; two ranged reads
 * (the tail, then the head) for a bare blob — never the value. A backend
 * without {@link ObjectStore.readRange}, a non-collection root, or a blob
 * whose index cannot be read reports `null` rather than failing a status
 * call — the geometry is a convenience on top of the hash and the size.
 */
async function datasetGeometry(
  storage: StorageBackend,
  repo: string,
  hash: string,
  datasetType: EastTypeValue,
  size: number
): Promise<{ segments: number | null; rows: number | null; storedBytes: number | null }> {
  if (!isCollectionRoot(datasetType)) return { segments: null, rows: null, storedBytes: null };
  try {
    // A record that declares an index names a `$record` state, and the
    // collection hangs off that — so the geometry belongs to the object the
    // opener resolves to, never to the object the ref happened to point at.
    const opened = await openDatasetObject(storage, repo, hash, size);
    const collectionSize = opened.hash === hash ? size : (await storage.objects.stat(repo, opened.hash)).size;
    if (opened.manifest !== null) {
      return {
        segments: opened.manifest.entries.length,
        rows: manifestElementCount(opened.manifest),
        storedBytes: manifestByteSize(opened.manifest) + collectionSize,
      };
    }
    const readRange = storage.objects.readRange;
    if (!readRange) return { segments: null, rows: null, storedBytes: null };
    const extents = await readBeast2ExtentsRanged({
      size: collectionSize,
      read: (offset, length) => readRange.call(storage.objects, repo, opened.hash, offset, length),
    });
    return { segments: extents.offsets.length, rows: extents.elementCount, storedBytes: collectionSize };
  } catch {
    return { segments: null, rows: null, storedBytes: null };
  }
}

// =============================================================================
// Tree Traversal
// =============================================================================

/**
 * A tree branch node (contains children).
 */
export interface TreeBranchNode {
  /** Field name */
  name: string;
  /** Discriminator */
  kind: 'tree';
  /** Child nodes */
  children: TreeNode[];
}

/**
 * A dataset leaf node (contains a value).
 */
export interface TreeLeafNode {
  /** Field name */
  name: string;
  /** Discriminator */
  kind: 'dataset';
  /** East type value (only present if includeTypes option was true) */
  datasetType?: EastTypeValue;
  /** Object hash (only present if includeStatus option was true and ref is 'value') */
  hash?: string;
  /** Ref type: 'unassigned' | 'null' | 'value' (only present if includeStatus option was true) */
  refType?: string;
  /** Size in bytes (only present if includeStatus option was true and ref is 'null' or 'value') */
  size?: number;
}

/**
 * A node in the tree structure for display purposes.
 */
export type TreeNode = TreeBranchNode | TreeLeafNode;

/**
 * Options for workspaceGetTree.
 */
export interface WorkspaceGetTreeOptions {
  /** Maximum depth to recurse (undefined = unlimited) */
  maxDepth?: number;
  /** Include East types for dataset nodes */
  includeTypes?: boolean;
  /** Include hash, refType, and size for dataset nodes */
  includeStatus?: boolean;
}

/**
 * Check if a structure represents a task (has function_ir and output).
 */
function isTaskStructure(structure: Structure): boolean {
  if (structure.type !== 'struct') return false;
  const fields = structure.value;
  return fields.has('function_ir') && fields.has('output');
}

/**
 * Get the output type from a task structure (from structure, not value).
 */
function getTaskOutputTypeFromStructure(structure: Structure): EastTypeValue | undefined {
  if (structure.type !== 'struct') return undefined;
  const outputStructure = structure.value.get('output');
  if (outputStructure?.type === 'value') {
    return outputStructure.value.type as EastTypeValue;
  }
  return undefined;
}

/**
 * Get the full tree structure at a path within a workspace.
 *
 * Recursively walks the structure and ref files to build a hierarchical
 * structure suitable for display. Tasks are shown as leaves with their output type.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to start from (empty for root)
 * @param options - Optional settings for depth limit and type inclusion
 * @returns Array of tree nodes at the path
 * @throws If workspace not deployed or path invalid
 */
export async function workspaceGetTree(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  options: WorkspaceGetTreeOptions = {}
): Promise<TreeNode[]> {
  const { rootStructure } = await getWorkspaceStructure(storage, repo, ws);
  const { maxDepth, includeTypes, includeStatus } = options;

  // Navigate to the target structure
  let targetStructure = rootStructure;
  let pathPrefix = '';
  for (const segment of treePath) {
    if (segment.type !== 'field') throw new Error(`Unsupported path segment type: ${segment.type}`);
    if (targetStructure.type !== 'struct') throw new Error('Cannot descend into non-struct');
    const child = targetStructure.value.get(segment.value);
    if (!child) throw new Error(`Field '${segment.value}' not found`);
    pathPrefix = pathPrefix ? `${pathPrefix}/${segment.value}` : segment.value;
    targetStructure = child;
  }

  if (targetStructure.type !== 'struct') {
    const pathStr = treePath.map(s => s.value).join('.');
    throw new Error(`Path '${pathStr}' points to a dataset, not a tree`);
  }

  return walkStructure(storage, repo, ws, targetStructure, pathPrefix, 0, maxDepth, includeTypes, includeStatus);
}

/**
 * Recursively walk structure and build TreeNode array using ref files.
 */
async function walkStructure(
  storage: StorageBackend,
  repo: string,
  ws: string,
  structure: Structure,
  pathPrefix: string,
  currentDepth: number,
  maxDepth: number | undefined,
  includeTypes: boolean | undefined,
  includeStatus: boolean | undefined
): Promise<TreeNode[]> {
  if (structure.type !== 'struct') {
    throw new Error('Expected struct structure for tree walk');
  }

  const entries = Array.from(structure.value.entries());

  const nodes = await Promise.all(entries.map(async ([fieldName, childStructure]): Promise<TreeNode> => {
    const childPath = pathPrefix ? `${pathPrefix}/${fieldName}` : fieldName;

    if (childStructure.type === 'value') {
      // Dataset (leaf node)
      const node: TreeLeafNode = {
        name: fieldName,
        kind: 'dataset',
        datasetType: includeTypes ? childStructure.value.type as EastTypeValue : undefined,
      };

      if (includeStatus) {
        const ref = await storage.datasets.read(repo, ws, childPath);
        if (!ref || ref.type === 'unassigned') {
          node.refType = 'unassigned';
        } else if (ref.type === 'null') {
          node.refType = 'null';
          node.size = 0;
        } else {
          node.refType = 'value';
          node.hash = ref.value.hash;
          const { size } = await storage.objects.stat(repo, ref.value.hash);
          node.size = size;
        }
      }

      return node;
    }

    // childStructure.type === 'struct'

    // Task subtree — show as leaf with output type
    if (isTaskStructure(childStructure)) {
      const node: TreeLeafNode = {
        name: fieldName,
        kind: 'dataset',
        datasetType: includeTypes ? getTaskOutputTypeFromStructure(childStructure) : undefined,
      };

      if (includeStatus) {
        // Read the output ref for the task
        const outputRefPath = `${childPath}/output`;
        const outputRef = await storage.datasets.read(repo, ws, outputRefPath);
        if (!outputRef || outputRef.type === 'unassigned') {
          node.refType = 'unassigned';
        } else if (outputRef.type === 'null') {
          node.refType = 'null';
          node.size = 0;
        } else {
          node.refType = 'value';
          node.hash = outputRef.value.hash;
          const { size } = await storage.objects.stat(repo, outputRef.value.hash);
          node.size = size;
        }
      }

      return node;
    }

    // Regular subtree
    let children: TreeNode[] = [];
    if (maxDepth === undefined || currentDepth < maxDepth) {
      children = await walkStructure(
        storage,
        repo,
        ws,
        childStructure,
        childPath,
        currentDepth + 1,
        maxDepth,
        includeTypes,
        includeStatus
      );
    }

    return { name: fieldName, kind: 'tree', children } as TreeBranchNode;
  }));

  // Sort alphabetically for consistent output
  nodes.sort((a, b) => a.name.localeCompare(b.name));

  return nodes;
}

// =============================================================================
// Package Operations (still use tree traversal for compatibility)
// =============================================================================

/**
 * List field names at a tree path within a package's data tree.
 *
 * Note: In the new format, packages store per-dataset refs in data/ dir
 * rather than tree objects. This function uses the structure directly.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @param path - Path to the tree node
 * @returns Array of field names at the path
 * @throws If package not found, path invalid, or path points to a dataset
 */
export async function packageListTree(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  path: TreePath
): Promise<string[]> {
  const pkg = await packageRead(storage, repo, name, version);
  const rootStructure = pkg.data.structure;

  let currentStructure = rootStructure;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!;
    if (segment.type !== 'field') throw new Error(`Unsupported path segment type: ${segment.type}`);
    if (currentStructure.type !== 'struct') throw new Error('Path points to a dataset, not a tree');
    const child = currentStructure.value.get(segment.value);
    if (!child) throw new Error(`Field '${segment.value}' not found`);
    currentStructure = child;
  }

  if (currentStructure.type !== 'struct') {
    throw new Error('Path points to a dataset, not a tree');
  }

  return Array.from(currentStructure.value.keys());
}
