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

    # transpile command (#627): IR file -> python builder source
    transpile_parser = subparsers.add_parser(
        "transpile",
        help="Print an East IR program as python East.function builder source",
    )
    transpile_parser.add_argument(
        "ir_file", type=Path, help="Path to IR file (.beast2, .beast, .east, or .json)")
    transpile_parser.add_argument(
        "-o", "--output", type=Path, metavar="FILE",
        help="Write the python module here (default: stdout)")
    transpile_parser.add_argument(
        "--name", default="main", metavar="NAME",
        help="The module-level name bound to the rebuilt function (default: main)")
    transpile_parser.add_argument(
        "-p", "--package", action="append", default=[], metavar="PACKAGE",
        help="Platform package whose implementations and named types the module imports "
        "instead of restating as East.platform declarations (can be repeated)")

    # export-functions command (#628): a module's `east_functions` -> manifest
    export_parser = subparsers.add_parser(
        "export-functions",
        help="Write a package's East functions (its `east_functions` dict) as a "
        "function manifest other packages — in python or TypeScript — import",
    )
    export_parser.add_argument(
        "module", help="The module declaring `east_functions` (a dotted name, or a .py path)")
    export_parser.add_argument(
        "-o", "--output", type=Path, required=True, metavar="FILE",
        help="The manifest to write (.beast2)")
    export_parser.add_argument(
        "-p", "--package", action="append", default=[], metavar="PACKAGE",
        help="Platform package implementing the functions' platform calls (can be repeated); "
        "each platform dependency must be provided by one of them")
    export_parser.add_argument(
        "--name", metavar="NAME",
        help="The package name importers use (default: the module's top-level name)")
    export_parser.add_argument(
        "--package-version", metavar="VERSION",
        help="The package version recorded in the manifest (default: the installed "
        "distribution's version, else 0.0.0)")
    export_parser.add_argument(
        "--only", action="append", default=[], metavar="NAME",
        help="Export only this function of `east_functions` (can be repeated; default: all)")

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
        help="Feed the given -i input lazily (0-based index; segment-fed "
        "iteration, O(segment) decoded memory)",
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

    # lint command (#638): the East rules over python files
    lint_parser = subparsers.add_parser(
        "lint",
        help="Diagnose the East bodies in python files — the build's refusals at edit time",
    )
    lint_parser.add_argument(
        "paths", nargs="*", type=Path, help="Files or directories to diagnose (default: .)")
    lint_parser.add_argument(
        "--format", choices=("text", "json"), default="text",
        help="text: one `file:line:col: category [rule] message` line per finding (default); "
        "json: the findings as records")
    lint_parser.add_argument(
        "--disable", action="append", default=[], metavar="RULE",
        help="Skip a rule by name (can be repeated)")
    lint_parser.add_argument(
        "--exclude", action="append", default=[], metavar="DIR",
        help="A directory name to skip when walking (can be repeated; .venv, node_modules, "
        "build, tests, … are always skipped)")
    lint_parser.add_argument(
        "--list-rules", action="store_true", help="List the rules and exit")

    # check command (#653): the BUILD's own errors — python's type check
    check_parser = subparsers.add_parser(
        "check",
        help="Build a module's East functions and report the build's own errors "
             "at their lines — the type errors `lint` cannot see",
    )
    check_parser.add_argument(
        "targets", nargs="+", help="Modules to check (a .py path, or a dotted module name)")
    check_parser.add_argument(
        "--format", choices=("text", "json"), default="text",
        help="text: one `file:line:col: category [rule] message` line per finding (default); "
             "json: the findings as records, the shape `lint --format json` emits")

    # lsp command (#638): the same diagnostics for an editor
    subparsers.add_parser(
        "lsp",
        help="Serve the East diagnostics as a Language Server over stdio (needs pygls: "
        "pip install 'elaraai-east-py-cli[lsp]')",
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

        # The manifest carries no streaming flags (format v1), so a captured
        # emit/stream invocation would replay with the wrong arity — refuse
        # at capture with the fix instead of failing confusingly at replay.
        if args.snapshot is not None and (
            getattr(args, "emit", None) is not None or getattr(args, "stream", None) is not None
        ):
            print(
                "Error: --snapshot does not capture --emit/--stream (snapshot format v1 has no "
                "streaming flags); replay with --from-snapshot passing --emit/--stream explicitly",
                file=sys.stderr,
            )
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


def cmd_transpile(args: argparse.Namespace) -> None:
    """``east-py transpile``: print an IR file as python builder source.

    The output module rebuilds the same IR through the ``East.function``
    statement surface (``east.codegen.to_python_source``); every node kind
    has a spelling, builtins without a named python spelling print through
    the raw ``East.builtin(...)`` form.
    """
    from east.codegen import Unprintable, providers_for, to_python_source

    from east_py_cli.loader import load_ir

    try:
        ir = load_ir(args.ir_file)
        providers = providers_for(args.package) if args.package else None
        source = to_python_source(ir, name=args.name, providers=providers)
    except (ValueError, TypeError, Unprintable, FileNotFoundError, ImportError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    if args.output is not None:
        args.output.write_text(source, encoding="utf-8")
    else:
        sys.stdout.write(source)


def cmd_export_functions(args: argparse.Namespace) -> int:
    """``east-py export-functions``: write a module's ``east_functions`` as a
    function manifest (#628).

    The module is imported (a dotted name, or a ``.py`` path) and its
    ``east_functions`` dict — name → ``East.function`` artifact — becomes
    the manifest ``East.export_functions`` builds: each function's IR,
    declared type and platform dependencies. Every platform dependency must
    be implemented by one of the ``-p`` packages, which is recorded as its
    provider; a dependency no package provides is an error naming it, so an
    importer's runner can be checked at its own build. ``--only`` narrows
    the export to the named functions — what an importer actually uses — so
    a sibling function's platform call never fails an export that does not
    need it.
    """
    import importlib
    import importlib.metadata
    import importlib.util

    from east import East

    try:
        spec_name = args.module
        if spec_name.endswith(".py"):
            path = Path(spec_name)
            spec = importlib.util.spec_from_file_location(path.stem, path)
            if spec is None or spec.loader is None:
                raise ImportError(f"cannot load {path}")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            top = path.stem
        else:
            module = importlib.import_module(spec_name)
            top = spec_name.split(".")[0]
        functions = getattr(module, "east_functions", None)
        if not isinstance(functions, dict):
            raise ValueError(
                f"{args.module} declares no `east_functions` dict (name -> East.function artifact)")
        if args.only:
            missing = [name for name in args.only if name not in functions]
            if missing:
                plural = "" if len(missing) == 1 else "s"
                raise ValueError(
                    f"{args.module} exports no function{plural} {', '.join(missing)} — its "
                    f"east_functions are {', '.join(functions) or '(none)'}")
            functions = {name: functions[name] for name in args.only}

        providers: dict[str, str] = {}
        for package in args.package:
            for fn in load_platform(package):
                providers.setdefault(fn["name"], package)
        missing = sorted({
            dep["name"]
            for artifact in functions.values()
            for dep in East.platform_dependencies(artifact)
            if dep["name"] not in providers
        })
        if missing:
            raise ValueError(
                "platform function(s) no -p package provides: " + ", ".join(missing)
                + " — pass the implementing package with -p")

        version = args.package_version
        if version is None:
            try:
                version = importlib.metadata.version(top.replace("_", "-"))
            except importlib.metadata.PackageNotFoundError:
                version = "0.0.0"
        manifest = East.export_functions(args.name or top, version, functions, providers=providers)
        args.output.write_bytes(East.encode_function_manifest(manifest))
        print(f"Exported {len(functions)} function(s) of {args.name or top}@{version} to {args.output}",
              file=sys.stderr)
        return 0
    except (ImportError, ValueError, TypeError, OSError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_lint(args: argparse.Namespace) -> int:
    """``east-py lint``: the East diagnostics (#638) over files and directories.

    Every ``.py`` file that imports ``east`` is read by the rules
    (``east.diagnostics``); each finding prints as one ruff-like line, or as
    a JSON record with ``--format json``. The exit code is 1 when there is
    any finding (a warning included — the gate is the same as ruff's), 0
    when the tree is clean, 2 for a usage error.
    """
    import json

    from east.diagnostics import ALL_RULES, DEFAULT_EXCLUDES, RULES_BY_NAME, lint_paths, load_config

    if args.list_rules:
        for rule in ALL_RULES:
            print(f"EAS{rule.code:03d}  {rule.name:<30} {rule.category:<8} {rule.description}")
        return 0
    unknown = [name for name in args.disable if name not in RULES_BY_NAME]
    if unknown:
        print(f"Error: unknown rule(s): {', '.join(unknown)} — see `east-py lint --list-rules`",
              file=sys.stderr)
        return 2
    paths = list(args.paths) or [Path(".")]
    missing = [str(p) for p in paths if not p.exists()]
    if missing:
        print(f"Error: no such file or directory: {', '.join(missing)}", file=sys.stderr)
        return 2
    # Per PATH, not once for the first one: `east-py lint pkg-a pkg-b` spans two
    # uv workspace members, and each carries its own `[tool.east-py]`. Applying
    # pkg-a's policy to pkg-b silently disabled the wrong rules there.
    # The flags ADD to whatever the file says, so a one-off `--disable` never
    # has to restate it.
    found = {}
    warned: set[str] = set()
    for path in paths:
        config = load_config(path)
        for name in config.disable:
            if name not in RULES_BY_NAME and name not in warned:
                warned.add(name)
                source = config.source or "pyproject.toml"
                print(f"Warning: {source}: [tool.east-py] disable names unknown rule {name!r} — "
                      "see `east-py lint --list-rules`", file=sys.stderr)
        found.update(lint_paths(
            [path],
            disabled=(*config.disable, *args.disable),
            excludes=(*DEFAULT_EXCLUDES, *config.exclude, *args.exclude),
        ))
    count = sum(len(ds) for ds in found.values())
    if args.format == "json":
        records = [
            {"path": path, "line": d.line, "column": d.column, "end_line": d.end_line,
             "end_column": d.end_column, "rule": d.rule, "code": d.flake8_code,
             "category": d.category, "message": d.message}
            for path, ds in found.items() for d in ds
        ]
        print(json.dumps(records, indent=2))
        return 1 if count else 0
    for path, ds in found.items():
        for d in ds:
            print(d.format(path))
    if count:
        plural = "" if count == 1 else "s"
        files = "" if len(found) == 1 else "s"
        print(f"Found {count} diagnostic{plural} in {len(found)} file{files}.")
        return 1
    print("All clear.")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """``east-py check``: build the module's East functions (#653).

    Reports every build failure, not just the first — the same JSON records
    ``lint --format json`` emits, tagged ``build``. Exit 1 when there is any
    finding, 0 when the module builds clean, 2 for a usage error.
    """
    import json

    from east_py_cli.check import check_module

    findings = []
    for target in args.targets:
        if target.endswith(".py") and not Path(target).exists():
            print(f"Error: no such file: {target}", file=sys.stderr)
            return 2
        findings.extend(check_module(target))

    if args.format == "json":
        print(json.dumps([f.as_record() for f in findings], indent=2))
        return 1 if findings else 0
    for finding in findings:
        print(finding.format(finding.path))
    if findings:
        plural = "" if len(findings) == 1 else "s"
        print(f"Found {len(findings)} build error{plural}.")
        return 1
    print("All clear.")
    return 0


def cmd_lsp(args: argparse.Namespace) -> int:
    """``east-py lsp``: serve the diagnostics over the Language Server Protocol."""
    del args
    from east_py_cli.lsp import serve

    return serve()


def main() -> None:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if args.command == "transpile":
        cmd_transpile(args)
    elif args.command == "lint":
        sys.exit(cmd_lint(args))
    elif args.command == "check":
        sys.exit(cmd_check(args))
    elif args.command == "lsp":
        sys.exit(cmd_lsp(args))
    elif args.command == "export-functions":
        sys.exit(cmd_export_functions(args))
    elif args.command == "run":
        sys.exit(cmd_run(args))
    elif args.command == "convert":
        sys.exit(cmd_convert(args))
    elif args.command == "version":
        sys.exit(cmd_version(args))
    else:
        parser.print_help()
        sys.exit(1)
