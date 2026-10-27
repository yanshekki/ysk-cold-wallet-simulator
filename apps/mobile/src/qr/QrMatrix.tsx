import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import QRCode from 'qrcode';

type Props = {
  value: string;
  parts?: string[];
  size?: number;
  /** Pause multi-frame animation (keeps iPhone cool; frees the JS thread for taps). */
  paused?: boolean;
};

export function QrMatrix({ value, parts, size = 280, paused = false }: Props) {
  const frames = parts && parts.length > 0 ? parts : [value];
  const frameKey = frames.join('\n');
  const [index, setIndex] = useState(0);
  const [uris, setUris] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setIndex(0);
    setUris([]);
    void Promise.all(
      frames.map((frame) =>
        QRCode.toDataURL(frame, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: size,
          color: { dark: '#000000', light: '#ffffff' },
        }),
      ),
    ).then((next) => {
      if (!cancelled) {
        setUris(next);
      }
    });
    return () => {
      cancelled = true;
    };
    // frames is derived from frameKey; listing frames would churn the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, size]);

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
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri }}
      style={[styles.frame, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#ffffff',
    alignSelf: 'center',
  },
});
