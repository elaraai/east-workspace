/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Shared initialization for AWS storage clients.
 *
 * Provides singleton access to S3DynamoStorage and related stores,
 * eliminating repeated `new S3Client() / new DynamoDBClient() / new S3DynamoStorage()`
 * in every Lambda handler.
 *
 * Usage:
 *   import { getStorage } from '@elaraai/e3-aws/storage/init';
 *   const storage = getStorage();
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from './s3-dynamo-storage.js';
import { DynamoTaskConfigStore } from './dynamo-task-config-store.js';
import { DynamoScheduleStore } from './dynamo-schedule-store.js';
import { DynamoComputeResultStore } from './dynamo-compute-result-store.js';
import { S3GcTempStore } from './s3-gc-temp-store.js';

let _s3: S3Client | undefined;
let _dynamo: DynamoDBClient | undefined;
let _storage: S3DynamoStorage | undefined;
let _taskConfigStore: DynamoTaskConfigStore | undefined;
let _scheduleStore: DynamoScheduleStore | undefined;
let _computeResultStore: DynamoComputeResultStore | undefined;
let _gcTempStore: S3GcTempStore | undefined;

function ensureClients(): { s3: S3Client; dynamo: DynamoDBClient } {
  if (!_s3) _s3 = new S3Client({});
  if (!_dynamo) _dynamo = new DynamoDBClient({});
  return { s3: _s3, dynamo: _dynamo };
}

/** Get the shared S3DynamoStorage instance (created once per Lambda cold start). */
export function getStorage(): S3DynamoStorage {
  if (!_storage) {
    const { s3, dynamo } = ensureClients();
    _storage = new S3DynamoStorage(s3, dynamo, process.env.BUCKET_NAME!, process.env.TABLE_NAME!);
  }
  return _storage;
}

/** Get the shared DynamoTaskConfigStore instance. */
export function getTaskConfigStore(): DynamoTaskConfigStore {
  if (!_taskConfigStore) {
    const { dynamo } = ensureClients();
    _taskConfigStore = new DynamoTaskConfigStore(dynamo, process.env.TABLE_NAME!);
  }
  return _taskConfigStore;
}

/** Get the shared DynamoScheduleStore instance. */
export function getScheduleStore(): DynamoScheduleStore {
  if (!_scheduleStore) {
    const { dynamo } = ensureClients();
    _scheduleStore = new DynamoScheduleStore(dynamo, process.env.TABLE_NAME!);
  }
  return _scheduleStore;
}

/** Get the shared DynamoComputeResultStore instance. */
export function getComputeResultStore(): DynamoComputeResultStore {
  if (!_computeResultStore) {
    const { dynamo } = ensureClients();
    _computeResultStore = new DynamoComputeResultStore(dynamo, process.env.TABLE_NAME!);
  }
  return _computeResultStore;
}

/** Get the shared S3GcTempStore instance. */
export function getGcTempStore(): S3GcTempStore {
  if (!_gcTempStore) {
    const { s3 } = ensureClients();
    _gcTempStore = new S3GcTempStore(s3, process.env.BUCKET_NAME!);
  }
  return _gcTempStore;
}
