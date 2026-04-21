#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""CLI argument parsing and main entry point."""

import argparse
import sys
from pathlib import Path

from east.runtime.errors import EastError

from east_py_cli.loader import get_platform_version, load_platform
from east_py_cli.runner import run_program


def create_parser() -> argparse.ArgumentParser:
    """Create the argument parser."""
    parser = argparse.ArgumentParser(
        prog="east-py",
        description="Run East IR programs with Python platform functions",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # run command
    run_parser = subparsers.add_parser("run", help="Run an East IR program")
    run_parser.add_argument(
        "ir_file",
        type=Path,
        help="Path to IR file (.beast2, .beast, .east, or .json)",
    )
    run_parser.add_argument(
        "-p",
        "--package",
        action="append",
        default=[],
        metavar="PACKAGE",
        help="Platform package providing functions (can be repeated)",
    )
    run_parser.add_argument(
        "-i",
        "--input",
        action="append",
        default=[],
        type=Path,
        metavar="FILE",
        help="Input data file (can be repeated, order matches function parameters)",
    )
    run_parser.add_argument(
        "-o",
        "--output",
        type=Path,
        metavar="FILE",
        help="Output file path for result",
    )
    run_parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )

    # version command
    version_parser = subparsers.add_parser("version", help="Show version information")
    version_parser.add_argument(
        "-p",
        "--package",
        action="append",
        default=[],
        metavar="PACKAGE",
        help="Platform package to check (can be repeated)",
    )

    return parser


def cmd_run(args: argparse.Namespace) -> int:
    """Execute the run command."""
    # Validate IR file exists
    if not args.ir_file.exists():
        print(f"Error: IR file not found: {args.ir_file}", file=sys.stderr)
        return 1

    # Validate input files exist
    for input_file in args.input:
        if not input_file.exists():
            print(f"Error: Input file not found: {input_file}", file=sys.stderr)
            return 1

    try:
        # Load platform functions from packages
        platform_fns = []
        for package in args.package:
            try:
                fns = load_platform(package)
                platform_fns.extend(fns)
            except (ImportError, ValueError) as e:
                print(f"Error: {e}", file=sys.stderr)
                return 1

        # Compile and run — IR goes straight from file to east-c, no Python round-trip
        run_program(
            ir_file=args.ir_file,
            platform_fns=platform_fns,
            packages=list(args.package),
            input_files=args.input,
            output_file=args.output,
            verbose=args.verbose,
        )

        return 0

    except Exception as e:
        if isinstance(e, EastError):
            # Show clean IR stack trace for East errors
            print(f"Error: {e}", file=sys.stderr)
        else:
            # Show full traceback for unexpected errors
            import traceback

            print(f"Error: {e}", file=sys.stderr)
            traceback.print_exc()
        return 1


def cmd_version(args: argparse.Namespace) -> int:
    """Execute the version command."""
    from east_py_cli import __version__ as cli_version

    print(f"east-py-cli {cli_version}")

    # Try to get east-py version
    try:
        import east

        cy = east.CYTHON_EXTENSIONS
        accel = f"cython: {', '.join(cy)}" if cy else "pure python"
        print(f"east-py {getattr(east, '__version__', 'unknown')} ({accel})")
    except ImportError:
        print("east-py: not installed")

    # Check for specified platforms
    if args.package:
        print("\nPlatforms:")
        for package in args.package:
            try:
                fns = load_platform(package)
                version = get_platform_version(package)
                print(f"  {package} {version} ({len(fns)} platform functions)")
            except ImportError:
                print(f"  {package}: not installed")
            except ValueError as e:
                print(f"  {package}: error ({e})")

    return 0


def main() -> None:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if args.command == "run":
        sys.exit(cmd_run(args))
    elif args.command == "version":
        sys.exit(cmd_version(args))
    else:
        parser.print_help()
        sys.exit(1)
