/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Status Lambda Handlers — thin wrappers.
 */

import { getStorage } from '../../storage/init.js';
import { handleSetGC, handleSetActive } from '@elaraai/e3-cloud-core/gc';
import type { SetStatusInput, SetStatusOutput } from '@elaraai/e3-cloud-core/gc';

export type { SetStatusInput, SetStatusOutput } from '@elaraai/e3-cloud-core/gc';

const repoManager = getStorage().repoManager;

/** Set repo status to 'gc'. Lambda handler: thin wrapper. */
export const setGCHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  return handleSetGC({ repoManager }, input);
};

/** Set repo status back to 'active'. Lambda handler: thin wrapper. */
export const setActiveHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  return handleSetActive({ repoManager }, input);
};
