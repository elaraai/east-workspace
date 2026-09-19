/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/*
 * e3-job — runs one command inside a Windows Job Object.
 *
 *   e3-job.exe "<application path>" <command line>
 *
 * Windows has no process group a signal can address. The Job Object is its
 * container for "this process and everything it starts": a process created by
 * a member of the job joins it, and a job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
 * ends every member when its last handle closes. e3 runs each runner on
 * Windows through this launcher and stops a runner by ending the launcher —
 * the launcher holds the job's only handle, so the whole tree ends with it,
 * including programs Git Bash's exec leaves with an exited parent, which no
 * walk of parent pids can find. It ends the same way when e3 itself dies: the
 * launcher is e3's child in the job object Node places its children in.
 *
 * The launcher joins the job before it starts the command, so the command is
 * a member from its first instruction and ending the launcher at any moment
 * leaves nothing running outside the job; the job allows no breakaway, so
 * nothing the command starts can leave it. The command line after the
 * application path is passed to CreateProcessW unchanged, so the runner sees
 * exactly the command line e3 would have given it, and it inherits this
 * process's standard handles, environment and working directory. When the
 * command exits the launcher exits with its exit code, and whatever the
 * command left running in the job ends then too.
 *
 * Exit codes of the launcher's own: 125 when it is misused or the job cannot
 * be set up, 126 when the command cannot be started, 127 when it is not found.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#define EXIT_SETUP 125
#define EXIT_CANNOT_RUN 126
#define EXIT_NOT_FOUND 127

/* Prints `e3-job: <what>: <the error's system message>` to stderr. */
static void report(const wchar_t *what, DWORD error) {
  wchar_t message[512];
  DWORD length = FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, error, 0,
                                message, (DWORD)(sizeof message / sizeof message[0]), NULL);
  /* The system message ends with a line break; trim it. */
  while (length > 0 && (message[length - 1] == L'\r' || message[length - 1] == L'\n')) message[--length] = L'\0';
  if (length == 0) swprintf(message, sizeof message / sizeof message[0], L"error %lu", error);
  fwprintf(stderr, L"e3-job: %ls: %ls\n", what, message);
}

static const wchar_t *skip_blanks(const wchar_t *p) {
  while (*p == L' ' || *p == L'\t') p++;
  return p;
}

/*
 * Reads one argument that is either "quoted" — no quote inside, as a path
 * cannot hold one — or bare, up to the next blank, as Windows reads a
 * program's own name from its command line. Returns the position after it
 * and, when `text` is not NULL, stores a copy of its text there (NULL for
 * none).
 */
static const wchar_t *read_path(const wchar_t *p, wchar_t **text) {
  const wchar_t *start, *end;
  if (*p == L'"') {
    start = ++p;
    end = wcschr(p, L'"');
    if (end == NULL) {
      if (text != NULL) *text = NULL;
      return p + wcslen(p);
    }
    p = end + 1;
  } else {
    start = p;
    while (*p != L'\0' && *p != L' ' && *p != L'\t') p++;
    end = p;
  }
  if (text == NULL) return p;
  if (end == start) {
    *text = NULL;
    return p;
  }
  *text = (wchar_t *)calloc((size_t)(end - start) + 1, sizeof(wchar_t));
  if (*text != NULL) wmemcpy(*text, start, (size_t)(end - start));
  return p;
}

int wmain(void) {
  /* This launcher's own path, then the application's, then its command line. */
  wchar_t *application = NULL;
  const wchar_t *p = read_path(skip_blanks(GetCommandLineW()), NULL);
  p = read_path(skip_blanks(p), &application);
  const wchar_t *rest = skip_blanks(p);
  if (application == NULL || *rest == L'\0') {
    fwprintf(stderr, L"e3-job: usage: e3-job.exe \"<application path>\" <command line>\n");
    return EXIT_SETUP;
  }
  /* CreateProcessW may write to the command line it is given. */
  wchar_t *command_line = _wcsdup(rest);
  if (command_line == NULL) {
    fwprintf(stderr, L"e3-job: out of memory\n");
    return EXIT_SETUP;
  }

  /* The job: its handle is not inheritable, so this process holds its only one.
   * Like the job Node places its own children in, a member that crashes ends
   * with its exception code rather than waiting on an error dialog no one will
   * answer. */
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    report(L"cannot create the job object", GetLastError());
    return EXIT_SETUP;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof limits);
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof limits)) {
    report(L"cannot set up the job object", GetLastError());
    return EXIT_SETUP;
  }
  /* Joined before the command starts: the command is created in the job. The
   * job nests inside any job this process is already in (Node's own, for one),
   * and a process in a job that allows no breakaway cannot break away even
   * when a job further up allows it. */
  if (!AssignProcessToJobObject(job, GetCurrentProcess())) {
    report(L"cannot join the job object", GetLastError());
    return EXIT_SETUP;
  }

  STARTUPINFOW startup;
  ZeroMemory(&startup, sizeof startup);
  startup.cb = sizeof startup;
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process;
  if (!CreateProcessW(application, command_line, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) {
    DWORD error = GetLastError();
    wchar_t what[64 + MAX_PATH];
    swprintf(what, sizeof what / sizeof what[0], L"cannot start %.*ls", MAX_PATH, application);
    report(what, error);
    return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? EXIT_NOT_FOUND : EXIT_CANNOT_RUN;
  }
  CloseHandle(process.hThread);

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = EXIT_SETUP;
  if (!GetExitCodeProcess(process.hProcess, &code)) {
    report(L"cannot read the command's exit code", GetLastError());
    code = EXIT_SETUP;
  }
  /* Exiting closes the job's only handle: whatever the command left running
   * in the job ends with it. */
  return (int)code;
}
