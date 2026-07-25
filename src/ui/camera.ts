// Pan/zoom camera: world coordinates -> screen pixels.
export interface Camera {
  x: number;      // world coordinate at the screen centre
  y: number;
  scale: number;  // screen pixels per world unit
}

export function worldToScreen(cam: Camera, w: number, h: number, wx: number, wy: number): [number, number] {
  return [(wx - cam.x) * cam.scale + w / 2, (wy - cam.y) * cam.scale + h / 2];
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / cam.scale + cam.x, (sy - h / 2) / cam.scale + cam.y];
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(cam: Camera, w: number, h: number, sx: number, sy: number, factor: number): Camera {
  const scale = Math.min(80, Math.max(0.05, cam.scale * factor));
  const [wx, wy] = screenToWorld(cam, w, h, sx, sy);
  const eff = scale / cam.scale;
  // keep (wx, wy) under the cursor: solve for the new centre
  return {
    scale,
    x: wx - (wx - cam.x) / eff,
    y: wy - (wy - cam.y) / eff,
  };
}
