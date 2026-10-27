import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'qrcode';

type Props = {
  value: string;
  parts?: string[];
  size?: number;
};

export function QrMatrix({ value, parts, size = 280 }: Props) {
  const frames = parts && parts.length > 0 ? parts : [value];
  const frameKey = frames.join('\n');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (frames.length < 2) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % frames.length);
    }, 250);
    return () => clearInterval(timer);
  }, [frameKey, frames.length]);
  const current = frames[index] ?? value;
  const rows = useMemo(() => {
    const qr = QRCode.create(current, { errorCorrectionLevel: 'M' });
    const count = qr.modules.size;
    const grid: boolean[][] = [];
    for (let y = 0; y < count; y += 1) {
      const row: boolean[] = [];
      for (let x = 0; x < count; x += 1) {
        row.push(Boolean(qr.modules.get(x, y)));
      }
      grid.push(row);
    }
    return grid;
  }, [current]);
  const cell = size / rows.length;
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      {rows.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row', height: cell }}>
          {row.map((on, x) => (
            <View
              key={x}
              style={{
                width: cell,
                height: cell,
                backgroundColor: on ? '#000000' : '#ffffff',
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
