import { compileCourse, type Course } from '../course/course.ts';
import type { Hole } from '../course/schema.ts';
import { MAX_ROLL_STEPS } from '../physics/constants.ts';
import { createGame, shoot, tick, type GameEvent } from './machine.ts';
import type { Shot } from './shot.ts';
import type { GameState } from './state.ts';

/** Cap on undrained events, so a session nobody drains (e.g. the replay runner) stays bounded. */
export const MAX_PENDING_EVENTS = 1024;

/**
 * A small mutable holder around the pure state machine, shared by the render loop, the test
 * API and the replay runner, so they all step the game the same way.
 */
export class GameSession {
  #course: Course;
  #seed: number;
  #state: GameState;
  #pending: GameEvent[] = [];

  constructor(hole: Hole, seed: number) {
    this.#course = compileCourse(hole);
    this.#seed = seed;
    this.#state = createGame(this.#course, seed);
  }

  get state(): GameState {
    return this.#state;
  }

  get course(): Course {
    return this.#course;
  }

  load(hole: Hole, seed: number): void {
    this.#course = compileCourse(hole);
    this.#seed = seed;
    this.reset();
  }

  /** Restarts the current hole from the tee with the same seed. */
  reset(): void {
    this.#state = createGame(this.#course, this.#seed);
    this.#pending = [];
  }

  /** Throws ShotRejectedError unless aiming with a valid shot. */
  shoot(shot: Shot): void {
    this.#state = shoot(this.#state, shot);
  }

  advance(steps: number): GameEvent[] {
    const events: GameEvent[] = [];
    for (let i = 0; i < steps; i++) {
      const r = tick(this.#state, this.#course);
      this.#state = r.state;
      events.push(...r.events);
    }
    this.#record(events);
    return events;
  }

  /** Steps until the ball stops rolling. Always terminates (safety cap). Returns steps run. */
  runUntilRest(): number {
    let steps = 0;
    while (this.#state.phase === 'rolling' && steps <= MAX_ROLL_STEPS) {
      const r = tick(this.#state, this.#course);
      this.#state = r.state;
      this.#record(r.events);
      steps++;
    }
    return steps;
  }

  /** Every event since the last drain, load or reset, oldest first; empties the buffer. */
  drainEvents(): GameEvent[] {
    const events = this.#pending;
    this.#pending = [];
    return events;
  }

  #record(events: readonly GameEvent[]): void {
    this.#pending.push(...events);
    if (this.#pending.length > MAX_PENDING_EVENTS) {
      this.#pending.splice(0, this.#pending.length - MAX_PENDING_EVENTS);
    }
  }
}
