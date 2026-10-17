import type { Vec2 } from '../core/math/vec2.ts';

/** Maps world units to CSS pixels: screen = world × scale + offset. */
export interface View {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Largest uniform scale that fits the hole inside the viewport with padding, centred. */
export function fitView(
  viewportWidth: number,
  viewportHeight: number,
  world: { readonly width: number; readonly height: number },
  padding: number,
): View {
  const scale = Math.max(
    0.01,
    Math.min(
      (viewportWidth - 2 * padding) / world.width,
      (viewportHeight - 2 * padding) / world.height,
    ),
  );
  return {
    scale,
    offsetX: (viewportWidth - world.width * scale) / 2,
    offsetY: (viewportHeight - world.height * scale) / 2,
  };
}

export function worldToScreen(view: View, p: Vec2): Vec2 {
  return { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY };
}

export function screenToWorld(view: View, p: Vec2): Vec2 {
  return { x: (p.x - view.offsetX) / view.scale, y: (p.y - view.offsetY) / view.scale };
}
