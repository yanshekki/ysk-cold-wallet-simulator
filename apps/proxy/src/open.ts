import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : '';
  if (!command) {
    return;
  }
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Headless hosts have no opener; the URL is still printed.
  }
}
