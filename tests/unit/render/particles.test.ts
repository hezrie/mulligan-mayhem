import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticlePool, type ParticlePreset } from '../../../src/render/particles.ts';

const SPARKS: ParticlePreset = {
  count: 12,
  life: 0.8,
  gravity: 200,
  speedMin: 40,
  speedMax: 160,
  spread: Math.PI,
  baseAngle: -Math.PI / 2,
  size: 2,
  colors: ['#fff', '#fc0', '#f60'],
};

const STILL: ParticlePreset = {
  count: 1,
  life: 10,
  gravity: 0,
  speedMin: 0,
  speedMax: 0,
  spread: 0,
  baseAngle: 0,
  size: 1,
  colors: ['#fff'],
};

function run(seed: number): ParticlePool {
  const pool = new ParticlePool(seed);
  pool.emit(SPARKS, 10, 20);
  pool.update(1 / 60);
  pool.emit(SPARKS, 50, 60, { count: 5, baseAngle: 0 });
  pool.update(0.1);
  return pool;
}

describe('ParticlePool determinism', () => {
  it('two pools with seed 7 match exactly and seed 8 differs', () => {
    const a = run(7);
    const b = run(7);
    expect(a.live.length).toBe(17);
    expect(a.live).toEqual(b.live);
    expect(run(8).live).not.toEqual(a.live);
  });

  it('exposes the particle fields', () => {
    const pool = new ParticlePool(7);
    pool.emit(SPARKS, 1, 2);
    const p = pool.live[0];
    expect(Object.keys(p ?? {}).sort()).toEqual(
      ['age', 'color', 'gravity', 'life', 'size', 'vx', 'vy', 'x', 'y'].sort(),
    );
    expect(p).toMatchObject({ x: 1, y: 2, age: 0, life: 0.8, size: 2, gravity: 200 });
    expect(SPARKS.colors).toContain(p?.color);
  });
});

describe('ParticlePool capacity', () => {
  it('recycles the oldest particles beyond 256', () => {
    expect(MAX_PARTICLES).toBe(256);
    const pool = new ParticlePool(1);
    for (let x = 0; x < 300; x++) pool.emit(STILL, x, 0);
    expect(pool.live.length).toBe(256);
    expect(Math.min(...pool.live.map((p) => p.x))).toBe(44);
  });
});

describe('ParticlePool motion', () => {
  it('uses semi-implicit Euler', () => {
    const pool = new ParticlePool(1);
    pool.emit({ ...STILL, gravity: 600 }, 0, 100);
    pool.update(0.5);
    expect(pool.live[0]?.vy).toBe(300);
    expect(pool.live[0]?.y).toBe(250);
  });

  it('removes a particle once age reaches life', () => {
    const pool = new ParticlePool(1);
    pool.emit({ ...STILL, life: 1.6 }, 0, 0);
    pool.update(1.5);
    expect(pool.live.length).toBe(1);
    pool.update(0.1);
    expect(pool.live.length).toBe(0);
  });
});

describe('ParticlePool emit count', () => {
  it('rounds count × scale and honours opts.count', () => {
    const pool = new ParticlePool(3);
    pool.emit(SPARKS, 0, 0, { scale: 0.25 });
    expect(pool.live.length).toBe(3);
    pool.emit(SPARKS, 0, 0, { scale: 0 });
    expect(pool.live.length).toBe(3);
    pool.emit(SPARKS, 0, 0, { count: 50 });
    expect(pool.live.length).toBe(53);
    pool.clear();
    expect(pool.live.length).toBe(0);
  });
});

describe('purity', () => {
  it('touches no canvas, DOM, clock or game state', () => {
    const src = readFileSync(new URL('../../../src/render/particles.ts', import.meta.url), 'utf8');
    for (const banned of [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bcanvas\b/i,
      /\bDate\b/,
      /\bperformance\b/,
      /\bMath\.random\b/,
      /\bGameState\b/,
      /\bset(Timeout|Interval)\b/,
      /\brequestAnimationFrame\b/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });
});
