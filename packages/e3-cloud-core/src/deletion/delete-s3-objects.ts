/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete S3 Objects — Paginated S3 object deletion for a repo prefix.
 * Called in a loop by the SFN state machine until status is 'done'.
 */

export interface DeleteS3ObjectsInput {
  repo: string;
  continuationToken?: string;
}

export interface DeleteS3ObjectsOutput {
  repo: string;
  status: 'continue' | 'done';
  continuationToken?: string;
  deleted: number;
}

/**
 * Cloud-agnostic interface for batch S3 object deletion.
 * Implemented by the AWS layer using S3 ListObjectsV2 + DeleteObjects.
 */
export interface ObjectCleanupStore {
  deleteObjectsBatch(repo: string, continuationToken?: string): Promise<{
    deleted: number;
    continuationToken?: string;
  }>;
}

export interface DeleteS3ObjectsDeps {
  objectCleanupStore: ObjectCleanupStore;
}

export async function handleDeleteS3Objects(
  deps: DeleteS3ObjectsDeps,
  input: DeleteS3ObjectsInput,
): Promise<DeleteS3ObjectsOutput> {
  const { repo, continuationToken } = input;

  console.log(`Deleting S3 objects for ${repo}${continuationToken ? ' (continuing)' : ''}`);

  const result = await deps.objectCleanupStore.deleteObjectsBatch(repo, continuationToken);

  console.log(`Deleted ${result.deleted} S3 objects for ${repo}, status=${result.continuationToken ? 'continue' : 'done'}`);

  return {
    repo,
    status: result.continuationToken ? 'continue' : 'done',
    continuationToken: result.continuationToken,
    deleted: result.deleted,
  };
}
