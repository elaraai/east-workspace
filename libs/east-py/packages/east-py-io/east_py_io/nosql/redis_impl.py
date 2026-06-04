#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Redis platform functions for East.

Provides Redis key-value store operations for East programs,
including get, set, delete, and expiration operations.
"""

import importlib.util
import uuid
from typing import Any

from east.runtime.platform import platform_function, platform_functions

_HAS_REDIS_SUPPORT = importlib.util.find_spec("redis") is not None


def _check_redis_support() -> None:
    """Check if Redis support is available."""
    if not _HAS_REDIS_SUPPORT:
        raise NotImplementedError(
            "Redis support requires the 'redis' extra. "
            "Add east-py-io[redis] to your pyproject.toml dependencies."
        )
from east.types.types import IntegerType, NullType, OptionType, StringType
from east.types.values import EastStruct, EastVariant

from .types import ConnectionHandleType, RedisConfigType

# Connection storage
_clients: dict[str, Any] = {}


@platform_function(
    name="redis_connect",
    inputs=[RedisConfigType],
    output=ConnectionHandleType,
)
async def redis_connect_impl(config: EastStruct) -> str:
    """Connect to a Redis server."""
    _check_redis_support()
    import redis.asyncio as redis

    try:
        host = config["host"]
        port = int(config["port"])

        password_opt = config["password"]
        password = password_opt.value if password_opt.type == "some" else None

        db_opt = config["db"]
        db = int(db_opt.value) if db_opt.type == "some" else 0

        # Create Redis client
        client = redis.Redis(
            host=host,
            port=port,
            password=password,
            db=db,
            decode_responses=True,
        )

        # Test connection
        await client.ping()  # type: ignore[misc]

        # Generate handle
        handle = str(uuid.uuid4())
        _clients[handle] = client

        return handle
    except Exception as e:
        raise Exception(f"Redis connection failed: {e}") from e


@platform_function(
    name="redis_get",
    inputs=[ConnectionHandleType, StringType],
    output=OptionType(StringType),
)
async def redis_get_impl(handle: str, key: str) -> EastVariant:
    """Get a value by key from Redis."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        value = await client.get(key)

        if value is None:
            return EastVariant("none", None)

        return EastVariant("some", value)
    except Exception as e:
        raise Exception(f"Redis get failed: {e}") from e


@platform_function(
    name="redis_set",
    inputs=[ConnectionHandleType, StringType, StringType],
    output=NullType,
)
async def redis_set_impl(handle: str, key: str, value: str) -> None:
    """Set a key-value pair in Redis."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        await client.set(key, value)
    except Exception as e:
        raise Exception(f"Redis set failed: {e}") from e


@platform_function(
    name="redis_setex",
    inputs=[ConnectionHandleType, StringType, StringType, IntegerType],
    output=NullType,
)
async def redis_setex_impl(handle: str, key: str, value: str, ttl: int) -> None:
    """Set a key-value pair with expiration in Redis."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        await client.setex(key, ttl, value)
    except Exception as e:
        raise Exception(f"Redis setex failed: {e}") from e


@platform_function(
    name="redis_del",
    inputs=[ConnectionHandleType, StringType],
    output=IntegerType,
)
async def redis_del_impl(handle: str, key: str) -> int:
    """Delete a key from Redis."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        deleted = await client.delete(key)
        return int(deleted)
    except Exception as e:
        raise Exception(f"Redis del failed: {e}") from e


@platform_function(
    name="redis_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def redis_close_impl(handle: str) -> None:
    """Close a Redis connection."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        await client.close()
        del _clients[handle]
    except Exception as e:
        raise Exception(f"Redis close failed: {e}") from e


@platform_function(
    name="redis_close_all",
    inputs=[],
    output=NullType,
)
async def redis_close_all_impl() -> None:
    """Close all Redis connections."""
    for client in _clients.values():
        await client.close()
    _clients.clear()


# Collected from the @platform_function decorations above.
redis_impl = platform_functions(__name__)

__all__ = [
    "redis_impl",
    "redis_connect_impl",
    "redis_get_impl",
    "redis_set_impl",
    "redis_setex_impl",
    "redis_del_impl",
    "redis_close_impl",
    "redis_close_all_impl",
]
