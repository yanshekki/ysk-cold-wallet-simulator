export type LogFn = (line: string) => void;

export function createLog(): LogFn {
  return (line: string) => {
    process.stderr.write(`cws-proxy: ${line}\n`);
  };
}
