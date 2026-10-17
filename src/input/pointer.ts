import type { Shot } from '../core/game/shot.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { aimFromDrag, canGrab, isCancel } from './drag-to-shot.ts';

export interface AimInputOptions {
  /** Converts client (CSS pixel) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): Vec2;
  /** The ball position if a shot may be taken now, else null. */
  ballIfAiming(): Vec2 | null;
  /** Live aim preview while dragging; null when the aim ends or is cancelled. */
  onAimChange(shot: Shot | null): void;
  onShoot(shot: Shot): void;
}

/** Pointer events cover mouse, touch and pen. Returns a function that detaches the listeners. */
export function attachAimInput(el: HTMLElement, opts: AimInputOptions): () => void {
  let activePointer: number | null = null;

  const aimAt = (e: PointerEvent): Shot | null => {
    const ball = opts.ballIfAiming();
    return ball ? aimFromDrag(ball, opts.toWorld(e.clientX, e.clientY)) : null;
  };

  const end = (): void => {
    activePointer = null;
    opts.onAimChange(null);
  };

  const onDown = (e: PointerEvent): void => {
    const ball = opts.ballIfAiming();
    if (activePointer !== null || !ball) return;
    if (!canGrab(ball, opts.toWorld(e.clientX, e.clientY))) return;
    activePointer = e.pointerId;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
    opts.onAimChange(aimAt(e));
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== activePointer) return;
    const shot = aimAt(e);
    if (shot) opts.onAimChange(shot);
    else end();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointer) return;
    const shot = aimAt(e);
    end();
    if (shot && !isCancel(shot)) opts.onShoot(shot);
  };

  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId === activePointer) end();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
