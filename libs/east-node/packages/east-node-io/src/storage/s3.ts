/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * S3 platform functions for East Node IO.
 *
 * Provides S3 and S3-compatible object storage operations for East programs,
 * including upload, download, delete, list, and presigned URL generation.
 *
 * @packageDocumentation
 */

import { East, BlobType, StringType, IntegerType, NullType, OptionType, variant } from "@elaraai/east";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
    type ListObjectsV2CommandInput,
    type _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3ConfigType, S3ListResultType, S3ObjectMetadataType } from "./types.js";

/**
 * Creates an S3 client from configuration.
 *
 * @param config - S3 configuration
 * @returns Configured S3Client instance
 * @internal
 */
function createS3Client(config: ValueTypeOf<typeof S3ConfigType>): S3Client {
    const credentials =
        config.accessKeyId?.type === 'some' && config.secretAccessKey?.type === 'some'
            ? {
                accessKeyId: config.accessKeyId.value,
                secretAccessKey: config.secretAccessKey.value,
            }
            : undefined;

    const endpoint = config.endpoint?.type === 'some' ? config.endpoint.value : undefined;

    // Build S3 client config conditionally to satisfy exactOptionalPropertyTypes
    const clientConfig: any = {
        region: config.region,
        credentials,
    };

    if (endpoint !== undefined) {
        clientConfig.endpoint = endpoint;
        clientConfig.forcePathStyle = true; // Use path-style for S3-compatible services
    }

    return new S3Client(clientConfig);
}

/**
 * Uploads an object to S3.
 *
 * Uploads binary data to an S3 bucket with the specified key (path).
 * Overwrites existing objects with the same key.
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param key - Object key (path) in the bucket
 * @param data - Binary data to upload
 * @returns Null on success
 *
 * @throws {EastError} When upload fails due to:
 * - Invalid bucket name (location: "s3_put_object")
 * - Authentication failure (location: "s3_put_object")
 * - Network errors (location: "s3_put_object")
 * - Permission denied (location: "s3_put_object")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType } from "@elaraai/east";
 * import { Storage } from "@elaraai/east-node-io";
 *
 * const uploadFile = East.function([StringType, BlobType], StringType, ($, filename, data) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.some("AKIAIOSFODNN7EXAMPLE"),
 *         secretAccessKey: East.some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
 *         endpoint: East.none(),
 *     });
 *
 *     // Upload the file
 *     $(Storage.S3.putObject(config, filename, data));
 *
 *     // Generate presigned URL for sharing
 *     return Storage.S3.presignUrl(config, filename, 3600n);
 * });
 *
 * const compiled = East.compileAsync(uploadFile.toIR(), Storage.S3.Implementation);
 * const url = await compiled("report.pdf", pdfBlob);
 * ```
 *
 * @remarks
 * - Supports S3 and S3-compatible services (MinIO, DigitalOcean Spaces, etc.)
 * - Uses AWS SDK v3 for S3 operations
 * - All operations are asynchronous (use East.compileAsync)
 */
export const s3_put_object = East.asyncPlatform("s3_put_object", [S3ConfigType, StringType, BlobType], NullType);

/**
 * Downloads an object from S3.
 *
 * Retrieves binary data from an S3 bucket by key (path).
 * Returns the object data as a Blob (Uint8Array).
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param key - Object key (path) in the bucket
 * @returns Binary data as Blob
 *
 * @throws {EastError} When download fails due to:
 * - Object not found (location: "s3_get_object")
 * - Invalid bucket name (location: "s3_get_object")
 * - Authentication failure (location: "s3_get_object")
 * - Network errors (location: "s3_get_object")
 * - Permission denied (location: "s3_get_object")
 *
 * @example
 * ```ts
 * import { East, StringType, BlobType } from "@elaraai/east";
 * import { Storage } from "@elaraai/east-node-io";
 *
 * const downloadFile = East.function([StringType], BlobType, ($, filename) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.none(),
 *         secretAccessKey: East.none(),
 *         endpoint: East.none(),
 *     });
 *
 *     return Storage.S3.getObject(config, filename);
 * });
 *
 * const compiled = East.compileAsync(downloadFile.toIR(), Storage.S3.Implementation);
 * const pdfData = await compiled("report.pdf");  // Returns Uint8Array
 * ```
 *
 * @remarks
 * - Returns Uint8Array (BlobType) containing raw binary data
 * - Use decodeUtf8() to convert text files to strings
 * - Streams large objects automatically
 */
export const s3_get_object = East.asyncPlatform("s3_get_object", [S3ConfigType, StringType], BlobType);
/**
 * Retrieves object metadata from S3 without downloading the file.
 *
 * Gets metadata for an S3 object including size, ETag (hash), last modified time,
 * and content type. This is useful for checking if a file has changed without
 * downloading it by comparing ETags.
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param key - Object key (path) in the bucket
 * @returns Object metadata including ETag, size, and timestamps
 *
 * @throws {EastError} When metadata retrieval fails due to:
 * - Object not found (location: "s3_head_object")
 * - Invalid bucket name (location: "s3_head_object")
 * - Authentication failure (location: "s3_head_object")
 * - Network errors (location: "s3_head_object")
 * - Permission denied (location: "s3_head_object")
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Storage } from "@elaraai/east-node-io";
 *
 * const checkFileChanged = East.function([StringType, StringType], BooleanType, ($, filename, localEtag) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.none(),
 *         secretAccessKey: East.none(),
 *         endpoint: East.none(),
 *     });
 *
 *     const metadata = $.let(Storage.S3.headObject(config, filename));
 *
 *     return $.match(metadata.etag, {
 *         some: ($, remoteEtag) => remoteEtag.notEqual(localEtag),
 *         none: ($) => East.value(true), // File changed if no ETag available
 *     });
 * });
 *
 * const compiled = East.compileAsync(checkFileChanged.toIR(), Storage.S3.Implementation);
 * const changed = await compiled("report.pdf", '"abc123def456"');  // ETags include quotes
 * if (changed) {
 *     // Download the file since it changed
 * }
 * ```
 *
 * @remarks
 * - ETag is typically an MD5 hash (for simple uploads) or composite hash (for multipart uploads)
 * - ETags include surrounding quotes (e.g., '"abc123"')
 * - Much faster than downloading the entire file
 * - Use this to implement efficient sync/caching logic
 */
export const s3_head_object = East.asyncPlatform("s3_head_object", [S3ConfigType, StringType], S3ObjectMetadataType);

/**
 * Deletes an object from S3.
 *
 * Removes an object from an S3 bucket by key (path).
 * Succeeds even if the object doesn't exist (idempotent).
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param key - Object key (path) to delete
 * @returns Null on success
 *
 * @throws {EastError} When deletion fails due to:
 * - Invalid bucket name (location: "s3_delete_object")
 * - Authentication failure (location: "s3_delete_object")
 * - Network errors (location: "s3_delete_object")
 * - Permission denied (location: "s3_delete_object")
 *
 * @example
 * ```ts
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { Storage } from "@elaraai/east-node-io";
 *
 * const deleteFile = East.function([StringType], NullType, ($, filename) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.none(),
 *         secretAccessKey: East.none(),
 *         endpoint: East.none(),
 *     });
 *
 *     return Storage.S3.deleteObject(config, filename);
 * });
 *
 * const compiled = East.compileAsync(deleteFile.toIR(), Storage.S3.Implementation);
 * await compiled("old-report.pdf");
 * ```
 *
 * @remarks
 * - Idempotent: succeeds even if object doesn't exist
 * - Does not delete versioned objects (only current version)
 */
export const s3_delete_object = East.asyncPlatform("s3_delete_object", [S3ConfigType, StringType], NullType);

/**
 * Lists objects in an S3 bucket with a prefix.
 *
 * Retrieves metadata for objects matching a prefix, with pagination support.
 * Returns up to `maxKeys` objects per request. Pass a continuation token
 * from a previous result to fetch the next page.
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param prefix - Prefix to filter objects (empty string for all objects)
 * @param maxKeys - Maximum number of objects to return (1-1000)
 * @param continuationToken - Continuation token from a previous list result for pagination (None for first page)
 * @returns List result with objects and pagination info
 *
 * @throws {EastError} When listing fails due to:
 * - Invalid bucket name (location: "s3_list_objects")
 * - Authentication failure (location: "s3_list_objects")
 * - Network errors (location: "s3_list_objects")
 * - Permission denied (location: "s3_list_objects")
 * - Invalid maxKeys value (location: "s3_list_objects")
 *
 * @example
 * ```ts
 * import { East, StringType, ArrayType } from "@elaraai/east";
 * import { Storage, S3ObjectMetadataType } from "@elaraai/east-node-io";
 *
 * const listReports = East.function([], ArrayType(S3ObjectMetadataType), ($) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.none(),
 *         secretAccessKey: East.none(),
 *         endpoint: East.none(),
 *     });
 *
 *     // First page
 *     const result = $.let(Storage.S3.listObjects(config, "reports/", 100n, East.none()));
 *
 *     // Next page using continuation token
 *     const page2 = $.let(Storage.S3.listObjects(config, "reports/", 100n, result.continuationToken));
 *     return page2.objects;
 * });
 *
 * const compiled = East.compileAsync(listReports.toIR(), Storage.S3.Implementation);
 * const reports = await compiled();
 * ```
 *
 * @remarks
 * - Returns objects sorted by key (lexicographically)
 * - Pass the `continuationToken` from the result to fetch the next page
 * - When `isTruncated` is false, there are no more pages
 * - maxKeys is clamped to 1-1000 range
 */
export const s3_list_objects = East.asyncPlatform("s3_list_objects", [S3ConfigType, StringType, IntegerType, OptionType(StringType)], S3ListResultType);

/**
 * Generates a presigned URL for temporary access to an S3 object.
 *
 * Creates a signed URL that grants temporary access to an object without
 * requiring AWS credentials. Useful for sharing files or client-side uploads.
 *
 * This is a platform function for the East language, enabling S3 object storage
 * operations in East programs running on Node.js.
 *
 * @param config - S3 configuration
 * @param key - Object key (path) in the bucket
 * @param expiresIn - URL expiration time in seconds (1-604800)
 * @returns Presigned URL as string
 *
 * @throws {EastError} When URL generation fails due to:
 * - Invalid bucket name (location: "s3_presign_url")
 * - Invalid expiration time (location: "s3_presign_url")
 * - Missing credentials (location: "s3_presign_url")
 * - Network errors (location: "s3_presign_url")
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Storage } from "@elaraai/east-node-io";
 *
 * const shareFile = East.function([StringType], StringType, ($, filename) => {
 *     const config = $.let({
 *         region: "us-east-1",
 *         bucket: "my-bucket",
 *         accessKeyId: East.some("AKIAIOSFODNN7EXAMPLE"),
 *         secretAccessKey: East.some("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
 *         endpoint: East.none(),
 *     });
 *
 *     // Generate URL valid for 1 hour
 *     return Storage.S3.presignUrl(config, filename, 3600n);
 * });
 *
 * const compiled = East.compileAsync(shareFile.toIR(), Storage.S3.Implementation);
 * const url = await compiled("report.pdf");
 * console.log(`Share this link: ${url}`);
 * ```
 *
 * @remarks
 * - URL expires after `expiresIn` seconds
 * - Requires credentials (cannot use default AWS credential chain)
 * - Works with S3-compatible services
 * - Maximum expiration: 7 days (604800 seconds)
 */
export const s3_presign_url = East.asyncPlatform("s3_presign_url", [S3ConfigType, StringType, IntegerType], StringType);

/**
 * Node.js implementation of S3 platform functions.
 *
 * Provides the runtime implementations for S3 operations using AWS SDK v3.
 * Pass this to East.compileAsync() to enable S3 functionality.
 */
export const S3Impl: PlatformFunction[] = [
    s3_put_object.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        key: ValueTypeOf<typeof StringType>,
        data: ValueTypeOf<typeof BlobType>
    ): Promise<null> => {
        try {
            const client = createS3Client(config);
            const command = new PutObjectCommand({
                Bucket: config.bucket,
                Key: key,
                Body: data,
            });
            await client.send(command);
            return null;
        } catch (err: any) {
            throw new EastError(`S3 putObject failed: ${err.message}`, {
                location: [{ filename: "s3_put_object", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    s3_get_object.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        key: ValueTypeOf<typeof StringType>
    ): Promise<Uint8Array> => {
        try {
            const client = createS3Client(config);
            const command = new GetObjectCommand({
                Bucket: config.bucket,
                Key: key,
            });
            const response = await client.send(command);

            if (!response.Body) {
                throw new Error('Response body is empty');
            }

            // Convert stream to Uint8Array
            const chunks: Uint8Array[] = [];
            for await (const chunk of response.Body as any) {
                chunks.push(chunk);
            }

            // Concatenate all chunks
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        } catch (err: any) {
            throw new EastError(`S3 getObject failed: ${err.message}`, {
                location: [{ filename: "s3_get_object", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    s3_head_object.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        key: ValueTypeOf<typeof StringType>
    ): Promise<ValueTypeOf<typeof S3ObjectMetadataType>> => {
        try {
            const client = createS3Client(config);
            const command = new HeadObjectCommand({
                Bucket: config.bucket,
                Key: key,
            });
            const response = await client.send(command);

            return {
                key,
                size: BigInt(response.ContentLength || 0),
                lastModified: response.LastModified || new Date(),
                contentType: response.ContentType ? variant('some', response.ContentType) : variant('none', null),
                etag: response.ETag ? variant('some', response.ETag) : variant('none', null),
            };
        } catch (err: any) {
            throw new EastError(`S3 headObject failed: ${err.message}`, {
                location: [{ filename: "s3_head_object", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    s3_delete_object.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        key: ValueTypeOf<typeof StringType>
    ): Promise<null> => {
        try {
            const client = createS3Client(config);
            const command = new DeleteObjectCommand({
                Bucket: config.bucket,
                Key: key,
            });
            await client.send(command);
            return null;
        } catch (err: any) {
            throw new EastError(`S3 deleteObject failed: ${err.message}`, {
                location: [{ filename: "s3_delete_object", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    s3_list_objects.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        prefix: ValueTypeOf<typeof StringType>,
        maxKeys: ValueTypeOf<typeof IntegerType>,
        continuationToken: ValueTypeOf<ReturnType<typeof OptionType<typeof StringType>>>
    ): Promise<ValueTypeOf<typeof S3ListResultType>> => {
        try {
            const client = createS3Client(config);

            // Clamp maxKeys to valid range (1-1000)
            const maxKeysNum = Number(maxKeys);
            const clampedMaxKeys = Math.max(1, Math.min(1000, maxKeysNum));

            const commandInput: ListObjectsV2CommandInput = {
                Bucket: config.bucket,
                Prefix: prefix,
                MaxKeys: clampedMaxKeys,
                ContinuationToken: continuationToken.type === 'some' ? continuationToken.value : undefined,
            };

            const command = new ListObjectsV2Command(commandInput);

            const response = await client.send(command);

            // Convert S3 objects to East metadata format
            // Note: ContentType is not part of _Object in ListObjectsV2, only in HeadObject/GetObject
            const objects = (response.Contents || []).map((obj: _Object) => ({
                key: obj.Key || '',
                size: BigInt(obj.Size || 0),
                lastModified: obj.LastModified || new Date(),
                contentType: variant('none', null), // ListObjectsV2 doesn't include ContentType
                etag: obj.ETag
                    ? variant('some', obj.ETag)
                    : variant('none', null),
            }));

            return {
                objects,
                isTruncated: response.IsTruncated || false,
                continuationToken: response.NextContinuationToken
                    ? variant('some', response.NextContinuationToken)
                    : variant('none', null),
            };
        } catch (err: any) {
            throw new EastError(`S3 listObjects failed: ${err.message}`, {
                location: [{ filename: "s3_list_objects", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    s3_presign_url.implement(async (
        config: ValueTypeOf<typeof S3ConfigType>,
        key: ValueTypeOf<typeof StringType>,
        expiresIn: ValueTypeOf<typeof IntegerType>
    ): Promise<string> => {
        try {
            const client = createS3Client(config);

            // Clamp expiresIn to valid range (1 second to 7 days)
            const expiresInNum = Number(expiresIn);
            const clampedExpiresIn = Math.max(1, Math.min(604800, expiresInNum));

            const command = new GetObjectCommand({
                Bucket: config.bucket,
                Key: key,
            });

            const url = await getSignedUrl(client, command, {
                expiresIn: clampedExpiresIn,
            });

            return url;
        } catch (err: any) {
            throw new EastError(`S3 presignUrl failed: ${err.message}`, {
                location: [{ filename: "s3_presign_url", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];
