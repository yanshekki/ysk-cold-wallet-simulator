import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'qrcode';

type Props = {
  value: string;
  parts?: string[];
  size?: number;
  /** Pause multi-frame animation (keeps iPhone cool; frees the JS thread for taps). */
  paused?: boolean;
};

/** Run-length segment of same-color modules in one row (fewer Views than one-per-module). */
type Segment = { on: boolean; count: number };
type FrameRows = Segment[][];

/**
 * Build an RN-safe QR matrix via qrcode's pure create() API.
 * Avoid QRCode.toDataURL — it needs a DOM canvas and blanks on Android/RN.
 */
function buildFrame(value: string): FrameRows {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const rows: FrameRows = [];
  for (let y = 0; y < n; y += 1) {
    const segments: Segment[] = [];
    let x = 0;
    while (x < n) {
      const on = Boolean(qr.modules.get(x, y));
      let count = 1;
      while (x + count < n && Boolean(qr.modules.get(x + count, y)) === on) {
        count += 1;
      }
      segments.push({ on, count });
      x += count;
    }
    rows.push(segments);
  }
  return rows;
}

export function QrMatrix({ value, parts, size = 280, paused = false }: Props) {
  const frames = parts && parts.length > 0 ? parts : [value];
  const frameKey = frames.join('\n');
  const [index, setIndex] = useState(0);

  // Precompute every frame once so animation only swaps which matrix is shown
  // (no QRCode.create / thousands of fresh Views every tick).
  const matrices = useMemo(
    () => frames.map(buildFrame),
    // frames is derived from frameKey; listing frames would churn the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameKey],
  );

  useEffect(() => {
    setIndex(0);
  }, [frameKey]);

  useEffect(() => {
    if (paused || matrices.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % matrices.length);
    }, 300);
    return () => clearInterval(timer);
  }, [paused, matrices.length, frameKey]);

  const rows = matrices[Math.min(index, Math.max(matrices.length - 1, 0))] ?? matrices[0];
  if (!rows || rows.length === 0) {
    return <View style={[styles.frame, { width: size, height: size }]} />;
  }
  const moduleCount = rows.length;
  const cell = size / moduleCount;

  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      {rows.map((segments, y) => (
        <View key={y} style={{ flexDirection: 'row', height: cell }}>
          {segments.map((seg, i) => (
            <View
              key={i}
              style={{
                width: cell * seg.count,
                height: cell,
                backgroundColor: seg.on ? '#000000' : '#ffffff',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#ffffff',
    alignSelf: 'center',
  },
});
