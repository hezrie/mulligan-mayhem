import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateHole } from '../../../src/core/course/generator.ts';
import { getHole } from '../../../src/core/course/holes/index.ts';
import { ShotRejectedError, type GameEvent } from '../../../src/core/game/machine.ts';
import { ReplayFileSchema, type ReplayFile } from '../../../src/core/game/replay.ts';
import { GameSession } from '../../../src/core/game/session.ts';
import type { Shot } from '../../../src/core/game/shot.ts';
import { hashHole, hashState } from '../../../src/core/hash.ts';
import { DT } from '../../../src/core/physics/constants.ts';
import { installTestApi, type TestApiDeps, type TestApiHost } from '../../../src/testing/api.ts';
import type { CueEntry, FxSnapshot } from '../../../src/testing/types.ts';

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

function loadReplay(file: string): ReplayFile {
  const path = join(import.meta.dirname, '../../replays', file);
  return ReplayFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function setupWithHooks(audio?: TestApiDeps['audio']) {
  const shots: { shot: Shot; step: number }[] = [];
  const events: { event: GameEvent; step: number }[] = [];
  const api = installTestApi(
    {},
    {
      session: new GameSession(getHole('skeleton-01'), 1),
      getHole,
      useManualClock: () => undefined,
      worldToClient: (p) => p,
      onShot: (shot, step) => shots.push({ shot, step }),
      onEvent: (event, step) => events.push({ event, step }),
      ...(audio ? { audio } : {}),
    },
  );
  return { api, shots, events };
}

function playThroughApi(file: string) {
  const replay = loadReplay(file);
  const ctx = setupWithHooks();
  ctx.api.loadHole(replay.holeId, replay.seed);
  for (const s of replay.shots) {
    if (ctx.api.getState().phase !== 'aiming') break;
    ctx.api.shoot(s.angle, s.power);
    ctx.api.fastForward('untilRest');
  }
  return ctx;
}

function fakeAudio() {
  let log: CueEntry[] = [{ channel: 'sfx', cue: 'putt', step: 0 }];
  let clears = 0;
  const audio = {
    cueLog: {
      entries: () => log,
      clear: () => {
        clears++;
        log = [];
      },
    },
    debugState: () => ({ engine: 'fake', muted: false, volume: 0.5 }),
  };
  return {
    audio,
    setLog: (l: CueEntry[]) => {
      log = l;
    },
    clears: () => clears,
  };
}

describe('window.__MM__ test API: shot and event forwarding', () => {
  it('shoot calls onShot with the shot and the step it was taken at', () => {
    const { api, shots } = setupWithHooks();
    api.loadHole('skeleton-01');
    api.fastForward(100);
    api.shoot(0.25, 0.5);
    expect(shots).toEqual([{ shot: { angle: 0.25, power: 0.5 }, step: 12 }]);
  });

  it('a rejected shot throws ShotRejectedError and does not call onShot', () => {
    const { api, shots } = setupWithHooks();
    api.loadHole('skeleton-01');
    api.shoot(0, 0.5);
    expect(() => {
      api.shoot(0, 0.5);
    }).toThrow(ShotRejectedError);
    expect(shots).toHaveLength(1);
  });

  it('forwards every shot and event of the hole-in-one replay', () => {
    const { shots, events } = playThroughApi('skeleton-01-hole-in-one.json');
    expect(shots.map((s) => s.step)).toEqual([0]);
    expect(events.map((e) => [e.event.type, e.step])).toEqual([
      ['bounce', 55],
      ['cup', 151],
      ['holed', 151],
    ]);
    const bounce = events[0]?.event;
    expect(bounce?.type === 'bounce' && bounce.impulse.toFixed(3)).toBe('817.266');
    expect(events[2]?.event).toEqual({ type: 'holed', strokes: 1 });
  });

  it('forwards every shot and event of the par replay', () => {
    const { shots, events } = playThroughApi('skeleton-01-par.json');
    expect(shots.map((s) => s.step)).toEqual([0, 157, 268]);
    expect(events.map((e) => [e.event.type, e.step])).toEqual([
      ['rest', 157],
      ['rest', 268],
      ['cup', 294],
      ['holed', 294],
    ]);
    expect(events[3]?.event).toEqual({ type: 'holed', strokes: 3 });
  });

  it.each([
    'skeleton-01-hole-in-one.json',
    'skeleton-01-par.json',
    'skeleton-01-wall-bank-bogey.json',
  ])('fastForward(untilRest) matches runUntilRest shot by shot in %s', (file) => {
    const replay = loadReplay(file);
    const { api } = setupWithHooks();
    api.loadHole(replay.holeId, replay.seed);
    const twin = new GameSession(getHole(replay.holeId), replay.seed);
    for (const s of replay.shots) {
      if (twin.state.phase !== 'aiming') break;
      api.shoot(s.angle, s.power);
      twin.shoot(s);
      expect(api.fastForward('untilRest')).toBe(twin.runUntilRest());
      expect(api.getStateHash()).toBe(hashState(twin.state));
    }
  });

  it('fastForward(500) still runs 60 steps', () => {
    const { api } = setupWithHooks();
    api.loadHole('skeleton-01');
    expect(api.fastForward(500)).toBe(60);
  });
});

describe('window.__MM__ test API: audio', () => {
  it('getCueLog returns a detached copy of the cue log', () => {
    const { api } = setupWithHooks(fakeAudio().audio);
    const copy = api.getCueLog();
    expect(copy).toEqual([{ channel: 'sfx', cue: 'putt', step: 0 }]);
    copy.push({ channel: 'x', cue: 'y', step: 1 });
    expect(api.getCueLog()).toEqual([{ channel: 'sfx', cue: 'putt', step: 0 }]);
  });

  it('clearCueLog clears the audio cue log', () => {
    const fake = fakeAudio();
    const { api } = setupWithHooks(fake.audio);
    api.clearCueLog();
    expect(fake.clears()).toBe(1);
    expect(api.getCueLog()).toEqual([]);
  });

  it('getAudioState returns the audio debug state', () => {
    const { api } = setupWithHooks(fakeAudio().audio);
    expect(api.getAudioState()).toEqual({ engine: 'fake', muted: false, volume: 0.5 });
  });

  it('loadHole clears the cue log', () => {
    const fake = fakeAudio();
    const { api } = setupWithHooks(fake.audio);
    fake.setLog([{ channel: 'sfx', cue: 'tonk', step: 3 }]);
    api.loadHole('skeleton-01');
    expect(fake.clears()).toBe(1);
    expect(api.getCueLog()).toEqual([]);
  });

  it('without audio, the cue log is empty and the engine is absent', () => {
    const { api } = setupWithHooks();
    expect(api.getCueLog()).toEqual([]);
    api.clearCueLog();
    expect(api.getAudioState()).toEqual({ engine: 'absent' });
  });

  it('getGeneratedHoleHash equals hashHole(generateHole(seed, index))', () => {
    const { api } = setup();
    expect(api.getGeneratedHoleHash(12345, 0)).toBe(hashHole(generateHole(12345, 0)));
    expect(api.getGeneratedHoleHash(7, 8)).toBe(hashHole(generateHole(7, 8)));
  });
});
