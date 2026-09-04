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
    """Raise if the redis extra is not installed."""
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
async def redis_connect(config: EastStruct) -> str:
    """Open an async Redis connection and return a connection handle.

    Connects to the Redis server described by ``config``, issues a
    ``PING`` to verify the connection, and stores the client under a
    generated handle.

    Args:
        config: ``RedisConfigType`` (``EastStruct``) with fields:

            - ``host`` (``String``): Redis server hostname or IP address.
            - ``port`` (``Integer``): Redis server port (typically 6379).
            - ``password`` (``Option<String>``): authentication password;
              absent means no password.
            - ``db`` (``Option<Integer>``): logical database index;
              default 0.
            - ``keyPrefix`` (``Option<String>``): key prefix stored for
              reference; not applied automatically by this function.

    Returns:
        ``String`` (``ConnectionHandleType``) - an opaque UUID handle
        for use with all subsequent redis_* functions.

    Raises:
        NotImplementedError: the ``redis`` extra is not installed.
        Exception: the server is unreachable or authentication fails.
    """
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
async def redis_get(handle: str, key: str) -> EastVariant:
    """Retrieve a string value from Redis by key.

    Args:
        handle: ``String`` (``ConnectionHandleType``) - connection handle
            from ``redis_connect``.
        key: ``String`` - the key to look up.

    Returns:
        ``Option<String>`` (``EastVariant``) - ``some(value)`` when the
        key exists, ``none`` when it is absent or has expired.

    Raises:
        Exception: the handle is invalid or the Redis command fails.
    """
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
async def redis_set(handle: str, key: str, value: str) -> None:
    """Set a string key-value pair in Redis with no expiration.

    Args:
        handle: ``String`` (``ConnectionHandleType``) - connection handle
            from ``redis_connect``.
        key: ``String`` - the key to write.
        value: ``String`` - the value to store.

    Returns:
        ``Null`` - always ``None`` on success.

    Raises:
        Exception: the handle is invalid or the Redis command fails.
    """
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
async def redis_setex(handle: str, key: str, value: str, ttl: int) -> None:
    """Set a string key-value pair in Redis with a TTL expiration.

    Args:
        handle: ``String`` (``ConnectionHandleType``) - connection handle
            from ``redis_connect``.
        key: ``String`` - the key to write.
        value: ``String`` - the value to store.
        ttl: ``Integer`` - time-to-live in seconds; the key is
            automatically deleted by Redis after this many seconds.

    Returns:
        ``Null`` - always ``None`` on success.

    Raises:
        Exception: the handle is invalid or the Redis command fails.
    """
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
async def redis_del(handle: str, key: str) -> int:
    """Delete a key from Redis.

    Args:
        handle: ``String`` (``ConnectionHandleType``) - connection handle
            from ``redis_connect``.
        key: ``String`` - the key to delete.

    Returns:
        ``Integer`` - the number of keys deleted (0 if the key did not
        exist, 1 if it was deleted).

    Raises:
        Exception: the handle is invalid or the Redis command fails.
    """
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
async def redis_close(handle: str) -> None:
    """Close a single Redis connection and remove its handle.

    Args:
        handle: ``String`` (``ConnectionHandleType``) - connection handle
            from ``redis_connect``.

    Returns:
        ``Null`` - always ``None`` on success.

    Raises:
        Exception: the handle is invalid or the close call fails.
    """
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
async def redis_close_all() -> None:
    """Close all open Redis connections managed by this process.

    Iterates every handle in the internal connection store, closes each
    client, then clears the store. Safe to call when no connections are
    open.

    Returns:
        ``Null`` - always ``None`` on success.

    Raises:
        NotImplementedError: the ``redis`` extra is not installed.
    """
    for client in _clients.values():
        await client.close()
    _clients.clear()


# Collected from the @platform_function decorations above.
redis_impl = platform_functions(__name__)

__all__ = [
    "redis_impl",
    "redis_connect",
    "redis_get",
    "redis_set",
    "redis_setex",
    "redis_del",
    "redis_close",
    "redis_close_all",
]
