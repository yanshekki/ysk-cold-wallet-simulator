import { isDevBuild } from './devFlag';
import { revealNeedsOsReauth } from './revealPolicy';
import { unlock } from './session';

/**
 * Release builds ask the OS authenticator before a seed is revealed, imported,
 * or saved. This does not read `CWS_UPLOAD_STORE_FILE`. A release binary is
 * what shows the prompt; signing that binary is separate.
 */
export async function reauthBeforeReveal(prompt: string): Promise<boolean> {
  if (!revealNeedsOsReauth(isDevBuild())) {
    return true;
  }
  return unlock(prompt, { requireOsPrompt: true });
}
