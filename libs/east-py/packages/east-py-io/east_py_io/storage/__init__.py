#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Storage module - S3 and S3-compatible object storage."""

from east_py_io.storage.s3 import (
    S3ConfigType,
    S3ListResultType,
    S3ObjectMetadataType,
    s3_impl,
)

__all__ = [
    "s3_impl",
    "S3ConfigType",
    "S3ObjectMetadataType",
    "S3ListResultType",
]
