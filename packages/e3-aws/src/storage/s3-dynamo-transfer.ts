/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * S3 + DynamoDB TransferBackend implementation.
 *
 * Dataset uploads/downloads use presigned S3 URLs pointing to the object store
 * at {repo}/objects/{hash}. Package imports/exports use temporary S3 keys at
 * {repo}/_transfer/{id}.zip. Transfer metadata is stored in DynamoDB with TTL.
 *
 * DynamoDB key pattern:
 *   PK: TRANSFER    SK: dataset-upload#{id}     — dataset upload records
 *   PK: TRANSFER    SK: package-import#{id}     — package import records
 *   PK: TRANSFER    SK: package-export#{id}     — package export records
 */

import { createHash } from 'node:crypto';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  SFNClient,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { encodeBeast2For, decodeBeast2For, variant } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
} from '@elaraai/e3-core';
import type {
  TransferBackend,
  DatasetUploadStore,
  DatasetDownloadStore,
  PackageImportStore,
  PackageExportStore,
} from '@elaraai/e3-core';
import type { DatasetUpload, PackageImport, PackageExport } from '@elaraai/e3-core';
import {
  DatasetUploadType,
  PackageImportType,
  PackageExportType,
} from '@elaraai/e3-core';

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour
const TRANSFER_TTL_SECONDS = 24 * 60 * 60; // 24 hours

const encodeDatasetUpload = encodeBeast2For(DatasetUploadType);
const decodeDatasetUpload = decodeBeast2For(DatasetUploadType);
const encodePackageImport = encodeBeast2For(PackageImportType);
const decodePackageImport = decodeBeast2For(PackageImportType);
const encodePackageExport = encodeBeast2For(PackageExportType);
const decodePackageExport = decodeBeast2For(PackageExportType);

function ttl(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

// =============================================================================
// Dataset Upload Store
// =============================================================================

class S3DynamoDatasetUploadStore implements DatasetUploadStore {
  constructor(
    private readonly s3: S3Client,
    private readonly dynamo: DynamoDBClient,
    private readonly bucket: string,
    private readonly tableName: string,
  ) {}

  async create(id: string, record: DatasetUpload): Promise<void> {
    const data = encodeDatasetUpload(record);
    await this.dynamo.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        PK: 'TRANSFER',
        SK: `dataset-upload#${id}`,
        data: data,
        ttl: ttl(TRANSFER_TTL_SECONDS),
      }),
    }));
  }

  async get(id: string): Promise<DatasetUpload | null> {
    const result = await this.dynamo.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `dataset-upload#${id}` }),
    }));
    if (!result.Item) return null;
    const item = unmarshall(result.Item);
    return decodeDatasetUpload(item.data as Uint8Array) as DatasetUpload;
  }

  async delete(id: string): Promise<void> {
    await this.dynamo.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `dataset-upload#${id}` }),
    }));
  }

  async getUploadUrl(id: string, repo: string, hash: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/objects/${hash}`,
      ContentType: BEAST2_CONTENT_TYPE,
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_URL_EXPIRY });
  }

  async commitObject(repo: string, hash: string, uploadId: string): Promise<void> {
    // Get transfer record to verify expected size
    const record = await this.get(uploadId);
    if (!record) throw new Error(`Transfer record ${uploadId} not found`);

    // Download and verify the uploaded object
    const s3Key = `${repo}/objects/${hash}`;
    const obj = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    }));
    const body = await obj.Body!.transformToByteArray();

    // Verify size matches
    if (BigInt(body.length) !== record.size) {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }));
      throw new Error(`Size mismatch: expected ${record.size}, got ${body.length}`);
    }

    // Verify SHA256 matches the declared hash
    const actualHash = createHash('sha256').update(body).digest('hex');
    if (actualHash !== hash) {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }));
      throw new Error(`Hash mismatch: expected ${hash}, got ${actualHash}`);
    }

    // Get version ID for catalogue entry
    const head = await this.s3.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    }));

    // Write catalogue entry (same pattern as S3ObjectStore.write for large objects)
    const now = new Date().toISOString();
    await this.dynamo.send(new UpdateItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
      UpdateExpression:
        'SET currentVersion = :ver, #size = :size, lastReferencedAt = :now REMOVE #inline',
      ExpressionAttributeNames: {
        '#size': 'size',
        '#inline': 'inline',
      },
      ExpressionAttributeValues: marshall({
        ':ver': head.VersionId,
        ':size': body.length,
        ':now': now,
      }),
    }));

    // Clean up transfer record
    await this.delete(uploadId);
  }
}

// =============================================================================
// Dataset Download Store
// =============================================================================

class S3DynamoDatasetDownloadStore implements DatasetDownloadStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async getDownloadUrl(repo: string, hash: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/objects/${hash}`,
      ResponseContentType: BEAST2_CONTENT_TYPE,
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_URL_EXPIRY });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(_id: string): Promise<{ repo: string; hash: string } | null> {
    // Presigned URL is the capability — no record lookup needed
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(_id: string): Promise<void> {
    // No-op for S3 presigned URLs
  }
}

// =============================================================================
// Package Import Store
// =============================================================================

class S3DynamoPackageImportStore implements PackageImportStore {
  constructor(
    private readonly s3: S3Client,
    private readonly dynamo: DynamoDBClient,
    private readonly sfnClient: SFNClient,
    private readonly bucket: string,
    private readonly tableName: string,
    private readonly importStateMachineArn: string,
  ) {}

  async create(id: string, record: PackageImport): Promise<void> {
    const data = encodePackageImport(record);
    await this.dynamo.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        PK: 'TRANSFER',
        SK: `package-import#${id}`,
        data: data,
        ttl: ttl(TRANSFER_TTL_SECONDS),
      }),
    }));
  }

  async get(id: string): Promise<PackageImport | null> {
    const result = await this.dynamo.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `package-import#${id}` }),
    }));
    if (!result.Item) return null;
    const item = unmarshall(result.Item);
    return decodePackageImport(item.data as Uint8Array) as PackageImport;
  }

  async updateStatus(id: string, status: PackageImport['status']): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`Package import ${id} not found`);
    await this.create(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    await this.dynamo.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `package-import#${id}` }),
    }));
  }

  async getUploadUrl(id: string, repo: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/_transfer/${id}.zip`,
      ContentType: 'application/zip',
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_URL_EXPIRY });
  }

  async execute(id: string, repo: string): Promise<void> {
    await this.updateStatus(id, variant('processing',
      variant('pending', null),
    ));

    // Start Step Function execution
    await this.sfnClient.send(new StartExecutionCommand({
      stateMachineArn: this.importStateMachineArn,
      name: `import-${id}`,
      input: JSON.stringify({ id, repo }),
    }));
  }
}

// =============================================================================
// Package Export Store
// =============================================================================

class S3DynamoPackageExportStore implements PackageExportStore {
  constructor(
    private readonly s3: S3Client,
    private readonly dynamo: DynamoDBClient,
    private readonly sfnClient: SFNClient,
    private readonly bucket: string,
    private readonly tableName: string,
    private readonly exportStateMachineArn: string,
  ) {}

  async create(id: string, record: PackageExport): Promise<void> {
    const data = encodePackageExport(record);
    await this.dynamo.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        PK: 'TRANSFER',
        SK: `package-export#${id}`,
        data: data,
        ttl: ttl(TRANSFER_TTL_SECONDS),
      }),
    }));
  }

  async get(id: string): Promise<PackageExport | null> {
    const result = await this.dynamo.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `package-export#${id}` }),
    }));
    if (!result.Item) return null;
    const item = unmarshall(result.Item);
    return decodePackageExport(item.data as Uint8Array) as PackageExport;
  }

  async updateStatus(id: string, status: PackageExport['status']): Promise<void> {
    const record = await this.get(id);
    if (!record) throw new Error(`Package export ${id} not found`);
    await this.create(id, { ...record, status });
  }

  async delete(id: string): Promise<void> {
    // Delete DynamoDB record
    await this.dynamo.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: 'TRANSFER', SK: `package-export#${id}` }),
    }));
    // Also try to clean up the S3 temp object
    const record = await this.get(id);
    if (record) {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `${record.repo}/_transfer/${id}.zip`,
      })).catch(() => {});
    }
  }

  async getDownloadUrl(id: string, repo: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/_transfer/${id}.zip`,
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_URL_EXPIRY });
  }

  async execute(id: string, repo: string): Promise<void> {
    // Start Step Function execution for async processing
    await this.sfnClient.send(new StartExecutionCommand({
      stateMachineArn: this.exportStateMachineArn,
      name: `export-${id}`,
      input: JSON.stringify({ id, repo }),
    }));
  }
}

// =============================================================================
// Transfer Backend
// =============================================================================

export class S3DynamoTransferBackend implements TransferBackend {
  readonly datasetUpload: S3DynamoDatasetUploadStore;
  readonly datasetDownload: S3DynamoDatasetDownloadStore;
  readonly packageImport: S3DynamoPackageImportStore;
  readonly packageExport: S3DynamoPackageExportStore;

  constructor(
    s3: S3Client,
    dynamo: DynamoDBClient,
    sfnClient: SFNClient,
    bucket: string,
    tableName: string,
    importStateMachineArn: string,
    exportStateMachineArn: string,
  ) {
    this.datasetUpload = new S3DynamoDatasetUploadStore(s3, dynamo, bucket, tableName);
    this.datasetDownload = new S3DynamoDatasetDownloadStore(s3, bucket);
    this.packageImport = new S3DynamoPackageImportStore(s3, dynamo, sfnClient, bucket, tableName, importStateMachineArn);
    this.packageExport = new S3DynamoPackageExportStore(s3, dynamo, sfnClient, bucket, tableName, exportStateMachineArn);
  }
}
