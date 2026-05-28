# shellcheck shell=bash
# East monorepo — Windows (Git Bash) developer environment.
#
# Source this from your ~/.bashrc so every Git Bash session has the full
# toolchain on PATH and the MSVC compiler loaded:
#
#     source "/c/path/to/east-workspace/scripts/windows-dev-env.sh"
#
# Idempotent and guarded: safe to source repeatedly, and each block is a
# no-op until its tool is installed. A no-op on non-Windows shells.
# See docs/WINDOWS_SETUP.md for the full setup.

# Windows / Git Bash only — do nothing elsewhere.
case "$(uname -s)" in
  MINGW* | MSYS*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac

# --- winget-installed CLIs (uv, fnm, make, ninja) -------------------------
# winget drops shims in %LOCALAPPDATA%\Microsoft\WinGet\Links and adds that
# dir to the *User* PATH — but already-running processes (and the Git Bash
# they spawn) don't see the change until a logout/login. Prepend it here so
# the tools resolve immediately, no logout required.
if [ -n "${LOCALAPPDATA:-}" ]; then
  _winget_links="$(cygpath -u "$LOCALAPPDATA")/Microsoft/WinGet/Links"
  case ":$PATH:" in
    *":$_winget_links:"*) ;;
    *) [ -d "$_winget_links" ] && PATH="$_winget_links:$PATH" ;;
  esac
fi

# --- User-local executables (~/.local/bin) --------------------------------
# Where `uv tool install` puts CLIs (e.g. east-py) and where the Claude Code
# native installer puts claude.exe. winget/installers add it to the User
# PATH, but — same story — running shells don't see it until a logout.
_local_bin="$HOME/.local/bin"
case ":$PATH:" in
  *":$_local_bin:"*) ;;
  *) [ -d "$_local_bin" ] && PATH="$_local_bin:$PATH" ;;
esac

# --- pnpm global bin (PNPM_HOME) ------------------------------------------
# `pnpm setup` (one-time) writes PNPM_HOME=$LOCALAPPDATA/pnpm to the *User*
# Windows env and adds it to the User PATH, but already-running shells don't
# see those until a logout — so `pnpm link --global` / `make link` keep
# failing with ERR_PNPM_NO_GLOBAL_BIN_DIR in the very shell that just ran
# setup. Wire it up here so it resolves immediately every session.
if [ -n "${LOCALAPPDATA:-}" ]; then
  _pnpm_home="$(cygpath -u "$LOCALAPPDATA")/pnpm"
  if [ -d "$_pnpm_home" ]; then
    export PNPM_HOME="$(cygpath -w "$_pnpm_home")"
    case ":$PATH:" in
      *":$_pnpm_home:"*) ;;
      *) PATH="$_pnpm_home:$PATH" ;;
    esac
  fi
fi

# --- Python (winget Python.Python.3.x) ------------------------------------
# Prepend the real interpreter ahead of the Microsoft Store alias dir so
# `python` is Python, not the Store stub. Version-agnostic.
if [ -n "${LOCALAPPDATA:-}" ]; then
  for _py in "$(cygpath -u "$LOCALAPPDATA")"/Programs/Python/Python3*/; do
    [ -x "${_py}python.exe" ] || continue
    case ":$PATH:" in
      *":${_py%/}:"*) ;;
      *) PATH="${_py%/}/Scripts:${_py%/}:$PATH" ;;
    esac
  done
fi

# --- CMake (Kitware MSI installs to Program Files, not the winget Links) --
for _cm in "/c/Program Files/CMake/bin" "/c/Program Files (x86)/CMake/bin"; do
  [ -x "$_cm/cmake.exe" ] || continue
  case ":$PATH:" in
    *":$_cm:"*) ;;
    *) PATH="$_cm:$PATH" ;;
  esac
done

# --- fnm: Node version from .nvmrc, switched on cd ------------------------
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd --shell bash)"
fi

# --- MSVC x64 toolchain (cl.exe + Windows SDK) ----------------------------
# Needed to build east-c and the east-py native extensions. Located via
# vswhere (any VS edition); the compiler env is imported once per session.
# PATH is converted to Unix form; INCLUDE/LIB stay native (cl reads them).
if [ -z "${VCToolsInstallDir:-}" ]; then
  _vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
  if [ -x "$_vswhere" ]; then
    _vsroot="$("$_vswhere" -latest -products '*' \
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
      -property installationPath 2>/dev/null)"
    if [ -n "$_vsroot" ]; then
      _vcvars="$(cygpath -u "$_vsroot")/VC/Auxiliary/Build/vcvars64.bat"
      if [ -f "$_vcvars" ]; then
        # Import the compiler env. Git Bash mangles embedded quotes when it
        # builds a Windows command line, so an inline `cmd //c "...vcvars...
        # && set"` fails ("system cannot find the path specified"). Route it
        # through a temp .bat: cmd's only argument is then a space-free path,
        # and the quoted vcvars path lives literally inside the file. cmd's
        # `set` emits CRLF (strip CR) and prints `Path`, not `PATH` (match the
        # key case-insensitively).
        _vcbat="${TMPDIR:-/tmp}/east-vcvars-$$.bat"
        printf '@echo off\r\ncall "%s" >nul 2>&1\r\nset\r\n' "$(cygpath -w "$_vcvars")" > "$_vcbat"
        while IFS='=' read -r _k _v; do
          case "${_k^^}" in
            PATH) PATH="$(cygpath -up "$_v"):$PATH" ;;
            INCLUDE | LIB | LIBPATH | VCTOOLSINSTALLDIR | VCTOOLSVERSION | WINDOWSSDKDIR | WINDOWSSDKVERSION | UCRTVERSION | VSINSTALLDIR | VCINSTALLDIR)
              export "$_k=$_v" ;;
          esac
        done < <(cmd //c "$(cygpath -w "$_vcbat")" 2>/dev/null | tr -d '\r')
        rm -f "$_vcbat"
      fi
    fi
  fi
fi
export PATH

# --- CMake: use Ninja on Windows (avoids the VS multi-config MAX_PATH bug) -
export CMAKE_GENERATOR=Ninja

# --- uv: copy instead of hardlink ----------------------------------------
# Hardlinking from the uv cache into a project .venv fails on Windows when
# either side lives under a cloud-synced directory (OneDrive, Dropbox) — the
# OS rejects it with "cloud operation cannot be performed on a file with
# incompatible hardlinks" (os error 396). Copy is slightly slower but always
# works.
export UV_LINK_MODE=copy

# --- Corporate TLS — uncomment if package installs hit certificate errors --
# export NODE_OPTIONS=--use-system-ca   # Node/pnpm trust the Windows cert store
# export UV_NATIVE_TLS=1                # uv trusts the Windows cert store
