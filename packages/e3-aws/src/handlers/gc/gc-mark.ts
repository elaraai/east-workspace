/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Mark Phase Lambda Handler — thin wrapper.
 */

import { getStorage, getGcTempStore } from '../../storage/init.js';
import { handleGcMark } from '@elaraai/e3-cloud-core/gc';
import type { GcMarkInput, GcMarkOutput } from '@elaraai/e3-cloud-core/gc';

export type { GcMarkInput, GcMarkOutput } from '@elaraai/e3-cloud-core/gc';

const storage = getStorage();
const tempStore = getGcTempStore();

/** Lambda handler: thin wrapper that injects dependencies. */
export const handler = async (input: GcMarkInput): Promise<GcMarkOutput> => {
  return handleGcMark(
    { repoStore: storage.repos, objectStore: storage.objects, tempStore },
    input,
  );
};
