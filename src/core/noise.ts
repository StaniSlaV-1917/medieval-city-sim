// Простой value-noise + fbm, детерминированный от сида.
import { RNG } from './rng';

export class Noise2D {
  private perm: Uint8Array;

  constructor(seed: number) {
    const rng = new RNG(seed);
    const p = new Uint8Array(512);
    const base: number[] = [];
    for (let i = 0; i < 256; i++) base.push(i);
    rng.shuffle(base);
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    this.perm = p;
  }

  private hash(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + y) & 255] / 255;
  }

  /** [0,1] */
  value(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi);
    const b = this.hash(xi + 1, yi);
    const c = this.hash(xi, yi + 1);
    const d = this.hash(xi + 1, yi + 1);
    const x1 = a + (b - a) * u;
    const x2 = c + (d - c) * u;
    return x1 + (x2 - x1) * v;
  }

  /** fbm в [0,1] */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.value(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
