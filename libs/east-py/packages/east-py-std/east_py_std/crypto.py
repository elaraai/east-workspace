#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Cryptographic platform functions for East.

Provides cryptographic operations for East programs running in Python.
The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip.
"""

import hashlib
import secrets
import uuid

from east.runtime.platform import platform_function, platform_functions
from east.types.types import BlobType, IntegerType, StringType
from east.types.values import EastBlob


@platform_function(name="crypto_random_bytes", inputs=[IntegerType], output=BlobType)
def crypto_random_bytes(length: int) -> EastBlob:
    """Generate cryptographically secure random bytes.

    Args:
        length: ``Integer`` (``int``) - number of random bytes to generate;
            must be non-negative.

    Returns:
        ``Blob`` (``EastBlob``) - ``length`` bytes drawn from the OS entropy
        source via :func:`secrets.token_bytes`.

    Raises:
        ValueError: If ``length`` is negative.
    """
    if length < 0:
        raise ValueError(f"Length must be non-negative, got {length}")
    return EastBlob(secrets.token_bytes(length))


@platform_function(name="crypto_hash_sha256", inputs=[StringType], output=StringType)
def crypto_hash_sha256(data: str) -> str:
    """Compute the SHA-256 hash of a UTF-8 string.

    Args:
        data: ``String`` (``str``) - input string encoded as UTF-8 before
            hashing.

    Returns:
        ``String`` (``str``) - 64-character lowercase hexadecimal digest.
    """
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@platform_function(name="crypto_hash_sha256_bytes", inputs=[BlobType], output=BlobType)
def crypto_hash_sha256_bytes(data: EastBlob) -> EastBlob:
    """Compute the SHA-256 hash of binary data.

    Args:
        data: ``Blob`` (``EastBlob``) - raw bytes to hash.

    Returns:
        ``Blob`` (``EastBlob``) - 32-byte binary SHA-256 digest.
    """
    return EastBlob(hashlib.sha256(data).digest())


@platform_function(name="crypto_uuid", inputs=[], output=StringType)
def crypto_uuid() -> str:
    """Generate a random version 4 UUID.

    Returns:
        ``String`` (``str``) - 36-character UUID string in standard
        8-4-4-4-12 hyphenated format (e.g. ``"550e8400-e29b-41d4-a716-446655440000"``).
    """
    return str(uuid.uuid4())


# Collected from the @platform_function decorations above.
crypto_impl = platform_functions(__name__)


__all__ = [
    "crypto_impl",
    "crypto_random_bytes",
    "crypto_hash_sha256",
    "crypto_hash_sha256_bytes",
    "crypto_uuid",
]
