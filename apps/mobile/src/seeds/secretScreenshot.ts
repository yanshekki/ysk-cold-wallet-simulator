import { useCallback } from 'react';
import { useT } from '../i18n';
import { useAppState } from '../state/AppState';
import { useSecretScreen } from './screenGuard';

/** Warn when the OS reports a capture. Does not block the capture. */
export function useSecretScreenshotWarning(): void {
  const t = useT();
  const { showToast } = useAppState();
  const warn = useCallback(() => {
    showToast(t('vault.screenshot'));
  }, [showToast, t]);
  useSecretScreen(warn);
}

/** Mount only while a secret sheet is visible. Renders nothing. */
export function SecretScreenshotBoundary(): null {
  useSecretScreenshotWarning();
  return null;
}
