/**
 * iOS CameraView inside a default `fullScreen` RN Modal attaches the
 * AVCapture preview to a window whose underlying views were removed, so the
 * scanner paints black. Mount the preview only after the modal has presented
 * with `overFullScreen`, which keeps the presenting hierarchy alive.
 *
 * Continuity Camera / Mac getUserMedia (iPhone as a webcam) is a different
 * failure: expo-camera SDK 57 only stopRunning/startRunning the same
 * AVCaptureSession on app blur/focus and does not observe
 * AVCaptureSessionWasInterrupted. After Continuity that stale session
 * delivers black frames. Unmount CameraView on blur so native stopSession
 * tears the graph down, then remount with a new key once the app is active
 * and the device has settled. overFullScreen does not fix this path.
 */
export function shouldMountCameraPreview(input: {
  visible: boolean;
  granted: boolean;
  presented: boolean;
  appActive: boolean;
  settled: boolean;
}): boolean {
  return input.visible && input.granted && input.presented && input.appActive && input.settled;
}

export function shouldPromptCameraPermission(input: {
  visible: boolean;
  granted: boolean;
  canAskAgain: boolean;
  statusKnown: boolean;
}): boolean {
  return input.visible && input.statusKnown && !input.granted && input.canAskAgain;
}

export function isCameraAppActive(phase: string | null | undefined): boolean {
  return phase === 'active';
}

export function shouldRunCameraSession(input: { appActive: boolean }): boolean {
  return input.appActive;
}

export type CameraGenerationEvent = 'presented' | 'app-focus' | 'mount-error' | 'hidden' | 'app-blur';

export function nextCameraGeneration(current: number, event: CameraGenerationEvent): number {
  switch (event) {
    case 'presented':
    case 'app-focus':
    case 'mount-error':
      return current + 1;
    case 'hidden':
    case 'app-blur':
      return current;
  }
}

export function cameraPreviewKey(generation: number): string {
  return `preview-${generation}`;
}

export const CAMERA_REMOUNT_LIMIT = 2;

export function shouldRemountAfterFailure(input: {
  remountsThisPresentation: number;
  limit?: number;
}): boolean {
  return input.remountsThisPresentation < (input.limit ?? CAMERA_REMOUNT_LIMIT);
}

export type CameraSettleReason = 'present' | 'app-focus' | 'mount-error';

export const CAMERA_PRESENT_SETTLE_MS = 280;
export const CAMERA_FOCUS_SETTLE_MS = 600;
export const CAMERA_MOUNT_ERROR_SETTLE_MS = 500;

export function cameraSettleMs(reason: CameraSettleReason): number {
  switch (reason) {
    case 'app-focus':
      return CAMERA_FOCUS_SETTLE_MS;
    case 'mount-error':
      return CAMERA_MOUNT_ERROR_SETTLE_MS;
    default:
      return CAMERA_PRESENT_SETTLE_MS;
  }
}

export function cameraSettleReason(input: {
  presented: boolean;
  becameAppActive: boolean;
  isRetry: boolean;
}): CameraSettleReason | null {
  if (!input.presented) {
    return null;
  }
  if (input.becameAppActive) {
    return 'app-focus';
  }
  if (input.isRetry) {
    return 'mount-error';
  }
  return 'present';
}

/**
 * The settle clock starts when the camera permission is granted and the
 * modal is on screen. Time spent on the denied sheet does not count, so a
 * timer that already fired before the grant cannot mount the preview on
 * the grant frame.
 */
export function canStartCameraSettle(input: {
  visible: boolean;
  granted: boolean;
  presented: boolean;
  appActive: boolean;
}): boolean {
  return input.visible && input.granted && input.presented && input.appActive;
}

export function cameraSettledAfterGrant(input: {
  granted: boolean;
  visible: boolean;
  presented: boolean;
  appActive: boolean;
  reason: CameraSettleReason | null;
  elapsedSinceGrantMs: number;
}): boolean {
  if (!canStartCameraSettle(input) || input.reason == null) {
    return false;
  }
  return input.elapsedSinceGrantMs >= cameraSettleMs(input.reason);
}

export function shouldMountPreviewAfterGrant(input: {
  visible: boolean;
  granted: boolean;
  presented: boolean;
  appActive: boolean;
  reason: CameraSettleReason | null;
  elapsedSinceGrantMs: number;
}): boolean {
  return shouldMountCameraPreview({
    visible: input.visible,
    granted: input.granted,
    presented: input.presented,
    appActive: input.appActive,
    settled: cameraSettledAfterGrant(input),
  });
}
