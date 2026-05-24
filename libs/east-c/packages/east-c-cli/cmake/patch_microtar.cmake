# Patch microtar's header_to_raw() to emit the POSIX ustar magic string.
#
# Default microtar writes the old-style v7 tar format (no magic), which many
# modern tar readers (e.g. tar-stream in Node) reject. Injecting the ustar
# magic into the header's _padding field makes microtar's output compatible
# with ustar parsers while staying backwards-readable by microtar itself.
#
# Invocation: cmake -DMICROTAR_SRC=<dir> -P patch_microtar.cmake

if(NOT MICROTAR_SRC)
    message(FATAL_ERROR "patch_microtar: MICROTAR_SRC not set")
endif()

set(SRC "${MICROTAR_SRC}/src/microtar.c")
set(MARK "/* east-c patch: ustar magic */")

file(READ "${SRC}" CONTENT)

string(FIND "${CONTENT}" "${MARK}" ALREADY)
if(NOT ALREADY EQUAL -1)
    message(STATUS "microtar already patched")
    return()
endif()

set(FIND_LINE "  strcpy(rh->linkname, h->linkname);")
set(INJECT "  strcpy(rh->linkname, h->linkname);\n\n  ${MARK}\n  memcpy(rh->_padding, \"ustar\", 5);\n  memcpy(rh->_padding + 6, \"00\", 2);")

string(REPLACE "${FIND_LINE}" "${INJECT}" NEW_CONTENT "${CONTENT}")
if(NEW_CONTENT STREQUAL CONTENT)
    message(FATAL_ERROR "patch_microtar: could not find injection site in ${SRC}")
endif()

file(WRITE "${SRC}" "${NEW_CONTENT}")
message(STATUS "microtar patched for ustar magic output")
