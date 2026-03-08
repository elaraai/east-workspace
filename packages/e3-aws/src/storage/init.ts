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
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { PackageImportType } from '@elaraai/e3-core';
import type { PackageImport, PackageImportStore } from '@elaraai/e3-core';
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
let _importStore: Pick<PackageImportStore, 'get' | 'updateStatus'> | undefined;

function ensureClients(): { s3: S3Client; dynamo: DynamoDBClient } {
  if (!_s3) _s3 = new S3Client({});
  if (!_dynamo) _dynamo = new DynamoDBClient({ maxAttempts: 10 });
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

const encodePackageImport = encodeBeast2For(PackageImportType);
const decodePackageImport = decodeBeast2For(PackageImportType);
const TRANSFER_TTL_SECONDS = 24 * 60 * 60;

/** Get a minimal PackageImportStore for Lambda handlers (get + updateStatus only). */
export function getImportStore(): Pick<PackageImportStore, 'get' | 'updateStatus'> {
  if (!_importStore) {
    const { dynamo } = ensureClients();
    const tableName = process.env.TABLE_NAME!;

    _importStore = {
      async get(id: string): Promise<PackageImport | null> {
        const result = await dynamo.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({ PK: 'TRANSFER', SK: `package-import#${id}` }),
        }));
        if (!result.Item) return null;
        const item = unmarshall(result.Item);
        return decodePackageImport(item.data as Uint8Array) as PackageImport;
      },

      async updateStatus(id: string, status: PackageImport['status']): Promise<void> {
        const record = await this.get(id);
        if (!record) throw new Error(`Package import ${id} not found`);
        const data = encodePackageImport({ ...record, status });
        const ttl = Math.floor(Date.now() / 1000) + TRANSFER_TTL_SECONDS;
        await dynamo.send(new PutItemCommand({
          TableName: tableName,
          Item: marshall({ PK: 'TRANSFER', SK: `package-import#${id}`, data, ttl }),
        }));
      },
    };
  }
  return _importStore;
}
