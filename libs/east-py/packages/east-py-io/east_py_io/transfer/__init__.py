#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Transfer module - FTP and SFTP file transfer.

The ``*_impl`` functions are plain Python callables taking and returning East
values and can be called directly from project code without an IR round-trip.
"""

from east_py_io.transfer.ftp_impl import (
    ftp_close_all_impl,
    ftp_close_impl,
    ftp_connect_impl,
    ftp_delete_impl,
    ftp_get_impl,
    ftp_impl,
    ftp_list_impl,
    ftp_put_impl,
)
from east_py_io.transfer.sftp_impl import (
    sftp_close_all_impl,
    sftp_close_impl,
    sftp_connect_impl,
    sftp_delete_impl,
    sftp_get_impl,
    sftp_impl,
    sftp_list_impl,
    sftp_put_impl,
)
from east_py_io.transfer.types import (
    ConnectionHandleType,
    FileEntryType,
    FileListType,
    FtpConfigType,
    SftpConfigType,
)

__all__ = [
    # Types
    "FtpConfigType",
    "SftpConfigType",
    "ConnectionHandleType",
    "FileEntryType",
    "FileListType",
    # FTP
    "ftp_impl",
    "ftp_connect_impl",
    "ftp_put_impl",
    "ftp_get_impl",
    "ftp_list_impl",
    "ftp_delete_impl",
    "ftp_close_impl",
    "ftp_close_all_impl",
    # SFTP
    "sftp_impl",
    "sftp_connect_impl",
    "sftp_put_impl",
    "sftp_get_impl",
    "sftp_list_impl",
    "sftp_delete_impl",
    "sftp_close_impl",
    "sftp_close_all_impl",
]
