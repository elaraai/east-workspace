# Generate a C translation unit that embeds a binary blob as a byte array.
# Invoked at build time:
#   cmake -DBLOB=<in.blob> -DOUT=<out.c> -P embed_tzdata.cmake
# Emits:
#   const unsigned char east_tzdata_blob[];
#   const unsigned int  east_tzdata_blob_len;   (== sizeof the array)
#
# A generated C array is portable across MSVC / GCC / Clang, unlike the
# GNU-assembler ".incbin" this replaced (MSVC's MASM has no equivalent).

if(NOT DEFINED BLOB OR NOT DEFINED OUT)
    message(FATAL_ERROR "embed_tzdata.cmake requires -DBLOB and -DOUT")
endif()

file(READ "${BLOB}" _hex HEX)
# "aabb..." -> "0xaa,0xbb,"; then wrap every 16 bytes for sane line lengths.
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," _bytes "${_hex}")
string(REGEX REPLACE "((0x[0-9a-f][0-9a-f],){16})" "\\1\n    " _bytes "${_bytes}")

file(WRITE "${OUT}"
"/* Auto-generated from tzdata.blob by embed_tzdata.cmake. Do not edit. */\n"
"const unsigned char east_tzdata_blob[] = {\n    ${_bytes}\n};\n"
"const unsigned int east_tzdata_blob_len = (unsigned int)sizeof(east_tzdata_blob);\n")
