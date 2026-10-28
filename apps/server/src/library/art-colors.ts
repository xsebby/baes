import { readFile } from 'node:fs/promises';

/** Average colors of a JPEG cover's four quadrants, brightened a little: TL, TR, BL, BR. */
export async function quadrantColors(artPath: string): Promise<string[]> {
  const { default: jpeg } = await import('jpeg-js');
  const img = jpeg.decode(await readFile(artPath), { maxMemoryUsageInMB: 64 });
  const { width, height, data } = img;
  const quad = (x0: number, y0: number) => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = y0; y < y0 + height / 2; y += 8) {
      for (let x = x0; x < x0 + width / 2; x += 8) {
        const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
        r += data[idx]!;
        g += data[idx + 1]!;
        b += data[idx + 2]!;
        n++;
      }
    }
    const boost = (v: number) => Math.min(255, Math.round((v / n) * 1.25));
    return `rgb(${boost(r)}, ${boost(g)}, ${boost(b)})`;
  };
  return [quad(0, 0), quad(width / 2, 0), quad(0, height / 2), quad(width / 2, height / 2)];
}

/** One "#rrggbb" for the whole cover (the mean of its quadrants). */
export async function coverColor(artPath: string): Promise<string> {
  const rgb = (await quadrantColors(artPath)).map((c) => c.match(/\d+/g)!.map(Number));
  const hex = [0, 1, 2]
    .map((i) => Math.round(rgb.reduce((sum, c) => sum + c[i]!, 0) / rgb.length))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
