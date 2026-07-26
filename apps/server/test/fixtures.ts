import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Minimal valid 16-bit PCM WAV: `seconds` of a sine tone at 8kHz mono. */
export function makeWav(seconds: number, freq = 440): Buffer {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 20000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

export async function writeFixtureLibrary(dir: string): Promise<void> {
  await mkdir(path.join(dir, 'album1'), { recursive: true });
  await writeFile(path.join(dir, 'album1', 'Artist One - Song A.wav'), makeWav(1.0, 440));
  await writeFile(path.join(dir, 'album1', 'Artist One - Song B.wav'), makeWav(0.5, 660));
  await writeFile(path.join(dir, 'untitled_demo_v2.wav'), makeWav(0.25, 880));
}
