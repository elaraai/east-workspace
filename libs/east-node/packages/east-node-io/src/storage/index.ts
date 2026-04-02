/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cloud storage platform functions.
 *
 * Provides S3 and S3-compatible object storage operations for East programs,
 * supporting upload, download, delete, list, and presigned URL generation.
 *
 * @packageDocumentation
 */

// Export individual modules
export * from "./s3.js";
export * from "./types.js";

// Import for grouped exports
import {
    s3_put_object,
    s3_get_object,
    s3_head_object,
    s3_delete_object,
    s3_list_objects,
    s3_presign_url,
    S3Impl
} from "./s3.js";
import {
    S3ConfigType,
    S3ObjectMetadataType,
    S3ListResultType
} from "./types.js";

/**
 * Cloud storage platform functions.
 *
 * Provides S3 and S3-compatible object storage operations for East programs,
 * including upload, download, delete, list, and presigned URL generation.
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
 *         accessKeyId: variant('some',"AKIAIOSFODNN7EXAMPLE"),
 *         secretAccessKey: variant('some',"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
 *         endpoint: variant('none', null),
 *     });
 *
 *     // Upload the file
 *     $(Storage.S3.putObject(config, filename, data));
 *
 *     // Generate presigned URL for sharing (valid for 1 hour)
 *     $.return(Storage.S3.presignUrl(config, filename, 3600n));
 * });
 *
 * const compiled = East.compileAsync(uploadFile.toIR(), Storage.S3.Implementation);
 * const shareableUrl = await compiled("report.pdf", pdfBlob);
 * ```
 */
export const Storage = {
    /**
     * S3 and S3-compatible object storage operations.
     *
     * Provides platform functions for Amazon S3, MinIO, DigitalOcean Spaces,
     * and other S3-compatible object storage services.
     */
    S3: {
        /**
         * Uploads an object to S3.
         *
         * Uploads binary data to an S3 bucket with the specified key (path).
         * Overwrites existing objects with the same key.
         *
         * @example
         * ```ts
         * const uploadFile = East.function([StringType, BlobType], NullType, ($, filename, data) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('none', null),
         *         secretAccessKey: variant('none', null),
         *         endpoint: variant('none', null),
         *     });
         *
         *     $(Storage.S3.putObject(config, filename, data));
         * });
         *
         * const compiled = East.compileAsync(uploadFile.toIR(), Storage.S3.Implementation);
         * await compiled("report.pdf", pdfData);
         * ```
         */
        putObject: s3_put_object,

        /**
         * Downloads an object from S3.
         *
         * Retrieves binary data from an S3 bucket by key (path).
         * Returns the object data as a Blob (Uint8Array).
         *
         * @example
         * ```ts
         * const downloadFile = East.function([StringType], BlobType, ($, filename) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('none', null),
         *         secretAccessKey: variant('none', null),
         *         endpoint: variant('none', null),
         *     });
         *
         *     $.return(Storage.S3.getObject(config, filename));
         * });
         *
         * const compiled = East.compileAsync(downloadFile.toIR(), Storage.S3.Implementation);
         * await compiled("report.pdf");  // Uint8Array containing PDF data
         * ```
         */
        getObject: s3_get_object,

        /**
         * Retrieves object metadata without downloading.
         *
         * Gets metadata for an S3 object including size, ETag (hash), last modified time,
         * and content type. Useful for checking if a file has changed by comparing ETags.
         *
         * @example
         * ```ts
         * const getMetadata = East.function([StringType], S3ObjectMetadataType, ($, filename) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('none', null),
         *         secretAccessKey: variant('none', null),
         *         endpoint: variant('none', null),
         *     });
         *
         *     const metadata = $.let(Storage.S3.headObject(config, filename));
         *     $.return(metadata);
         * });
         *
         * const compiled = East.compileAsync(getMetadata.toIR(), Storage.S3.Implementation);
         * await compiled("report.pdf");  // {size: 12345n, contentType: variant('some', "application/pdf"), ...}
         * ```
         */
        headObject: s3_head_object,

        /**
         * Deletes an object from S3.
         *
         * Removes an object from an S3 bucket by key (path).
         * Succeeds even if the object doesn't exist (idempotent).
         *
         * @example
         * ```ts
         * const deleteFile = East.function([StringType], NullType, ($, filename) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('none', null),
         *         secretAccessKey: variant('none', null),
         *         endpoint: variant('none', null),
         *     });
         *
         *     $(Storage.S3.deleteObject(config, filename));
         * });
         *
         * const compiled = East.compileAsync(deleteFile.toIR(), Storage.S3.Implementation);
         * await compiled("old-report.pdf");
         * ```
         */
        deleteObject: s3_delete_object,

        /**
         * Lists objects in an S3 bucket with a prefix.
         *
         * Retrieves metadata for objects matching a prefix, with pagination support.
         * Returns up to `maxKeys` objects per request.
         *
         * @example
         * ```ts
         * const listFiles = East.function([StringType], S3ListResultType, ($, prefix) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('none', null),
         *         secretAccessKey: variant('none', null),
         *         endpoint: variant('none', null),
         *     });
         *
         *     $.return(Storage.S3.listObjects(config, prefix, 100n, variant('none', null)));
         * });
         *
         * const compiled = East.compileAsync(listFiles.toIR(), Storage.S3.Implementation);
         * const result = await compiled("files/");  // {objects: [...], isTruncated: false, ...}
         * ```
         */
        listObjects: s3_list_objects,

        /**
         * Generates a presigned URL for temporary access to an S3 object.
         *
         * Creates a signed URL that grants temporary access to an object without
         * requiring AWS credentials. Useful for sharing files or client-side uploads.
         *
         * @example
         * ```ts
         * const shareFile = East.function([StringType], StringType, ($, filename) => {
         *     const config = $.let({
         *         region: "us-east-1",
         *         bucket: "my-bucket",
         *         accessKeyId: variant('some',"AKIAIOSFODNN7EXAMPLE"),
         *         secretAccessKey: variant('some',"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
         *         endpoint: variant('none', null),
         *     });
         *
         *     $.return(Storage.S3.presignUrl(config, filename, 3600n)); // 1 hour expiration
         * });
         *
         * const compiled = East.compileAsync(shareFile.toIR(), Storage.S3.Implementation);
         * const url = await compiled("report.pdf");  // "https://my-bucket.s3.amazonaws.com/..."
         * ```
         */
        presignUrl: s3_presign_url,

        /**
         * Node.js implementation of S3 platform functions.
         *
         * Pass this to East.compileAsync() to enable S3 operations.
         */
        Implementation: S3Impl,

        /**
         * Type definitions for S3 operations.
         */
        Types: {
            /**
             * S3 connection configuration type.
             */
            Config: S3ConfigType,

            /**
             * S3 object metadata type.
             */
            ObjectMetadata: S3ObjectMetadataType,

            /**
             * S3 list objects result type.
             */
            ListResult: S3ListResultType,
        },
    },
} as const;
