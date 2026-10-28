/**
 * iOS CameraView inside a default `fullScreen` RN Modal attaches the
 * AVCapture preview to a window whose underlying views were removed, so the
 * scanner paints black. Mount the preview only after the modal has presented
 * with `overFullScreen`, which keeps the presenting hierarchy alive.
 */
export function shouldMountCameraPreview(input: {
  visible: boolean;
  granted: boolean;
  presented: boolean;
}): boolean {
  return input.visible && input.granted && input.presented;
}

export function shouldPromptCameraPermission(input: {
  visible: boolean;
  granted: boolean;
  canAskAgain: boolean;
  statusKnown: boolean;
}): boolean {
  return input.visible && input.statusKnown && !input.granted && input.canAskAgain;
}
