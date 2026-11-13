export function loadingOverlayA11y(label: string) {
  return {
    accessibilityViewIsModal: true as const,
    accessibilityRole: 'progressbar' as const,
    accessibilityLabel: label,
    accessibilityLiveRegion: 'polite' as const,
  };
}

export function overlayShowsAnimatedSpinner(reduceMotion: boolean): boolean {
  return reduceMotion !== true;
}
