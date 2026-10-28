import { describe, expect, it } from 'vitest';
import {
  CAMERA_FOCUS_SETTLE_MS,
  CAMERA_MOUNT_ERROR_SETTLE_MS,
  CAMERA_PRESENT_SETTLE_MS,
  CAMERA_REMOUNT_LIMIT,
  cameraPreviewKey,
  cameraSettleMs,
  cameraSettleReason,
  isCameraAppActive,
  nextCameraGeneration,
  shouldMountCameraPreview,
  shouldPromptCameraPermission,
  shouldRemountAfterFailure,
  shouldRunCameraSession,
} from './cameraPreview';

describe('shouldMountCameraPreview', () => {
  it('waits for the overFullScreen modal to present before attaching AVCapture', () => {
    expect(
      shouldMountCameraPreview({
        visible: true,
        granted: true,
        presented: false,
        appActive: true,
        settled: true,
      }),
    ).toBe(false);
    expect(
      shouldMountCameraPreview({
        visible: true,
        granted: true,
        presented: true,
        appActive: true,
        settled: true,
      }),
    ).toBe(true);
  });

  it('does not mount a preview without permission or while hidden', () => {
    expect(
      shouldMountCameraPreview({
        visible: true,
        granted: false,
        presented: true,
        appActive: true,
        settled: true,
      }),
    ).toBe(false);
    expect(
      shouldMountCameraPreview({
        visible: false,
        granted: true,
        presented: true,
        appActive: true,
        settled: true,
      }),
    ).toBe(false);
  });

  it('releases the session while the app is blurred or the device has not settled', () => {
    expect(
      shouldMountCameraPreview({
        visible: true,
        granted: true,
        presented: true,
        appActive: false,
        settled: true,
      }),
    ).toBe(false);
    expect(
      shouldMountCameraPreview({
        visible: true,
        granted: true,
        presented: true,
        appActive: true,
        settled: false,
      }),
    ).toBe(false);
  });
});

describe('shouldPromptCameraPermission', () => {
  it('asks on open when iOS has not decided yet', () => {
    expect(
      shouldPromptCameraPermission({
        visible: true,
        granted: false,
        canAskAgain: true,
        statusKnown: true,
      }),
    ).toBe(true);
  });

  it('does not re-prompt a denied or unknown status', () => {
    expect(
      shouldPromptCameraPermission({
        visible: true,
        granted: false,
        canAskAgain: false,
        statusKnown: true,
      }),
    ).toBe(false);
    expect(
      shouldPromptCameraPermission({
        visible: true,
        granted: false,
        canAskAgain: true,
        statusKnown: false,
      }),
    ).toBe(false);
  });
});

describe('camera session lifecycle after Continuity / WebRTC', () => {
  it('treats only RN AppState active as a runnable camera phase', () => {
    expect(isCameraAppActive('active')).toBe(true);
    expect(isCameraAppActive('inactive')).toBe(false);
    expect(isCameraAppActive('background')).toBe(false);
    expect(isCameraAppActive('unknown')).toBe(false);
    expect(isCameraAppActive(null)).toBe(false);
    expect(shouldRunCameraSession({ appActive: true })).toBe(true);
    expect(shouldRunCameraSession({ appActive: false })).toBe(false);
  });

  it('bumps CameraView generation on present, focus, and mount error so AVCapture is recreated', () => {
    expect(nextCameraGeneration(3, 'presented')).toBe(4);
    expect(nextCameraGeneration(3, 'app-focus')).toBe(4);
    expect(nextCameraGeneration(3, 'mount-error')).toBe(4);
    expect(nextCameraGeneration(3, 'hidden')).toBe(3);
    expect(nextCameraGeneration(3, 'app-blur')).toBe(3);
    expect(cameraPreviewKey(4)).toBe('preview-4');
  });

  it('settles longer after app-focus than after a first present', () => {
    expect(cameraSettleReason({ presented: false, becameAppActive: true, isRetry: false })).toBe(null);
    expect(cameraSettleReason({ presented: true, becameAppActive: true, isRetry: true })).toBe('app-focus');
    expect(cameraSettleReason({ presented: true, becameAppActive: false, isRetry: true })).toBe('mount-error');
    expect(cameraSettleReason({ presented: true, becameAppActive: false, isRetry: false })).toBe('present');
    expect(cameraSettleMs('present')).toBe(CAMERA_PRESENT_SETTLE_MS);
    expect(cameraSettleMs('app-focus')).toBe(CAMERA_FOCUS_SETTLE_MS);
    expect(cameraSettleMs('mount-error')).toBe(CAMERA_MOUNT_ERROR_SETTLE_MS);
    expect(CAMERA_FOCUS_SETTLE_MS).toBeGreaterThan(CAMERA_PRESENT_SETTLE_MS);
  });

  it('caps automatic remounts after a dead session', () => {
    expect(shouldRemountAfterFailure({ remountsThisPresentation: 0 })).toBe(true);
    expect(shouldRemountAfterFailure({ remountsThisPresentation: 1 })).toBe(true);
    expect(shouldRemountAfterFailure({ remountsThisPresentation: CAMERA_REMOUNT_LIMIT })).toBe(false);
  });
});
