import { describe, expect, it } from 'vitest';
import { shouldMountCameraPreview, shouldPromptCameraPermission } from './cameraPreview';

describe('shouldMountCameraPreview', () => {
  it('waits for the overFullScreen modal to present before attaching AVCapture', () => {
    expect(shouldMountCameraPreview({ visible: true, granted: true, presented: false })).toBe(false);
    expect(shouldMountCameraPreview({ visible: true, granted: true, presented: true })).toBe(true);
  });

  it('does not mount a preview without permission or while hidden', () => {
    expect(shouldMountCameraPreview({ visible: true, granted: false, presented: true })).toBe(false);
    expect(shouldMountCameraPreview({ visible: false, granted: true, presented: true })).toBe(false);
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
