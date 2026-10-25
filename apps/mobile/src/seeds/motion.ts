export async function collectMotionMix(ms = 1500): Promise<Uint8Array> {
  const samples: number[] = [Date.now()];
  try {
    const { Accelerometer } = await import('expo-sensors');
    Accelerometer.setUpdateInterval(40);
    await new Promise<void>((resolve) => {
      const sub = Accelerometer.addListener((data) => {
        samples.push(data.x, data.y, data.z, Date.now());
      });
      setTimeout(() => {
        sub.remove();
        resolve();
      }, ms);
    });
  } catch {
    samples.push(Date.now(), Math.floor(performance.now()));
  }
  const view = new Float64Array(samples);
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
