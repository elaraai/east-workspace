# Cross-compile east-c for Windows x64 from a Linux host using MinGW-w64.
#
#   cmake -S libs/east-c -B build-win \
#     -DCMAKE_TOOLCHAIN_FILE=libs/east-c/cmake/mingw-w64-x86_64.toolchain.cmake
#   cmake --build build-win -j
#
# Produces a statically-linked build-win/packages/east-c-cli/east-c.exe that
# runs on Windows (and under Wine for smoke testing). Reuses east-c's existing
# GNU/Clang code paths — MinGW provides unistd.h/dirent.h/pthreads.

set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)

set(TOOLCHAIN_PREFIX x86_64-w64-mingw32)
set(CMAKE_C_COMPILER   ${TOOLCHAIN_PREFIX}-gcc)
set(CMAKE_CXX_COMPILER ${TOOLCHAIN_PREFIX}-g++)
set(CMAKE_RC_COMPILER  ${TOOLCHAIN_PREFIX}-windres)

# Search libs/headers in the target sysroot, programs on the host.
set(CMAKE_FIND_ROOT_PATH /usr/${TOOLCHAIN_PREFIX})
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Self-contained .exe: static libgcc + winpthreads so no MinGW runtime DLLs are
# needed alongside the binary.
set(CMAKE_EXE_LINKER_FLAGS_INIT "-static -static-libgcc")
