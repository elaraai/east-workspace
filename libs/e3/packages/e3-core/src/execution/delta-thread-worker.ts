/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The thread `applyDeltaOnThread` starts: it applies the one delta it was
 * started for to the repository at the path it was given, and answers what
 * the apply wrote, or how it refused.
 *
 * @packageDocumentation
 */

import { parentPort, workerData } from 'node:worker_threads';
import { encodeBeast2For, segmentKeyTypeOf } from '@elaraai/east';
import { DatasetSegments } from '../dataset-open.js';
import { DeltaConflictError, ExternalEntryError, SummaryIntegrityError, applyDeltaSummarized } from '../record-apply.js';
import { LocalStorage } from '../storage/local/index.js';
import type { DeltaThreadAnswer, DeltaThreadAsk } from './delta-thread.js';

const ask = workerData as DeltaThreadAsk;
const storage = new LocalStorage();
const targets = new Map(ask.targets);

/** The apply's refusal as its answer: by the error's class, which the thread that asked throws again. */
async function refusal(err: unknown): Promise<DeltaThreadAnswer> {
  if (err instanceof ExternalEntryError) {
    // The key is a case of the record's key, encoded by the type its own collection holds
    const keyType = segmentKeyTypeOf((await DatasetSegments.open(storage, ask.repo, targets.get('primary')!)).typeValue);
    return { kind: 'external', key: encodeBeast2For(keyType!)(err.key), source: err.source, printed: err.printed };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DeltaConflictError) return { kind: 'conflict', message };
  if (err instanceof SummaryIntegrityError) return { kind: 'summary', message };
  return { kind: 'error', message };
}

let answer: DeltaThreadAnswer;
try {
  const { written, summary } = await applyDeltaSummarized(storage, ask.repo, targets, ask.delta,
    ask.cases === undefined ? {} : { cases: new Set(ask.cases) });
  answer = { kind: 'applied', written: [...written], summary };
} catch (err) {
  answer = await refusal(err);
}
parentPort!.postMessage(answer);
