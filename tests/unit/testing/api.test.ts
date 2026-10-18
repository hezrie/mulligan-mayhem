import { describe, expect, it } from 'vitest';
import { getHole } from '../../../src/core/course/holes/index.ts';
import { GameSession } from '../../../src/core/game/session.ts';
import { hashState } from '../../../src/core/hash.ts';
import { DT } from '../../../src/core/physics/constants.ts';
import { installTestApi, type TestApiHost } from '../../../src/testing/api.ts';
import type { FxSnapshot } from '../../../src/testing/types.ts';

function setup(fxSnapshot?: () => FxSnapshot) {
  const host: TestApiHost = {};
  const session = new GameSession(getHole('skeleton-01'), 1);
  let manual = false;
  const api = installTestApi(host, {
    session,
    getHole,
    useManualClock: () => {
      manual = true;
    },
    worldToClient: (p) => ({ x: p.x * 2, y: p.y * 2 }),
    ...(fxSnapshot ? { fxSnapshot } : {}),
  });
  return { host, api, session, isManual: () => manual };
}

describe('window.__MM__ test API', () => {
  it('installs itself on the host and reports ready', () => {
    const { host, api } = setup();
    expect(host.__MM__).toBe(api);
    expect(api.ready).toBe(true);
  });

  it('loadHole switches to the manual clock and resets to the tee', () => {
    const { api, isManual } = setup();
    api.loadHole('skeleton-01', 5);
    expect(isManual()).toBe(true);
    expect(api.getState()).toMatchObject({ holeId: 'skeleton-01', strokes: 0, phase: 'aiming' });
  });

  it('shoot + fastForward(untilRest) plays exactly like the session', () => {
    const { api } = setup();
    api.loadHole('skeleton-01');
    api.shoot(-2.207867, 0.591508);
    expect(api.fastForward('untilRest')).toBeGreaterThan(0);
    const reference = new GameSession(getHole('skeleton-01'), 1);
    reference.shoot({ angle: -2.207867, power: 0.591508 });
    reference.runUntilRest();
    expect(api.getStateHash()).toBe(hashState(reference.state));
  });

  it('fastForward(ms) runs the matching number of fixed steps', () => {
    const { api } = setup();
    api.loadHole('skeleton-01');
    expect(api.fastForward(500)).toBe(Math.round(0.5 / DT));
    expect(api.getState().step).toBe(60);
  });

  it('getState returns a detached copy', () => {
    const { api, session } = setup();
    const copy = api.getState();
    expect(copy).toEqual(session.state);
    expect(copy).not.toBe(session.state);
  });

  it('reports the ball position in client pixels', () => {
    const { api } = setup();
    expect(api.getBallClientPosition()).toEqual({ x: 480, y: 980 });
  });

  it('rejects shots while the ball is rolling', () => {
    const { api } = setup();
    api.loadHole('skeleton-01');
    api.shoot(0, 0.5);
    expect(() => {
      api.shoot(0, 0.5);
    }).toThrow();
  });

  it('getFx returns an empty snapshot when no fxSnapshot dep is given', () => {
    const { api } = setup();
    expect(api.getFx()).toEqual({});
  });

  it('getFx returns a detached copy of the fx snapshot', () => {
    const source = { plunk: { stamp: 'PAR' } };
    const { api } = setup(() => source);
    const copy = api.getFx();
    expect(copy).toEqual({ plunk: { stamp: 'PAR' } });
    expect(copy).not.toBe(source);
    (copy as { plunk: { stamp: string } }).plunk.stamp = 'X';
    expect(api.getFx()).toEqual({ plunk: { stamp: 'PAR' } });
    expect(source.plunk.stamp).toBe('PAR');
  });

  it('getFx reads the fxSnapshot dep on every call', () => {
    let current: FxSnapshot = { a: 1 };
    const { api } = setup(() => current);
    expect(api.getFx()).toEqual({ a: 1 });
    current = { a: 2 };
    expect(api.getFx()).toEqual({ a: 2 });
  });
});
