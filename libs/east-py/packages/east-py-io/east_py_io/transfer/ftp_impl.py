#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""FTP platform functions for East.

Provides FTP file transfer operations for East programs.
"""

import contextlib
import importlib.util
import uuid
from typing import Any

from east.runtime.platform import PlatformFunction

_HAS_FTP_SUPPORT = importlib.util.find_spec("aioftp") is not None


def _check_ftp_support() -> None:
    """Check if FTP support is available."""
    if not _HAS_FTP_SUPPORT:
        raise NotImplementedError(
            "FTP support requires the 'ftp' extra. "
            "Add east-py-io[ftp] to your pyproject.toml dependencies."
        )
from east.types.types import BlobType, NullType, StringType
from east.types.values import EastArray, EastBlob, EastStruct

from .types import ConnectionHandleType, FileEntryType, FileListType, FtpConfigType

# Connection storage
_clients: dict[str, Any] = {}


async def ftp_connect_impl(config: EastStruct) -> str:
    """Connect to an FTP server."""
    _check_ftp_support()
    import aioftp

    try:
        host = config["host"]
        port = int(config["port"])
        user = config["user"]
        password = config["password"]

        client = aioftp.Client()
        await client.connect(host, port)
        await client.login(user, password)

        handle = str(uuid.uuid4())
        _clients[handle] = client

        return handle
    except Exception as e:
        raise Exception(f"FTP connection failed: {e}") from e


async def ftp_put_impl(handle: str, remote_path: str, data: EastBlob) -> None:
    """Upload a file to FTP server."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        # Write data using stream
        async with client.upload_stream(remote_path) as stream:
            await stream.write(bytes(data))
    except Exception as e:
        raise Exception(f"FTP put failed: {e}") from e


async def ftp_get_impl(handle: str, remote_path: str) -> EastBlob:
    """Download a file from FTP server."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        # Read data using stream
        data = b""
        async with client.download_stream(remote_path) as stream:
            async for block in stream.iter_by_block():
                data += block

        return EastBlob(data)
    except Exception as e:
        raise Exception(f"FTP get failed: {e}") from e


async def ftp_list_impl(handle: str, remote_path: str) -> EastArray:
    """List files in a directory on FTP server."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]

        entries: EastArray = EastArray(FileEntryType, [])
        async for path, info in client.list(remote_path):
            entries.append(
                EastStruct(
                    {
                        "name": path.name,
                        "path": str(path),
                        "size": int(info.get("size", 0)),
                        "isDirectory": info.get("type") == "dir",
                        "modifiedTime": info.get("modify", ""),
                    }
                )
            )

        return entries
    except Exception as e:
        raise Exception(f"FTP list failed: {e}") from e


async def ftp_delete_impl(handle: str, remote_path: str) -> None:
    """Delete a file from FTP server."""
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        await client.remove(remote_path)
    except Exception as e:
        raise Exception(f"FTP delete failed: {e}") from e


def ftp_close_impl(handle: str) -> None:
    """Close FTP connection.

    Note: This is a sync function that does a hard close (no QUIT command)
    to match the TypeScript implementation which is also sync.
    """
    try:
        if handle not in _clients:
            raise Exception(f"Invalid connection handle: {handle}")

        client = _clients[handle]
        # Hard close - just close the underlying stream without async QUIT
        # This matches TypeScript behavior where ftp_close is sync
        if hasattr(client, "stream") and client.stream:
            client.stream.close()
        del _clients[handle]
    except Exception as e:
        raise Exception(f"FTP close failed: {e}") from e


async def ftp_close_all_impl() -> None:
    """Close all FTP connections."""
    for client in _clients.values():
        with contextlib.suppress(Exception):
            await client.quit()
    _clients.clear()


# Platform function implementations
ftp_impl = [
    PlatformFunction(
        name="ftp_connect",
        inputs=[FtpConfigType],
        output=ConnectionHandleType,
        type="async",
        fn=ftp_connect_impl,
    ),
    PlatformFunction(
        name="ftp_put",
        inputs=[ConnectionHandleType, StringType, BlobType],
        output=NullType,
        type="async",
        fn=ftp_put_impl,
    ),
    PlatformFunction(
        name="ftp_get",
        inputs=[ConnectionHandleType, StringType],
        output=BlobType,
        type="async",
        fn=ftp_get_impl,
    ),
    PlatformFunction(
        name="ftp_list",
        inputs=[ConnectionHandleType, StringType],
        output=FileListType,
        type="async",
        fn=ftp_list_impl,
    ),
    PlatformFunction(
        name="ftp_delete",
        inputs=[ConnectionHandleType, StringType],
        output=NullType,
        type="async",
        fn=ftp_delete_impl,
    ),
    PlatformFunction(
        name="ftp_close",
        inputs=[ConnectionHandleType],
        output=NullType,
        type="sync",
        fn=ftp_close_impl,
    ),
    PlatformFunction(
        name="ftp_close_all",
        inputs=[],
        output=NullType,
        type="async",
        fn=ftp_close_all_impl,
    ),
]

__all__ = [
    "ftp_impl",
    "ftp_connect_impl",
    "ftp_put_impl",
    "ftp_get_impl",
    "ftp_list_impl",
    "ftp_delete_impl",
    "ftp_close_impl",
    "ftp_close_all_impl",
]
