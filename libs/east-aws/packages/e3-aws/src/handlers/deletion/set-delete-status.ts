/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Delete Status Lambda Handlers — thin wrappers for status transitions.
 */

import { getStorage } from '../../storage/init.js';
import { handleSetDeleting, handleRollbackDelete, handleRemoveRepo } from '@elaraai/e3-cloud-core/deletion';
import type { SetDeleteStatusInput, SetDeleteStatusOutput } from '@elaraai/e3-cloud-core/deletion';

const storage = getStorage();
const deps = { repoManager: storage.repoManager, repoStore: storage.repos };

/** Set deleting: to_delete → deleting (point of no return, SFN step after workspace check) */
export const setDeletingHandler = async (input: SetDeleteStatusInput): Promise<SetDeleteStatusOutput> => {
  return handleSetDeleting(deps, input);
};

/** Rollback: to_delete → active (SFN Catch state, only if not yet deleting) */
export const rollbackHandler = async (input: SetDeleteStatusInput): Promise<SetDeleteStatusOutput> => {
  return handleRollbackDelete(deps, input);
};

/** Remove repo metadata (SFN final step) */
export const removeHandler = async (input: SetDeleteStatusInput): Promise<SetDeleteStatusOutput> => {
  return handleRemoveRepo(deps, input);
};
