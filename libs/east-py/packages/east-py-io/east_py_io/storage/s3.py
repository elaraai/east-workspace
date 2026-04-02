#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""S3 platform functions for East.

Provides S3 and S3-compatible object storage operations for East programs,
including upload, download, delete, list, and presigned URL generation.
"""

import importlib.util
from datetime import datetime
from typing import Any

from east.runtime.platform import PlatformFunction

_HAS_S3_SUPPORT = importlib.util.find_spec("boto3") is not None


def _check_s3_support() -> None:
    """Check if S3 support is available."""
    if not _HAS_S3_SUPPORT:
        raise NotImplementedError(
            "S3 support requires the 's3' extra. "
            "Add east-py-io[s3] to your pyproject.toml dependencies."
        )
from east.types.types import (
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
)
from east.types.values import EastArray, EastBlob, EastStruct, EastVariant

# S3 configuration type
S3ConfigType = StructType(
    [
        ("region", StringType),
        ("bucket", StringType),
        ("accessKeyId", OptionType(StringType)),
        ("secretAccessKey", OptionType(StringType)),
        ("endpoint", OptionType(StringType)),
    ]
)

# S3 object metadata type
S3ObjectMetadataType = StructType(
    [
        ("key", StringType),
        ("size", IntegerType),
        ("lastModified", DateTimeType),
        ("contentType", OptionType(StringType)),
        ("etag", OptionType(StringType)),
    ]
)

# S3 list result type
S3ListResultType = StructType(
    [
        ("objects", ArrayType(S3ObjectMetadataType)),
        ("isTruncated", BooleanType),
        ("continuationToken", OptionType(StringType)),
    ]
)


def create_s3_client(config: EastStruct) -> Any:
    """Create an S3 client from configuration.

    Args:
        config: S3 configuration struct

    Returns:
        Configured boto3 S3 client

    Raises:
        NotImplementedError: If boto3 is not installed
    """
    _check_s3_support()
    import boto3
    from botocore.client import Config

    # Extract credentials
    access_key_id = None
    secret_access_key = None

    access_key_opt = config["accessKeyId"]
    secret_key_opt = config["secretAccessKey"]

    if access_key_opt.type == "some":
        access_key_id = access_key_opt.value
    if secret_key_opt.type == "some":
        secret_access_key = secret_key_opt.value

    # Extract optional endpoint
    endpoint_url = None
    endpoint_opt = config["endpoint"]
    if endpoint_opt.type == "some":
        endpoint_url = endpoint_opt.value

    # Build client config
    session = boto3.session.Session()
    client_config = Config(signature_version="s3v4")

    client_kwargs: dict[str, Any] = {
        "service_name": "s3",
        "region_name": config["region"],
        "config": client_config,
    }

    if access_key_id and secret_access_key:
        client_kwargs["aws_access_key_id"] = access_key_id
        client_kwargs["aws_secret_access_key"] = secret_access_key

    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url

    return session.client(**client_kwargs)


async def s3_put_object_impl(config: EastStruct, key: str, data: EastBlob) -> None:
    """Upload an object to S3.

    Args:
        config: S3 configuration
        key: Object key (path) in the bucket
        data: Binary data to upload

    Raises:
        Exception: If upload fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        client.put_object(Bucket=bucket, Key=key, Body=bytes(data))
    except ClientError as e:
        raise Exception(f"S3 putObject failed: {e}") from e


async def s3_get_object_impl(config: EastStruct, key: str) -> EastBlob:
    """Download an object from S3.

    Args:
        config: S3 configuration
        key: Object key (path) in the bucket

    Returns:
        Binary data as EastBlob

    Raises:
        Exception: If download fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        response = client.get_object(Bucket=bucket, Key=key)
        return EastBlob(response["Body"].read())
    except ClientError as e:
        raise Exception(f"S3 getObject failed: {e}") from e


async def s3_head_object_impl(config: EastStruct, key: str) -> EastStruct:
    """Get object metadata without downloading.

    Args:
        config: S3 configuration
        key: Object key (path) in the bucket

    Returns:
        Object metadata struct

    Raises:
        Exception: If metadata retrieval fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        response = client.head_object(Bucket=bucket, Key=key)

        content_type: EastVariant = (
            EastVariant("some", response["ContentType"])
            if response.get("ContentType")
            else EastVariant("none", None)
        )
        etag: EastVariant = (
            EastVariant("some", response["ETag"])
            if response.get("ETag")
            else EastVariant("none", None)
        )

        return EastStruct(
            {
                "key": key,
                "size": response.get("ContentLength", 0),
                "lastModified": response.get("LastModified", datetime.now()),
                "contentType": content_type,
                "etag": etag,
            }
        )
    except ClientError as e:
        raise Exception(f"S3 headObject failed: {e}") from e


async def s3_delete_object_impl(config: EastStruct, key: str) -> None:
    """Delete an object from S3.

    Args:
        config: S3 configuration
        key: Object key (path) to delete

    Raises:
        Exception: If deletion fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        client.delete_object(Bucket=bucket, Key=key)
    except ClientError as e:
        raise Exception(f"S3 deleteObject failed: {e}") from e


async def s3_list_objects_impl(
    config: EastStruct, prefix: str, max_keys: int, continuation_token: EastVariant
) -> EastStruct:
    """List objects in an S3 bucket with a prefix.

    Args:
        config: S3 configuration
        prefix: Prefix to filter objects
        max_keys: Maximum number of objects to return
        continuation_token: Continuation token from a previous list result for pagination (None for first page)

    Returns:
        List result struct with objects and pagination

    Raises:
        Exception: If listing fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]

        # Clamp maxKeys to valid range (1-1000)
        clamped_max_keys = max(1, min(1000, max_keys))

        kwargs: dict[str, Any] = {
            "Bucket": bucket,
            "Prefix": prefix,
            "MaxKeys": clamped_max_keys,
        }
        if continuation_token.type == "some":
            kwargs["ContinuationToken"] = continuation_token.value

        response = client.list_objects_v2(**kwargs)

        # Convert objects to metadata
        objects: EastArray = EastArray(S3ObjectMetadataType, [])
        for obj in response.get("Contents", []):
            etag: EastVariant = (
                EastVariant("some", obj["ETag"]) if obj.get("ETag") else EastVariant("none", None)
            )

            objects.append(
                EastStruct(
                    {
                        "key": obj.get("Key", ""),
                        "size": obj.get("Size", 0),
                        "lastModified": obj.get("LastModified", datetime.now()),
                        "contentType": EastVariant("none", None),  # Not available in list
                        "etag": etag,
                    }
                )
            )

        next_token: EastVariant = (
            EastVariant("some", response["NextContinuationToken"])
            if response.get("NextContinuationToken")
            else EastVariant("none", None)
        )

        return EastStruct(
            {
                "objects": objects,
                "isTruncated": response.get("IsTruncated", False),
                "continuationToken": next_token,
            }
        )
    except ClientError as e:
        raise Exception(f"S3 listObjects failed: {e}") from e


async def s3_presign_url_impl(config: EastStruct, key: str, expires_in: int) -> str:
    """Generate a presigned URL for temporary access.

    Args:
        config: S3 configuration
        key: Object key (path) in the bucket
        expires_in: URL expiration time in seconds

    Returns:
        Presigned URL as string

    Raises:
        Exception: If URL generation fails
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]

        # Clamp expiresIn to valid range (1 second to 7 days)
        clamped_expires_in = max(1, min(604800, expires_in))

        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=clamped_expires_in,
        )

        return url
    except ClientError as e:
        raise Exception(f"S3 presignUrl failed: {e}") from e


# Platform function implementations
s3_impl = [
    PlatformFunction(
        name="s3_put_object",
        inputs=[S3ConfigType, StringType, BlobType],
        output=NullType,
        type="async",
        fn=s3_put_object_impl,
    ),
    PlatformFunction(
        name="s3_get_object",
        inputs=[S3ConfigType, StringType],
        output=BlobType,
        type="async",
        fn=s3_get_object_impl,
    ),
    PlatformFunction(
        name="s3_head_object",
        inputs=[S3ConfigType, StringType],
        output=S3ObjectMetadataType,
        type="async",
        fn=s3_head_object_impl,
    ),
    PlatformFunction(
        name="s3_delete_object",
        inputs=[S3ConfigType, StringType],
        output=NullType,
        type="async",
        fn=s3_delete_object_impl,
    ),
    PlatformFunction(
        name="s3_list_objects",
        inputs=[S3ConfigType, StringType, IntegerType, OptionType(StringType)],
        output=S3ListResultType,
        type="async",
        fn=s3_list_objects_impl,
    ),
    PlatformFunction(
        name="s3_presign_url",
        inputs=[S3ConfigType, StringType, IntegerType],
        output=StringType,
        type="async",
        fn=s3_presign_url_impl,
    ),
]


__all__ = ["s3_impl", "S3ConfigType", "S3ObjectMetadataType", "S3ListResultType"]
