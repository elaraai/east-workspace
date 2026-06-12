/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * In-memory state storage for async function / one-shot calls.
 *
 * Modelled on async-operation-state.ts (the GC pattern), with the eviction
 * gap fixed: terminal entries are evicted after a TTL on a lazy sweep at
 * each read/write, so the registry can't grow without bound. The finished
 * result is held only transiently until polled — never in the durable
 * object store.
 *
 * This serves as a development/test mock for the short-TTL DynamoDB record
 * used by the cloud (ComputeResultStore pattern).
 */

import { randomUUID } from 'crypto';
import { variant, some, none } from '@elaraai/east';
import type { ExecuteResult, CallStatusResult } from './types.js';

interface FunctionCallInternal {
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: number;
  /** Set when the call reaches a terminal status — drives TTL eviction. */
  completedAt?: number;
  abort: AbortController;
  result?: ExecuteResult;
  error?: string;
}

/** How long a terminal call entry survives un-polled. */
const CALL_TTL_MS = 5 * 60 * 1000;

// Key: callId (UUID)
const calls = new Map<string, FunctionCallInternal>();

/**
 * Evict terminal entries older than the TTL. Called lazily on every
 * read/write — no timers to leak.
 */
function sweep(): void {
  const now = Date.now();
  for (const [id, call] of calls) {
    if (call.completedAt !== undefined && now - call.completedAt > CALL_TTL_MS) {
      calls.delete(id);
    }
  }
}

/**
 * Create a new function call and return its ID plus the AbortController
 * that cancels it.
 */
export function createFunctionCall(): { callId: string; abort: AbortController } {
  sweep();
  const callId = randomUUID();
  const abort = new AbortController();
  calls.set(callId, {
    status: 'running',
    startedAt: Date.now(),
    abort,
  });
  return { callId, abort };
}

/**
 * Mark a call as succeeded with its terminal ExecuteResult.
 *
 * "Succeeded" means the call ran to a terminal result — the result itself
 * may still carry a `failed`/`too_large`/`timed_out` outcome.
 */
export function completeFunctionCall(callId: string, result: ExecuteResult): void {
  sweep();
  const call = calls.get(callId);
  if (call && call.status === 'running') {
    call.status = 'succeeded';
    call.completedAt = Date.now();
    call.result = result;
  }
}

/**
 * Mark a call as failed with an infrastructure error message.
 */
export function failFunctionCall(callId: string, error: string): void {
  sweep();
  const call = calls.get(callId);
  if (call && call.status === 'running') {
    call.status = 'failed';
    call.completedAt = Date.now();
    call.error = error;
  }
}

/**
 * Get the status of a call as a wire CallStatusResult.
 * Returns null if the call doesn't exist (or was evicted).
 */
export function getFunctionCall(callId: string): CallStatusResult | null {
  sweep();
  const call = calls.get(callId);
  if (!call) {
    return null;
  }

  let status: CallStatusResult['status'];
  switch (call.status) {
    case 'running':
      status = variant('running', null);
      break;
    case 'succeeded':
      status = variant('succeeded', null);
      break;
    case 'failed':
      status = variant('failed', null);
      break;
    case 'cancelled':
      status = variant('cancelled', null);
      break;
  }

  return {
    status,
    result: call.result ? some(call.result) : none,
    error: call.error ? some(call.error) : none,
  };
}

/**
 * Cancel an in-flight call: abort its process and mark it cancelled.
 * Returns false if the call doesn't exist; true otherwise (idempotent for
 * already-terminal calls).
 */
export function cancelFunctionCall(callId: string): boolean {
  sweep();
  const call = calls.get(callId);
  if (!call) {
    return false;
  }
  if (call.status === 'running') {
    call.status = 'cancelled';
    call.completedAt = Date.now();
    call.abort.abort();
  }
  return true;
}

/**
 * Clear all call state. Useful for cleanup in tests.
 */
export function clearAllFunctionCalls(): void {
  calls.clear();
}
