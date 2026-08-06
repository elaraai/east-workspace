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
from east_py_cli.snapshot import read_snapshot, write_snapshot


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
        nargs="?",
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
    run_parser.add_argument(
        "--snapshot",
        type=Path,
        metavar="PATH",
        help="Write a .east-snapshot bundle (IR + inputs + manifest)",
    )
    run_parser.add_argument(
        "--from-snapshot",
        type=Path,
        metavar="PATH",
        dest="from_snapshot",
        help="Replay from a .east-snapshot bundle (exclusive with ir_file, -i, -p)",
    )
    run_parser.add_argument(
        "--emit",
        choices=("array", "set", "dict"),
        metavar="KIND",
        help="Write the output incrementally from the function's trailing emit "
        "parameter (array|set|dict)",
    )
    run_parser.add_argument(
        "--stream",
        type=int,
        metavar="N",
        help="Streamed input marker (0-based -i index; inputs currently decode "
        "eagerly on this runner)",
    )

    # convert command
    convert_parser = subparsers.add_parser(
        "convert",
        help="Decode a value file and re-encode in another format",
    )
    convert_parser.add_argument(
        "in_file", type=Path, help="Input file (.beast2, .beast, .east, or .json)"
    )
    convert_parser.add_argument(
        "-o", "--output", type=Path, metavar="FILE",
        help="Output file; format inferred from extension. Omit to print east-text to stdout.",
    )
    convert_parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable verbose output"
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
    extract = None

    # --from-snapshot is exclusive with ir_file, -i, -p
    if args.from_snapshot is not None:
        if args.ir_file or args.input or args.package:
            print(
                "Error: --from-snapshot cannot be combined with ir_file, -i, or -p",
                file=sys.stderr,
            )
            return 1
        try:
            extract = read_snapshot(args.from_snapshot)
        except Exception as e:
            print(f"Error: failed to read snapshot: {e}", file=sys.stderr)
            return 1
        args.ir_file = extract.ir_path
        args.input = extract.input_paths
        args.package = extract.packages

    try:
        # Validate IR file exists
        if args.ir_file is None:
            print(
                "Error: Missing ir_file argument (or use --from-snapshot PATH)",
                file=sys.stderr,
            )
            return 1
        if not args.ir_file.exists():
            print(f"Error: IR file not found: {args.ir_file}", file=sys.stderr)
            return 1

        # Validate input files exist
        for input_file in args.input:
            if not input_file.exists():
                print(f"Error: Input file not found: {input_file}", file=sys.stderr)
                return 1

        # Write snapshot BEFORE execution so crashes still leave the bundle.
        if args.snapshot is not None:
            try:
                from east_py_cli import __version__ as cli_version
            except ImportError:
                cli_version = "unknown"
            write_snapshot(
                out_path=args.snapshot,
                ir_path=args.ir_file,
                input_paths=list(args.input),
                packages=list(args.package),
                cli_version=f"east-py-cli {cli_version}",
            )
            if args.verbose:
                print(f"Snapshot: {args.snapshot}", file=sys.stderr)

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
            emit=getattr(args, "emit", None),
            stream_input=getattr(args, "stream", None),
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
    finally:
        if extract is not None:
            extract.cleanup()


def cmd_convert(args: argparse.Namespace) -> int:
    """Decode a value file (beast2-full auto-type) and re-emit in another format."""
    if not args.in_file.exists():
        print(f"Error: Input file not found: {args.in_file}", file=sys.stderr)
        return 1

    ext = args.in_file.suffix.lower()
    if ext not in (".beast2", ".beast"):
        print(
            f"Error: convert currently auto-decodes .beast2 only (got {ext}).",
            file=sys.stderr,
        )
        return 1

    from east.serialization._beast2_eastc import beast2_auto_to_east_text
    with open(args.in_file, "rb") as f:
        data = f.read()
    try:
        text = beast2_auto_to_east_text(data)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.output is None:
        print(text)
    else:
        out_ext = args.output.suffix.lower()
        if out_ext != ".east":
            print(
                f"Error: east-py convert currently writes .east only (got {out_ext}).",
                file=sys.stderr,
            )
            return 1
        args.output.write_text(text, encoding="utf-8")
        if args.verbose:
            print(f"Wrote {args.output} ({args.output.stat().st_size} bytes)", file=sys.stderr)
    return 0


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
    elif args.command == "convert":
        sys.exit(cmd_convert(args))
    elif args.command == "version":
        sys.exit(cmd_version(args))
    else:
        parser.print_help()
        sys.exit(1)
