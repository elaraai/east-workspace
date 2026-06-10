#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""NoSQL platform functions for East - Redis caching and MongoDB document storage.

The ``*_impl`` functions are plain Python callables taking and returning East
values - import them directly from a project's own ``@platform_function`` to
reuse the implementations without an IR round-trip. The East type definitions
are re-exported here for building inputs with ``coerce_to`` and validating
outputs.
"""

from east_py_io.nosql.mongodb import (
    mongo_close_all_impl,
    mongo_close_impl,
    mongo_connect_impl,
    mongo_delete_many_impl,
    mongo_delete_one_impl,
    mongo_find_impl,
    mongo_find_one_impl,
    mongo_insert_one_impl,
    mongo_update_one_impl,
    mongodb_impl,
)
from east_py_io.nosql.redis_impl import (
    redis_close_all_impl,
    redis_close_impl,
    redis_connect_impl,
    redis_del_impl,
    redis_get_impl,
    redis_impl,
    redis_set_impl,
    redis_setex_impl,
)
from east_py_io.nosql.types import (
    BsonValueType,
    ConnectionHandleType,
    MongoConfigType,
    MongoDocumentType,
    MongoFindOptionsType,
    RedisConfigType,
)

__all__ = [
    # East type definitions
    "RedisConfigType",
    "MongoConfigType",
    "MongoFindOptionsType",
    "ConnectionHandleType",
    "BsonValueType",
    "MongoDocumentType",
    # Platform registration lists
    "redis_impl",
    "mongodb_impl",
    # Directly-callable Redis implementations
    "redis_connect_impl",
    "redis_get_impl",
    "redis_set_impl",
    "redis_setex_impl",
    "redis_del_impl",
    "redis_close_impl",
    "redis_close_all_impl",
    # Directly-callable MongoDB implementations
    "mongo_connect_impl",
    "mongo_insert_one_impl",
    "mongo_find_one_impl",
    "mongo_find_impl",
    "mongo_update_one_impl",
    "mongo_delete_one_impl",
    "mongo_delete_many_impl",
    "mongo_close_impl",
    "mongo_close_all_impl",
]
