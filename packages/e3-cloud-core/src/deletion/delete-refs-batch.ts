/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Refs Batch — Paginated DynamoDB record deletion.
 * Called in a loop by the SFN state machine until status is 'done'.
 */

import type { RepoStore } from '@elaraai/e3-core';

export interface DeleteRefsBatchInput {
  repo: string;
  cursor?: string;
}

export interface DeleteRefsBatchOutput {
  repo: string;
  status: 'continue' | 'done';
  cursor?: string;
  deleted: number;
}

export interface DeleteRefsBatchDeps {
  repoStore: RepoStore;
}

export async function handleDeleteRefsBatch(
  deps: DeleteRefsBatchDeps,
  input: DeleteRefsBatchInput,
): Promise<DeleteRefsBatchOutput> {
  const { repo, cursor } = input;

  console.log(`Deleting refs batch for ${repo}${cursor ? ' (continuing)' : ''}`);

  const result = await deps.repoStore.deleteRefsBatch(repo, cursor);

  console.log(`Deleted ${result.deleted} items for ${repo}, status=${result.cursor ? 'continue' : 'done'}`);

  return {
    repo,
    status: result.cursor ? 'continue' : 'done',
    cursor: result.cursor,
    deleted: result.deleted,
  };
}
