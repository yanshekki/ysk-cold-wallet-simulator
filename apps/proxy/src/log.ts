export type LogFn = (line: string) => void;

let stderrHooked = false;

export function createLog(): LogFn {
  if (!stderrHooked) {
    stderrHooked = true;
    process.stderr.on('error', () => undefined);
  }
  return (line: string) => {
    try {
      process.stderr.write(`cws-proxy: ${line}\n`);
    } catch {
      // CWS Proxy pipes stderr; a full or closed pipe must not kill logging.
    }
  };
}
