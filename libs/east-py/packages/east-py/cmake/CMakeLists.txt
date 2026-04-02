cmake_minimum_required(VERSION 3.16)
project(east-py-native LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

include(FetchContent)

# Fetch PCRE2 (required by east-c)
FetchContent_Declare(
    pcre2
    URL https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz
    URL_HASH SHA256=86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b
)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_UNICODE ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(pcre2)

# Disable mimalloc — Python has its own allocator
set(EAST_USE_MIMALLOC OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

# Fetch east-c from GitHub.
# Override branch/tag with -DEAST_C_GIT_TAG=<branch> or EAST_C_GIT_TAG env var.
# Use local checkout with EAST_C_SOURCE_DIR env var or cmake var.
# We add only packages/east-c (not the root CMakeLists.txt which reads a
# VERSION file relative to CMAKE_SOURCE_DIR).
if(NOT DEFINED EAST_C_GIT_TAG)
    if(DEFINED ENV{EAST_C_GIT_TAG})
        set(EAST_C_GIT_TAG "$ENV{EAST_C_GIT_TAG}")
    else()
        set(EAST_C_GIT_TAG "main")
    endif()
endif()

# Allow local override via EAST_C_SOURCE_DIR env var or cmake var.
# Uses FETCHCONTENT_SOURCE_DIR_EAST-C which is the official CMake mechanism.
if(DEFINED EAST_C_SOURCE_DIR)
    set(FETCHCONTENT_SOURCE_DIR_EAST-C "${EAST_C_SOURCE_DIR}" CACHE PATH "" FORCE)
elseif(DEFINED ENV{EAST_C_SOURCE_DIR})
    set(FETCHCONTENT_SOURCE_DIR_EAST-C "$ENV{EAST_C_SOURCE_DIR}" CACHE PATH "" FORCE)
endif()

if(FETCHCONTENT_SOURCE_DIR_EAST-C)
    message(STATUS "Using local east-c: ${FETCHCONTENT_SOURCE_DIR_EAST-C}")
else()
    message(STATUS "east-c branch/tag: ${EAST_C_GIT_TAG}")
endif()

FetchContent_Declare(east-c
    GIT_REPOSITORY git@github.com:elaraai/east-c.git
    GIT_TAG ${EAST_C_GIT_TAG}
)
FetchContent_GetProperties(east-c)
if(NOT east-c_POPULATED)
    FetchContent_Populate(east-c)
    add_subdirectory(${east-c_SOURCE_DIR}/packages/east-c ${east-c_BINARY_DIR}/east-c)
endif()
