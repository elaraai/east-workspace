# e3-job — the Windows Job Object launcher e3 runs each runner through (see
# e3-job.c). Windows only: POSIX process groups do its job elsewhere.
cmake_minimum_required(VERSION 3.15)
project(e3-job C)

if(NOT WIN32)
  message(FATAL_ERROR "e3-job is a Windows program")
endif()

# The static C runtime, so the one file runs without a Visual C++
# redistributable installed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_executable(e3-job e3-job.c)
target_compile_definitions(e3-job PRIVATE UNICODE _UNICODE _CRT_SECURE_NO_WARNINGS)
if(MSVC)
  target_compile_options(e3-job PRIVATE /W4 /WX)
endif()
