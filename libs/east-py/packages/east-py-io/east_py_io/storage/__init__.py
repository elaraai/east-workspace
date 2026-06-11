#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Storage module - S3 and S3-compatible object storage.

The ``s3_*_impl`` functions are plain Python callables taking and returning
East values and can be called directly from project code without an IR
round-trip.
"""

from east_py_io.storage.s3 import (
    S3ConfigType,
    S3ListResultType,
    S3ObjectMetadataType,
    s3_delete_object_impl,
    s3_get_object_impl,
    s3_head_object_impl,
    s3_impl,
    s3_list_objects_impl,
    s3_presign_url_impl,
    s3_put_object_impl,
)

__all__ = [
    # Platform registration
    "s3_impl",
    # Directly-callable implementations
    "s3_put_object_impl",
    "s3_get_object_impl",
    "s3_head_object_impl",
    "s3_delete_object_impl",
    "s3_list_objects_impl",
    "s3_presign_url_impl",
    # East type definitions
    "S3ConfigType",
    "S3ObjectMetadataType",
    "S3ListResultType",
]
