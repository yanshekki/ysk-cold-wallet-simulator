import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { qrPngDataUri } from './qrPng';

type Props = {
  value: string;
  parts?: string[];
  size?: number;
  /** Pause multi-frame animation (keeps iPhone cool; frees the JS thread for taps). */
  paused?: boolean;
};

/**
 * Draw the QR as one native Image.
 * Avoid QRCode.toDataURL (DOM canvas, blanks on RN) and a View-per-module
 * matrix (paints as a black square on the dark iOS sheet, so Rabby cannot scan).
 */
export function QrMatrix({ value, parts, size = 280, paused = false }: Props) {
  const frames = parts && parts.length > 0 ? parts : [value];
  const frameKey = frames.join('\n');
  const [index, setIndex] = useState(0);

  const uris = useMemo(
    () => frames.map((frame) => qrPngDataUri(frame)),
    // frames is derived from frameKey; listing frames would churn the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );

  useEffect(() => {
    setIndex(0);
  }, [frameKey]);

  useEffect(() => {
    if (paused || uris.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % uris.length);
    }, 300);
    return () => clearInterval(timer);
  }, [paused, uris.length, frameKey]);

  const uri = uris[Math.min(index, Math.max(uris.length - 1, 0))] ?? uris[0];
  if (!uri) {
    return <View style={[styles.frame, { width: size, height: size }]} />;
  }

  return (
    <View style={[styles.frame, { width: size, height: size }]} collapsable={false}>
      <Image
        testID="device-qr-image"
        accessibilityRole="image"
        accessibilityLabel="QR code"
        source={{ uri }}
        style={{ width: size, height: size, backgroundColor: '#ffffff' }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#ffffff',
    alignSelf: 'center',
    overflow: 'hidden',
  },
});
