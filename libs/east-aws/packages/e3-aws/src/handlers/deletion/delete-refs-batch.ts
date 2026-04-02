/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Refs Batch Lambda Handler — thin wrapper.
 */

import { getStorage } from '../../storage/init.js';
import { handleDeleteRefsBatch } from '@elaraai/e3-cloud-core/deletion';
import type { DeleteRefsBatchInput, DeleteRefsBatchOutput } from '@elaraai/e3-cloud-core/deletion';

const storage = getStorage();

export const handler = async (input: DeleteRefsBatchInput): Promise<DeleteRefsBatchOutput> => {
  return handleDeleteRefsBatch(
    { repoStore: storage.repos },
    input,
  );
};
