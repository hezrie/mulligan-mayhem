import { closestPointOnSegment, type Segment } from '../math/geometry.ts';
import { add, dot, length, normalize, perp, scale, sub, type Vec2 } from '../math/vec2.ts';

export interface Contact {
  /** Unit normal pointing from the wall toward the ball's centre. */
  readonly normal: Vec2;
  /** How far the ball overlaps the wall. */
  readonly depth: number;
}

export function contactCircleSegment(center: Vec2, radius: number, seg: Segment): Contact | null {
  const closest = closestPointOnSegment(center, seg);
  const offset = sub(center, closest);
  const dist = length(offset);
  if (dist >= radius) return null;
  // Centre exactly on the wall: there is no offset direction, so use the wall's own normal.
  const normal = dist > 0 ? scale(offset, 1 / dist) : normalize(perp(sub(seg.b, seg.a)));
  return { normal, depth: radius - dist };
}

export interface Resolution {
  readonly pos: Vec2;
  readonly vel: Vec2;
  /** Change in normal speed caused by the bounce (0 if only separated). Drives juice later. */
  readonly impulse: number;
}

/**
 * Pushes the ball out of the wall, then (if it is moving into the wall) reflects the normal
 * velocity scaled by restitution and trims the tangential velocity by friction. With
 * restitution ≤ 1 and friction ≥ 0 this can never increase speed.
 */
export function resolveContact(
  pos: Vec2,
  vel: Vec2,
  contact: Contact,
  restitution: number,
  friction: number,
): Resolution {
  const separated = add(pos, scale(contact.normal, contact.depth));
  const vn = dot(vel, contact.normal);
  if (vn >= 0) return { pos: separated, vel, impulse: 0 };
  const tangential = sub(vel, scale(contact.normal, vn));
  const bounced = add(scale(tangential, 1 - friction), scale(contact.normal, -vn * restitution));
  return { pos: separated, vel: bounced, impulse: -vn * (1 + restitution) };
}
