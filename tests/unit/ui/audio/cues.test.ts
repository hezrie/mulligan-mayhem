import { describe, expect, it, vi } from 'vitest';
import {
  createCueLog,
  createSoundscape,
  type CueLogEntry,
  type SoundTrigger,
} from '../../../../src/ui/audio/cues.ts';
import { createHaptics, hapticFor } from '../../../../src/ui/audio/haptics.ts';
import { stingerFor } from '../../../../src/ui/audio/stingers.ts';
import { voiceFor, type Voice } from '../../../../src/ui/audio/voices.ts';

const PAR = 3;

function setup(playResult = true, now = 0) {
  const play = vi.fn<(voice: Voice, options?: { readonly at?: number }) => boolean>(
    () => playResult,
  );
  const engine = { play, now: () => now };
  const log = createCueLog();
  const soundscape = createSoundscape({ engine, log });
  const at = (step: number, trigger: SoundTrigger): void => {
    soundscape.handle(trigger, { step, par: PAR });
  };
  return { play, log, at, soundscape };
}

const sfx = (cue: CueLogEntry['cue'], step: number): CueLogEntry => ({ channel: 'sfx', cue, step });
const stinger = (cue: string, step: number): CueLogEntry => ({ channel: 'stinger', cue, step });

describe('createSoundscape mapping', () => {
  it('plays putt for a shot, bounce for a hard bounce and cup for cup', () => {
    const { play, log, at } = setup();
    at(1, { type: 'shot', power: 0.8 });
    at(2, { type: 'bounce', impulse: 30 });
    at(3, { type: 'cup' });
    expect(log.entries()).toEqual([sfx('putt', 1), sfx('bounce', 2), sfx('cup', 3)]);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('produces no cue for rest and no sfx cue for holed', () => {
    const { play, log, at } = setup();
    at(4, { type: 'rest', forced: false });
    at(5, { type: 'rest', forced: true });
    at(6, { type: 'holed', strokes: 2 });
    expect(log.entries()).toEqual([stinger('birdie', 6)]);
    expect(play.mock.calls).toEqual([[stingerFor(2, PAR).voice, { at: 0.25 }]]);
  });

  it('logs and plays a one-putt hole in order with the matching voices', () => {
    const { play, log, at } = setup();
    at(0, { type: 'shot', power: 0.5 });
    at(55, { type: 'bounce', impulse: 817.3 });
    at(151, { type: 'cup' });
    at(151, { type: 'holed', strokes: 1 });
    expect(log.entries()).toEqual([
      sfx('putt', 0),
      sfx('bounce', 55),
      sfx('cup', 151),
      stinger('hole-in-one', 151),
    ]);
    expect(play.mock.calls).toEqual([
      [voiceFor('putt', { power: 0.5 })],
      [voiceFor('bounce', { impulse: 817.3, seed: 55 })],
      [voiceFor('cup', {})],
      [stingerFor(1, PAR).voice, { at: 0.25 }],
    ]);
  });
});

describe('createSoundscape stingers', () => {
  it.each([
    [1, 'hole-in-one'],
    [2, 'birdie'],
    [3, 'par'],
    [4, 'bogey'],
    [6, 'double-bogey'],
  ])('holed in %d on a par 3 logs and plays %s 0.25 s after now()', (strokes, name) => {
    const { play, log, at } = setup(true, 5);
    at(294, { type: 'holed', strokes });
    expect(log.entries()).toEqual([stinger(name, 294)]);
    expect(play.mock.calls).toEqual([[stingerFor(strokes, PAR).voice, { at: 5.25 }]]);
  });

  it('takes par from the sound context', () => {
    const { play, log, soundscape } = setup(true, 5);
    soundscape.handle({ type: 'holed', strokes: 4 }, { step: 300, par: 4 });
    expect(log.entries()).toEqual([stinger('par', 300)]);
    expect(play.mock.calls).toEqual([[stingerFor(4, 4).voice, { at: 5.25 }]]);
  });

  it('leaves the sfx cues of a holed-out hole unchanged', () => {
    const { play, log, at } = setup(true, 5);
    at(0, { type: 'shot', power: 0.5 });
    at(290, { type: 'cup' });
    at(294, { type: 'holed', strokes: 3 });
    expect(log.entries().filter((e) => e.channel === 'sfx')).toEqual([
      sfx('putt', 0),
      sfx('cup', 290),
    ]);
    expect(play.mock.calls.slice(0, 2)).toEqual([
      [voiceFor('putt', { power: 0.5 })],
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

  it('restarts the cooldown when the step goes back, as on a reloaded hole', () => {
    const { play, log, at } = setup();
    at(55, { type: 'bounce', impulse: 800 });
    at(46, { type: 'bounce', impulse: 750 });
    expect(log.entries()).toEqual([sfx('bounce', 55), sfx('bounce', 46)]);
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

function hapticSetup() {
  const vibrate = vi.fn<(pattern: VibratePattern) => boolean>(() => true);
  const haptics = createHaptics({ vibrate });
  haptics.arm();
  const engine = { play: () => true, now: () => 0 };
  const soundscape = createSoundscape({ engine, log: createCueLog(), haptics });
  const at = (step: number, trigger: SoundTrigger): void => {
    soundscape.handle(trigger, { step, par: PAR });
  };
  const pulses = (): unknown[] => vibrate.mock.calls.map(([pattern]) => pattern);
  return { at, pulses };
}

describe('createSoundscape haptics', () => {
  it('pulses the putt, the bounce and the hole-in-one pattern for a one-putt hole', () => {
    const { at, pulses } = hapticSetup();
    at(0, { type: 'shot', power: 0.925 });
    at(55, { type: 'bounce', impulse: 817.266 });
    at(151, { type: 'cup' });
    at(151, { type: 'holed', strokes: 1 });
    expect(pulses()).toEqual([24, 25, [30, 60, 30, 60, 120]]);
  });

  it('pulses the putt and bounce patterns from hapticFor', () => {
    const { at, pulses } = hapticSetup();
    at(0, { type: 'shot', power: 0.3 });
    at(10, { type: 'bounce', impulse: 200 });
    expect(pulses()).toEqual([
      hapticFor({ type: 'putt', power: 0.3 }),
      hapticFor({ type: 'bounce', impulse: 200 }),
    ]);
  });

  it('pulses only bounces that survive the cooldown', () => {
    const { at, pulses } = hapticSetup();
    for (const step of [10, 11, 12, 13]) at(step, { type: 'bounce', impulse: 500 });
    expect(pulses()).toEqual([25, 25]);
  });

  it('pulses only the cup pattern when holed in more than one stroke', () => {
    const { at, pulses } = hapticSetup();
    at(294, { type: 'holed', strokes: 3 });
    expect(pulses()).toEqual([[15, 40, 30]]);
  });

  it('pulses nothing for cup or rest', () => {
    const { at, pulses } = hapticSetup();
    at(1, { type: 'cup' });
    at(2, { type: 'rest', forced: false });
    at(3, { type: 'rest', forced: true });
    expect(pulses()).toEqual([]);
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
