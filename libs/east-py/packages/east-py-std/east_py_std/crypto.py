#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cryptographic platform functions for East.

Provides cryptographic operations for East programs running in Python.
"""

import hashlib
import secrets
import uuid

from east.runtime.platform import PlatformFunction
from east.types.types import BlobType, IntegerType, StringType
from east.types.values import EastBlob


def crypto_random_bytes_impl(length: int) -> EastBlob:
    """Generate cryptographically secure random bytes.

    Args:
        length: Number of random bytes to generate

    Returns:
        Cryptographically secure random bytes

    Raises:
        ValueError: If length is negative
    """
    if length < 0:
        raise ValueError(f"Length must be non-negative, got {length}")
    return EastBlob(secrets.token_bytes(length))


def crypto_hash_sha256_impl(data: str) -> str:
    """Compute SHA-256 hash of UTF-8 string.

    Args:
        data: UTF-8 string to hash

    Returns:
        64-character lowercase hexadecimal hash string
    """
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def crypto_hash_sha256_bytes_impl(data: EastBlob) -> EastBlob:
    """Compute SHA-256 hash of binary data.

    Args:
        data: Binary data to hash

    Returns:
        32-byte SHA-256 hash
    """
    return EastBlob(hashlib.sha256(data).digest())


def crypto_uuid_impl() -> str:
    """Generate a version 4 UUID.

    Returns:
        36-character UUID string in standard format (8-4-4-4-12)
    """
    return str(uuid.uuid4())


# Platform function implementations
crypto_impl = [
    PlatformFunction(
        name="crypto_random_bytes",
        inputs=[IntegerType],
        output=BlobType,
        type="sync",
        fn=crypto_random_bytes_impl,
    ),
    PlatformFunction(
        name="crypto_hash_sha256",
        inputs=[StringType],
        output=StringType,
        type="sync",
        fn=crypto_hash_sha256_impl,
    ),
    PlatformFunction(
        name="crypto_hash_sha256_bytes",
        inputs=[BlobType],
        output=BlobType,
        type="sync",
        fn=crypto_hash_sha256_bytes_impl,
    ),
    PlatformFunction(
        name="crypto_uuid",
        inputs=[],
        output=StringType,
        type="sync",
        fn=crypto_uuid_impl,
    ),
]


__all__ = ["crypto_impl"]
