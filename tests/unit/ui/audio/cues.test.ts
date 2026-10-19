import { describe, expect, it, vi } from 'vitest';
import {
  createCueLog,
  createSoundscape,
  type CueLogEntry,
  type SoundTrigger,
} from '../../../../src/ui/audio/cues.ts';
import { voiceFor, type Voice } from '../../../../src/ui/audio/voices.ts';

const PAR = 3;

function setup(playResult = true) {
  const play = vi.fn<(voice: Voice) => boolean>(() => playResult);
  const engine = { play, now: () => 0 };
  const log = createCueLog();
  const soundscape = createSoundscape({ engine, log });
  const at = (step: number, trigger: SoundTrigger): void => {
    soundscape.handle(trigger, { step, par: PAR });
  };
  return { play, log, at };
}

const sfx = (cue: CueLogEntry['cue'], step: number): CueLogEntry => ({ channel: 'sfx', cue, step });

describe('createSoundscape mapping', () => {
  it('plays putt for a shot, bounce for a hard bounce and cup for cup', () => {
    const { play, log, at } = setup();
    at(1, { type: 'shot', power: 0.8 });
    at(2, { type: 'bounce', impulse: 30 });
    at(3, { type: 'cup' });
    expect(log.entries()).toEqual([sfx('putt', 1), sfx('bounce', 2), sfx('cup', 3)]);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('produces no cue for rest or holed', () => {
    const { play, log, at } = setup();
    at(4, { type: 'rest', forced: false });
    at(5, { type: 'rest', forced: true });
    at(6, { type: 'holed', strokes: 2 });
    expect(log.entries()).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it('logs and plays a one-putt hole in order with the matching voices', () => {
    const { play, log, at } = setup();
    at(0, { type: 'shot', power: 0.5 });
    at(55, { type: 'bounce', impulse: 817.3 });
    at(151, { type: 'cup' });
    at(151, { type: 'holed', strokes: 1 });
    expect(log.entries()).toEqual([sfx('putt', 0), sfx('bounce', 55), sfx('cup', 151)]);
    expect(play.mock.calls).toEqual([
      [voiceFor('putt', { power: 0.5 })],
      [voiceFor('bounce', { impulse: 817.3, seed: 55 })],
      [voiceFor('cup', {})],
    ]);
  });
});

describe('createSoundscape bounce cooldown', () => {
  it('drops bounces less than 3 steps after the last bounce cue', () => {
    const { play, log, at } = setup();
    for (const step of [10, 10, 12, 13]) at(step, { type: 'bounce', impulse: 100 });
    expect(log.entries()).toEqual([sfx('bounce', 10), sfx('bounce', 13)]);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('ignores soft bounces without restarting the cooldown', () => {
    const { play, log, at } = setup();
    at(10, { type: 'bounce', impulse: 100 });
    at(12, { type: 'bounce', impulse: 29.9 });
    at(13, { type: 'bounce', impulse: 100 });
    at(14, { type: 'bounce', impulse: 29.9 });
    expect(log.entries()).toEqual([sfx('bounce', 10), sfx('bounce', 13)]);
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('createCueLog', () => {
  it('records entries in order and keeps only the newest 200', () => {
    const log = createCueLog();
    for (let step = 0; step < 201; step += 1) log.record(sfx('bounce', step));
    const entries = log.entries();
    expect(entries).toHaveLength(200);
    expect(entries[0]).toEqual(sfx('bounce', 1));
    expect(entries[199]).toEqual(sfx('bounce', 200));
  });

  it('honours a custom capacity and records every channel', () => {
    const log = createCueLog(2);
    log.record({ channel: 'stinger', cue: 'cup', step: 1 });
    log.record({ channel: 'crowd', cue: 'cup', step: 2 });
    log.record(sfx('putt', 3));
    expect(log.entries()).toEqual([{ channel: 'crowd', cue: 'cup', step: 2 }, sfx('putt', 3)]);
  });

  it('returns a copy from entries() and empties on clear()', () => {
    const log = createCueLog();
    log.record(sfx('putt', 0));
    const copy = log.entries() as CueLogEntry[];
    copy.push(sfx('cup', 9));
    expect(log.entries()).toEqual([sfx('putt', 0)]);
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it('logs cues even when the engine cannot play', () => {
    const { play, log, at } = setup(false);
    at(0, { type: 'shot', power: 0.5 });
    at(20, { type: 'bounce', impulse: 400 });
    at(30, { type: 'cup' });
    expect(play).toHaveBeenCalledTimes(3);
    expect(log.entries()).toEqual([sfx('putt', 0), sfx('bounce', 20), sfx('cup', 30)]);
  });
});
