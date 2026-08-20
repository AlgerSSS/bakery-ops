#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sysexits.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  char unresolved[PATH_MAX];
  char executable[PATH_MAX];
  uint32_t size = sizeof(unresolved);
  if (_NSGetExecutablePath(unresolved, &size) != 0 || realpath(unresolved, executable) == NULL) {
    fputs("R6 ingest app executable path is unavailable\n", stderr);
    return EX_OSERR;
  }

  char *separator = strrchr(executable, '/');
  if (separator == NULL) {
    fputs("R6 ingest app bundle path is invalid\n", stderr);
    return EX_OSERR;
  }
  *separator = '\0';
  separator = strrchr(executable, '/');
  if (separator == NULL) {
    fputs("R6 ingest app bundle path is invalid\n", stderr);
    return EX_OSERR;
  }
  *separator = '\0';

  char runner[PATH_MAX];
  int length = snprintf(
      runner,
      sizeof(runner),
      "%s/Resources/run-brain-auto-ingest.sh",
      executable);
  if (length < 0 || (size_t)length >= sizeof(runner) || access(runner, X_OK) != 0) {
    fputs("R6 ingest app runner is unavailable\n", stderr);
    return EX_NOINPUT;
  }

  pid_t child = fork();
  if (child < 0) {
    fputs("R6 ingest app could not create its runner process\n", stderr);
    return EX_OSERR;
  }
  if (child == 0) {
    execl(runner, runner, (char *)NULL);
    _exit(EX_OSERR);
  }

  int status;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) {
      fputs("R6 ingest app could not wait for its runner\n", stderr);
      return EX_OSERR;
    }
  }
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return EX_OSERR;
}
