/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Check Workspaces Lambda Handler — thin wrapper.
 */

import { getStorage } from '../../storage/init.js';
import { handleCheckWorkspaces } from '@elaraai/e3-cloud-core/deletion';
import type { CheckWorkspacesInput, CheckWorkspacesOutput } from '@elaraai/e3-cloud-core/deletion';

const storage = getStorage();

export const handler = async (input: CheckWorkspacesInput): Promise<CheckWorkspacesOutput> => {
  return handleCheckWorkspaces(
    { listWorkspaces: (repo) => storage.refs.workspaceList(repo) },
    input,
  );
};
