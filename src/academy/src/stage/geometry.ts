import { CONSOLE, type ConsoleSize } from "../theme/tokens.ts";

/** The frame's size on screen, and the scale the console is drawn at inside it. */
export interface FrameFit {
  /** The frame's outer size, its address bar or bezel included, in screen pixels. */
  width: number;
  height: number;
  /** The console's own drawing size: always the device's fixed size. */
  inner: { width: number; height: number };
  scale: number;
  device: ConsoleSize;
}

/**
 * The largest frame for a device's fixed console that fits the space given, keeping the console's
 * shape, so the console is scaled whole — never cut, never reflowed. The frame is set at the top
 * of its space, centred across it; whatever the space has left over is the page's, never the
 * frame's, so nothing empty is drawn inside the frame.
 */
export function fitFrame(space: { width: number; height: number }, device: ConsoleSize): FrameFit {
  const c = CONSOLE[device];
  const edge = 2 * c.bezel;
  const byWidth = (space.width - edge) / c.width;
  const byHeight = (space.height - c.chrome - edge) / c.height;
  const scale = Math.max(0.05, Math.min(byWidth, byHeight));
  return {
    width: Math.floor(c.width * scale + edge),
    height: Math.floor(c.height * scale + c.chrome + edge),
    inner: { width: c.width, height: c.height },
    scale,
    device,
  };
}

/** A long id in an address (a run, an app) shortened in its middle, so the frame's bar stays readable. */
export function shortAddress(address: string): string {
  return address.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "$1…");
}
