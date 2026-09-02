#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""S3 platform functions for East.

Provides S3 and S3-compatible object storage operations for East programs,
including upload, download, delete, list, and presigned URL generation.  The
``s3_*_impl`` functions are plain Python callables taking and returning East
values and can be called directly from project code without an IR round-trip.
"""

import importlib.util
from datetime import datetime
from typing import Any

from east.runtime.platform import platform_function, platform_functions

_HAS_S3_SUPPORT = importlib.util.find_spec("boto3") is not None


def _check_s3_support() -> None:
    """Raise if the s3 extra (boto3) isn't installed."""
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

S3ConfigType = StructType(
    [
        ("region", StringType),
        ("bucket", StringType),
        ("accessKeyId", OptionType(StringType)),
        ("secretAccessKey", OptionType(StringType)),
        ("endpoint", OptionType(StringType)),
    ]
)
"""S3 or S3-compatible object storage connection configuration.

Fields: ``region`` (``String`` - AWS region name, e.g. ``"us-east-1"``),
``bucket`` (``String``), ``accessKeyId`` (``Option<String>`` - AWS access key;
falls back to the SDK credential chain when absent),
``secretAccessKey`` (``Option<String>`` - AWS secret key; paired with
``accessKeyId``), ``endpoint`` (``Option<String>`` - custom endpoint URL for
S3-compatible stores such as MinIO or Cloudflare R2; omit for AWS).
"""

S3ObjectMetadataType = StructType(
    [
        ("key", StringType),
        ("size", IntegerType),
        ("lastModified", DateTimeType),
        ("contentType", OptionType(StringType)),
        ("etag", OptionType(StringType)),
    ]
)
"""Metadata for a single S3 object returned by ``s3_head_object`` / ``s3_list_objects``.

Fields: ``key`` (``String`` - object key), ``size`` (``Integer`` - bytes),
``lastModified`` (``DateTime``), ``contentType`` (``Option<String>`` - MIME
type; absent in list results), ``etag`` (``Option<String>`` - object ETag).
"""

S3ListResultType = StructType(
    [
        ("objects", ArrayType(S3ObjectMetadataType)),
        ("isTruncated", BooleanType),
        ("continuationToken", OptionType(StringType)),
    ]
)
"""Paginated listing result from ``s3_list_objects``.

Fields: ``objects`` (``Array<S3ObjectMetadataType>``),
``isTruncated`` (``Boolean`` - ``True`` when more pages follow),
``continuationToken`` (``Option<String>`` - pass as the
``continuation_token`` argument of the next call to retrieve the next page).
"""


def create_s3_client(config: EastStruct) -> Any:
    """Create a boto3 S3 client from an ``S3ConfigType`` struct.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see type definition above.

    Returns:
        Configured boto3 S3 client (``botocore.client.S3``).

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
    """
    _check_s3_support()
    import boto3
    from botocore.client import Config

    access_key_id = None
    secret_access_key = None

    access_key_opt = config["accessKeyId"]
    secret_key_opt = config["secretAccessKey"]

    if access_key_opt.type == "some":
        access_key_id = access_key_opt.value
    if secret_key_opt.type == "some":
        secret_access_key = secret_key_opt.value

    endpoint_url = None
    endpoint_opt = config["endpoint"]
    if endpoint_opt.type == "some":
        endpoint_url = endpoint_opt.value

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


@platform_function(
    name="s3_put_object",
    inputs=[S3ConfigType, StringType, BlobType],
    output=NullType,
)
async def s3_put_object_impl(config: EastStruct, key: str, data: EastBlob) -> None:
    """Upload an object to an S3 bucket.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) with fields:

            - ``region`` (``String``): AWS region.
            - ``bucket`` (``String``): destination bucket name.
            - ``accessKeyId`` (``Option<String>``): AWS access key ID.
            - ``secretAccessKey`` (``Option<String>``): AWS secret access key.
            - ``endpoint`` (``Option<String>``): custom endpoint URL for
              S3-compatible stores; omit for AWS.

        key: ``String`` - destination object key (path) within the bucket.
        data: ``Blob`` (``EastBlob``) - binary content to upload.

    Returns:
        ``Null`` on success.

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on upload failure.
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        client.put_object(Bucket=bucket, Key=key, Body=bytes(data))
    except ClientError as e:
        raise Exception(f"S3 putObject failed: {e}") from e


@platform_function(
    name="s3_get_object",
    inputs=[S3ConfigType, StringType],
    output=BlobType,
)
async def s3_get_object_impl(config: EastStruct, key: str) -> EastBlob:
    """Download an object from an S3 bucket.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see :func:`s3_put_object_impl`.
        key: ``String`` - object key (path) within the bucket.

    Returns:
        ``Blob`` (``EastBlob``) - raw object content.

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on download failure (e.g. key not found).
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        response = client.get_object(Bucket=bucket, Key=key)
        return EastBlob(response["Body"].read())
    except ClientError as e:
        raise Exception(f"S3 getObject failed: {e}") from e


@platform_function(
    name="s3_head_object",
    inputs=[S3ConfigType, StringType],
    output=S3ObjectMetadataType,
)
async def s3_head_object_impl(config: EastStruct, key: str) -> EastStruct:
    """Fetch metadata for an S3 object without downloading its body.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see :func:`s3_put_object_impl`.
        key: ``String`` - object key (path) within the bucket.

    Returns:
        ``S3ObjectMetadataType`` (``EastStruct``): ``key`` (``String``),
        ``size`` (``Integer`` bytes), ``lastModified`` (``DateTime``),
        ``contentType`` (``Option<String>``), ``etag`` (``Option<String>``).

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on failure (e.g. key not found).
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


@platform_function(
    name="s3_delete_object",
    inputs=[S3ConfigType, StringType],
    output=NullType,
)
async def s3_delete_object_impl(config: EastStruct, key: str) -> None:
    """Delete an object from an S3 bucket.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see :func:`s3_put_object_impl`.
        key: ``String`` - object key (path) to delete.

    Returns:
        ``Null`` on success.

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on deletion failure.
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]
        client.delete_object(Bucket=bucket, Key=key)
    except ClientError as e:
        raise Exception(f"S3 deleteObject failed: {e}") from e


@platform_function(
    name="s3_list_objects",
    inputs=[S3ConfigType, StringType, IntegerType, OptionType(StringType)],
    output=S3ListResultType,
)
async def s3_list_objects_impl(
    config: EastStruct, prefix: str, max_keys: int, continuation_token: EastVariant
) -> EastStruct:
    """List objects in an S3 bucket filtered by a key prefix.

    Supports pagination via ``continuation_token``; ``max_keys`` is clamped
    to the S3 range of 1-1000.

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see :func:`s3_put_object_impl`.
        prefix: ``String`` - key prefix to filter results.
        max_keys: ``Integer`` - maximum objects to return per page; clamped
            to ``[1, 1000]``.
        continuation_token: ``Option<String>`` (``EastVariant``) - token
            from a previous call's ``continuationToken`` field; pass
            ``none`` for the first page.

    Returns:
        ``S3ListResultType`` (``EastStruct``): ``objects``
        (``Array<S3ObjectMetadataType>``), ``isTruncated`` (``Boolean``),
        ``continuationToken`` (``Option<String>`` - present when
        ``isTruncated`` is ``True``).

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on listing failure.
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]

        clamped_max_keys = max(1, min(1000, max_keys))

        kwargs: dict[str, Any] = {
            "Bucket": bucket,
            "Prefix": prefix,
            "MaxKeys": clamped_max_keys,
        }
        if continuation_token.type == "some":
            kwargs["ContinuationToken"] = continuation_token.value

        response = client.list_objects_v2(**kwargs)

        objects: EastArray = EastArray(S3ObjectMetadataType, [])
        for obj in response.get("Contents", []):
            etag: EastVariant = (
                EastVariant("some", obj["ETag"]) if obj.get("ETag") else EastVariant("none", None)
            )

            objects.push_last(
                EastStruct(
                    {
                        "key": obj.get("Key", ""),
                        "size": obj.get("Size", 0),
                        "lastModified": obj.get("LastModified", datetime.now()),
                        "contentType": EastVariant("none", None),
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


@platform_function(
    name="s3_presign_url",
    inputs=[S3ConfigType, StringType, IntegerType],
    output=StringType,
)
async def s3_presign_url_impl(config: EastStruct, key: str, expires_in: int) -> str:
    """Generate a presigned GET URL for temporary, unauthenticated object access.

    ``expires_in`` is clamped to the S3-supported range of 1 second to 7 days
    (604800 seconds).

    Args:
        config: ``S3ConfigType`` (``EastStruct``) - see :func:`s3_put_object_impl`.
        key: ``String`` - object key (path) within the bucket.
        expires_in: ``Integer`` - URL validity period in seconds; clamped to
            ``[1, 604800]``.

    Returns:
        ``String`` - presigned URL valid for the specified duration.

    Raises:
        NotImplementedError: the ``s3`` extra (boto3) is not installed.
        Exception: S3 ``ClientError`` on URL generation failure.
    """
    from botocore.exceptions import ClientError

    try:
        client = create_s3_client(config)
        bucket = config["bucket"]

        clamped_expires_in = max(1, min(604800, expires_in))

        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=clamped_expires_in,
        )

        return url
    except ClientError as e:
        raise Exception(f"S3 presignUrl failed: {e}") from e


# Collected from the @platform_function decorations above.
s3_impl = platform_functions(__name__)


__all__ = [
    "s3_impl",
    "s3_put_object_impl",
    "s3_get_object_impl",
    "s3_head_object_impl",
    "s3_delete_object_impl",
    "s3_list_objects_impl",
    "s3_presign_url_impl",
    "S3ConfigType",
    "S3ObjectMetadataType",
    "S3ListResultType",
]
