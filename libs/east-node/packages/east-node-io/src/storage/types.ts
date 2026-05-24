/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared storage type definitions for East Node IO.
 *
 * Provides East type definitions for S3 and S3-compatible object storage
 * operations including configurations, metadata, and result types.
 *
 * @packageDocumentation
 */

import {
    StructType,
    OptionType,
    ArrayType,
    StringType,
    IntegerType,
    BooleanType,
    DateTimeType,
} from "@elaraai/east";

/**
 * S3 storage configuration.
 *
 * Configures connection to S3 or S3-compatible object storage services
 * (MinIO, DigitalOcean Spaces, etc.).
 */
export const S3ConfigType = StructType({
    /**
     * AWS region (e.g., "us-east-1", "eu-west-1").
     */
    region: StringType,

    /**
     * S3 bucket name.
     */
    bucket: StringType,

    /**
     * AWS access key ID for authentication.
     * Optional, defaults to AWS credential chain.
     */
    accessKeyId: OptionType(StringType),

    /**
     * AWS secret access key for authentication.
     * Optional, defaults to AWS credential chain.
     */
    secretAccessKey: OptionType(StringType),

    /**
     * Custom endpoint for S3-compatible services (e.g., "http://localhost:9000" for MinIO).
     * Optional, defaults to AWS S3 endpoint.
     */
    endpoint: OptionType(StringType),
});

/**
 * S3 object metadata.
 *
 * Represents metadata about an object stored in S3.
 */
export const S3ObjectMetadataType = StructType({
    /**
     * Object key (path) in the bucket.
     */
    key: StringType,

    /**
     * Object size in bytes.
     */
    size: IntegerType,

    /**
     * Last modified timestamp as a Date object.
     */
    lastModified: DateTimeType,

    /**
     * Content type of the object (MIME type).
     * Optional, may be None if not set.
     */
    contentType: OptionType(StringType),

    /**
     * ETag of the object (entity tag for versioning/caching).
     * Optional, may be None if not available.
     */
    etag: OptionType(StringType),
});

/**
 * S3 list objects result.
 *
 * Contains the result of listing objects in an S3 bucket with pagination support.
 */
export const S3ListResultType = StructType({
    /**
     * Array of object metadata for objects matching the prefix.
     */
    objects: ArrayType(S3ObjectMetadataType),

    /**
     * Whether the result list is truncated (more results available).
     */
    isTruncated: BooleanType,

    /**
     * Continuation token for fetching next page of results.
     * Optional, None if no more results available.
     */
    continuationToken: OptionType(StringType),
});
