cmake_minimum_required(VERSION 3.16)

# Read version from VERSION file
file(READ "${CMAKE_SOURCE_DIR}/VERSION" EAST_VERSION)
string(STRIP "${EAST_VERSION}" EAST_VERSION)

# Strip prerelease suffix (e.g. "-beta.0") for CMake project() which only accepts numeric versions
string(REGEX REPLACE "-.*" "" EAST_CMAKE_VERSION "${EAST_VERSION}")

project(east-c VERSION ${EAST_CMAKE_VERSION} LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Compiler warnings
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
endif()

# Fetch PCRE2 for JavaScript-compatible regex
include(FetchContent)
FetchContent_Declare(
    pcre2
    URL https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz
    URL_HASH SHA256=86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_UNICODE ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(pcre2)

# Silence pedantic warnings from 3rd-party PCRE2 sources
if(TARGET pcre2-8-static)
    target_compile_options(pcre2-8-static PRIVATE -w)
endif()
if(TARGET pcre2-posix-static)
    target_compile_options(pcre2-posix-static PRIVATE -w)
endif()

# Fetch microtar for snapshot bundles in the CLI (ustar, no compression).
# microtar ships with a Makefile but no CMake project, so we fetch the source
# and build it ourselves rather than letting FetchContent invoke its build.
FetchContent_Declare(
    microtar
    GIT_REPOSITORY https://github.com/rxi/microtar.git
    GIT_TAG 27076e1b9290e9c7842bb7890a54fcf172406c84
)
FetchContent_GetProperties(microtar)
if(NOT microtar_POPULATED)
    FetchContent_Populate(microtar)
endif()
# Patch microtar to emit the POSIX ustar magic, so its archives interoperate
# with stricter ustar-only readers (e.g. tar-stream). Idempotent.
execute_process(
    COMMAND ${CMAKE_COMMAND}
        -DMICROTAR_SRC=${microtar_SOURCE_DIR}
        -P ${CMAKE_CURRENT_LIST_DIR}/packages/east-c-cli/cmake/patch_microtar.cmake
    RESULT_VARIABLE _patch_rc
)
if(NOT _patch_rc EQUAL 0)
    message(FATAL_ERROR "Failed to patch microtar (rc=${_patch_rc})")
endif()
add_library(microtar STATIC ${microtar_SOURCE_DIR}/src/microtar.c)
target_include_directories(microtar PUBLIC ${microtar_SOURCE_DIR}/src)
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(microtar PRIVATE -w)
endif()

# On Windows there is no system libcurl, so vendor a static curl built against
# Schannel (Windows-native TLS — no OpenSSL). Linux/macOS use system curl
# (see packages/east-c-std/CMakeLists.txt). HTTP(S)-only keeps it small.
if(WIN32)
    set(CURL_USE_SCHANNEL ON  CACHE BOOL "" FORCE)
    set(CURL_USE_OPENSSL  OFF CACHE BOOL "" FORCE)
    set(CURL_USE_LIBPSL   OFF CACHE BOOL "" FORCE)
    set(USE_LIBIDN2       OFF CACHE BOOL "" FORCE)
    set(CURL_ZLIB         OFF CACHE BOOL "" FORCE)
    set(CURL_BROTLI       OFF CACHE BOOL "" FORCE)
    set(CURL_ZSTD         OFF CACHE BOOL "" FORCE)
    set(HTTP_ONLY         ON  CACHE BOOL "" FORCE)
    set(BUILD_CURL_EXE    OFF CACHE BOOL "" FORCE)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(BUILD_STATIC_LIBS ON  CACHE BOOL "" FORCE)
    set(BUILD_TESTING     OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(
        curl
        GIT_REPOSITORY https://github.com/curl/curl.git
        GIT_TAG curl-8_11_1
    )
    FetchContent_MakeAvailable(curl)
endif()

# Optional: mimalloc for faster small allocations
option(EAST_USE_MIMALLOC "Use mimalloc allocator" OFF)
if(EAST_USE_MIMALLOC)
    FetchContent_Declare(
        mimalloc
        GIT_REPOSITORY https://github.com/microsoft/mimalloc.git
        GIT_TAG v2.1.7
    )
    set(MI_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(MI_BUILD_SHARED OFF CACHE BOOL "" FORCE)
    set(MI_OVERRIDE ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(mimalloc)
endif()

# Windows executables default to a ~1 MB stack (vs 8 MB on Linux/macOS), which
# the deeply-recursive patch/diff suites overflow. Reserve 16 MB for every exe.
# Applies to both the native MinGW build and the cross-compile toolchain (WIN32
# is set in both); must precede the add_subdirectory() target definitions.
if(WIN32)
    add_link_options(-Wl,--stack,16777216)
endif()

enable_testing()

add_subdirectory(packages/east-c)
add_subdirectory(packages/east-c-std)
add_subdirectory(packages/east-c-cli)
