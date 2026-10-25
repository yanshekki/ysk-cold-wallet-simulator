#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  char exe[PATH_MAX];
  uint32_t size = sizeof(exe);
  if (_NSGetExecutablePath(exe, &size) != 0) {
    return 1;
  }
  char resolved[PATH_MAX];
  if (!realpath(exe, resolved)) {
    perror("realpath");
    return 1;
  }
  char dir_buf[PATH_MAX];
  strncpy(dir_buf, resolved, sizeof(dir_buf) - 1);
  char *dir = dirname(dir_buf);
  char inner[PATH_MAX];
  char script[PATH_MAX];
  char inner_resolved[PATH_MAX];
  char script_resolved[PATH_MAX];
  snprintf(inner, sizeof(inner), "%s/../Helpers/CWS Node.app", dir);
  snprintf(script, sizeof(script), "%s/../Resources/proxy/main.cjs", dir);
  if (!realpath(inner, inner_resolved) || !realpath(script, script_resolved)) {
    perror("realpath helper");
    return 1;
  }
  execl("/usr/bin/open", "open", "-n", "-W", inner_resolved, "--args", script_resolved, (char *)NULL);
  perror("execl open");
  return 1;
}
