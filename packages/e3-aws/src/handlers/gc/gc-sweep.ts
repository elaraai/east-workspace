/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Sweep Phase Lambda Handler — thin wrapper.
 */

import { getStorage, getGcTempStore } from '../../storage/init.js';
import { handleGcSweep } from '@elaraai/e3-cloud-core/gc';
import type { GcSweepInput, GcSweepOutput } from '@elaraai/e3-cloud-core/gc';

export type { GcSweepInput, GcSweepOutput, GcSweepStats } from '@elaraai/e3-cloud-core/gc';

const storage = getStorage();
const tempStore = getGcTempStore();

/** Lambda handler: thin wrapper that injects dependencies. */
export const handler = async (input: GcSweepInput): Promise<GcSweepOutput> => {
  return handleGcSweep(
    { repoStore: storage.repos, tempStore },
    input,
  );
};
