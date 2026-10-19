/**
 * Seeded, pooled particle engine for sparks, sand sprays and confetti. Pure maths: no drawing and
 * no game state. Slots are allocated once, so memory never grows past MAX_PARTICLES on
 * low-end phones, and all jitter comes from a pool-owned Rng so a seed reproduces every particle.
 */
import { direction } from '../core/math/trig.ts';
import { Rng } from '../core/rng.ts';
import { lerp } from './easing.ts';

/** Hard ceiling on live particles; beyond it the oldest slot is recycled. */
export const MAX_PARTICLES = 256;

export interface ParticlePreset {
  readonly count: number;
  /** Seconds a particle lives. */
  readonly life: number;
  /** Downward acceleration, in units/s². */
  readonly gravity: number;
  readonly speedMin: number;
  readonly speedMax: number;
  /** Full width of the emission cone, in radians, centred on baseAngle. */
  readonly spread: number;
  readonly baseAngle: number;
  readonly size: number;
  readonly colors: readonly string[];
}

export interface EmitOptions {
  readonly count?: number;
  /** Multiplies the count, e.g. to thin out effects for reduced motion. */
  readonly scale?: number;
  readonly baseAngle?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  gravity: number;
}

/** A slot is free when age ≥ life; a fresh slot has both at 0. */
function freeSlot(): Particle {
  return { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, color: '', gravity: 0 };
}

export class ParticlePool {
  readonly #rng: Rng;
  readonly #slots: Particle[] = Array.from({ length: MAX_PARTICLES }, freeSlot);
  readonly #live: Particle[] = [];
  /** Ring index of the next slot; slots fill in emit order, so overflow recycles the oldest. */
  #next = 0;

  constructor(seed: number) {
    this.#rng = new Rng(seed);
  }

  get live(): readonly Readonly<Particle>[] {
    return this.#live;
  }

  emit(preset: ParticlePreset, x: number, y: number, opts: EmitOptions = {}): void {
    const count = Math.round((opts.count ?? preset.count) * (opts.scale ?? 1));
    const baseAngle = opts.baseAngle ?? preset.baseAngle;
    for (let i = 0; i < count; i++) {
      // Draw order is fixed (angle, speed, colour) so a seed always yields the same particles.
      const angle = baseAngle + (this.#rng.float() - 0.5) * preset.spread;
      const speed = lerp(preset.speedMin, preset.speedMax, this.#rng.float());
      const color = preset.colors[this.#rng.int(0, preset.colors.length - 1)] ?? '';
      const dir = direction(angle);
      const p = this.#slots[this.#next] ?? freeSlot();
      p.x = x;
      p.y = y;
      p.vx = dir.x * speed;
      p.vy = dir.y * speed;
      p.age = 0;
      p.life = preset.life;
      p.size = preset.size;
      p.color = color;
      p.gravity = preset.gravity;
      this.#next = (this.#next + 1) % MAX_PARTICLES;
    }
    this.#collectLive();
  }

  update(dtSeconds: number): void {
    for (const p of this.#live) {
      // Semi-implicit Euler: velocity first, then position with the new velocity.
      p.vy += p.gravity * dtSeconds;
      p.x += p.vx * dtSeconds;
      p.y += p.vy * dtSeconds;
      p.age += dtSeconds;
    }
    this.#collectLive();
  }

  clear(): void {
    for (const p of this.#slots) p.age = p.life;
    this.#live.length = 0;
  }

  /** Rebuilds the live list in place, so steady-state frames allocate nothing. */
  #collectLive(): void {
    this.#live.length = 0;
    for (const p of this.#slots) if (p.age < p.life) this.#live.push(p);
  }
}
