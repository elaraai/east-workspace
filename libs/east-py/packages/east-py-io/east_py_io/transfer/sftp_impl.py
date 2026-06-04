#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""SFTP platform functions for East.

Provides SFTP file transfer operations for East programs.
"""

import importlib.util
import uuid
from typing import Any

from east.runtime.platform import platform_function, platform_functions

_HAS_SFTP_SUPPORT = importlib.util.find_spec("asyncssh") is not None


def _check_sftp_support() -> None:
    """Check if SFTP support is available."""
    if not _HAS_SFTP_SUPPORT:
        raise NotImplementedError(
            "SFTP support requires the 'sftp' extra. "
            "Add east-py-io[sftp] to your pyproject.toml dependencies."
        )
from east.types.types import BlobType, NullType, StringType
from east.types.values import EastArray, EastBlob, EastStruct

from .types import ConnectionHandleType, FileEntryType, FileListType, SftpConfigType

# Connection storage
_connections: dict[str, tuple[Any, Any]] = {}


@platform_function(
    name="sftp_connect",
    inputs=[SftpConfigType],
    output=ConnectionHandleType,
)
async def sftp_connect_impl(config: EastStruct) -> str:
    """Connect to an SFTP server."""
    _check_sftp_support()
    import asyncssh

    try:
        host = config["host"]
        port = int(config["port"])
        username = config["username"]

        password_opt = config["password"]
        password = password_opt.value if password_opt.type == "some" else None

        private_key_opt = config["privateKey"]
        private_key = private_key_opt.value if private_key_opt.type == "some" else None

        # Connect with password or key
        if private_key:
            conn = await asyncssh.connect(
                host,
                port=port,
                username=username,
                client_keys=[private_key],
                known_hosts=None,
            )
        else:
            conn = await asyncssh.connect(
                host,
                port=port,
                username=username,
                password=password,
                known_hosts=None,
            )

        sftp = await conn.start_sftp_client()

        handle = str(uuid.uuid4())
        _connections[handle] = (conn, sftp)

        return handle
    except Exception as e:
        raise Exception(f"SFTP connection failed: {e}") from e


@platform_function(
    name="sftp_put",
    inputs=[ConnectionHandleType, StringType, BlobType],
    output=NullType,
)
async def sftp_put_impl(handle: str, remote_path: str, data: EastBlob) -> None:
    """Upload a file to SFTP server."""
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        async with sftp.open(remote_path, "wb") as f:
            await f.write(bytes(data))
    except Exception as e:
        raise Exception(f"SFTP put failed: {e}") from e


@platform_function(
    name="sftp_get",
    inputs=[ConnectionHandleType, StringType],
    output=BlobType,
)
async def sftp_get_impl(handle: str, remote_path: str) -> EastBlob:
    """Download a file from SFTP server."""
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        async with sftp.open(remote_path, "rb") as f:
            data = await f.read()
            return EastBlob(data if isinstance(data, bytes) else data.encode())
    except Exception as e:
        raise Exception(f"SFTP get failed: {e}") from e


@platform_function(
    name="sftp_list",
    inputs=[ConnectionHandleType, StringType],
    output=FileListType,
)
async def sftp_list_impl(handle: str, remote_path: str) -> EastArray:
    """List files in a directory on SFTP server."""
    import asyncssh

    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]

        entries: EastArray = EastArray(FileEntryType, [])
        async for entry in sftp.scandir(remote_path):
            entries.append(
                EastStruct(
                    {
                        "name": entry.filename,
                        "path": f"{remote_path}/{entry.filename}",
                        "size": entry.attrs.size or 0,
                        "isDirectory": entry.attrs.type == asyncssh.FILEXFER_TYPE_DIRECTORY,
                        "modifiedTime": str(entry.attrs.mtime or ""),
                    }
                )
            )

        return entries
    except Exception as e:
        raise Exception(f"SFTP list failed: {e}") from e


@platform_function(
    name="sftp_delete",
    inputs=[ConnectionHandleType, StringType],
    output=NullType,
)
async def sftp_delete_impl(handle: str, remote_path: str) -> None:
    """Delete a file from SFTP server."""
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        _, sftp = _connections[handle]
        await sftp.remove(remote_path)
    except Exception as e:
        raise Exception(f"SFTP delete failed: {e}") from e


@platform_function(
    name="sftp_close",
    inputs=[ConnectionHandleType],
    output=NullType,
)
async def sftp_close_impl(handle: str) -> None:
    """Close SFTP connection."""
    try:
        if handle not in _connections:
            raise Exception(f"Invalid connection handle: {handle}")

        conn, sftp = _connections[handle]
        sftp.exit()
        conn.close()
        del _connections[handle]
    except Exception as e:
        raise Exception(f"SFTP close failed: {e}") from e


@platform_function(
    name="sftp_close_all",
    inputs=[],
    output=NullType,
)
async def sftp_close_all_impl() -> None:
    """Close all SFTP connections."""
    for conn, sftp in _connections.values():
        try:
            sftp.exit()
            conn.close()
        except Exception:
            pass
    _connections.clear()


# Collected from the @platform_function decorations above.
sftp_impl = platform_functions(__name__)

__all__ = [
    "sftp_impl",
    "sftp_connect_impl",
    "sftp_put_impl",
    "sftp_get_impl",
    "sftp_list_impl",
    "sftp_delete_impl",
    "sftp_close_impl",
    "sftp_close_all_impl",
]
