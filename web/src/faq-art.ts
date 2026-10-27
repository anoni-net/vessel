// Beside the home page's FAQ: a cross-section of one connection, top to bottom, and what each layer sees.
// Requests go down the left, replies come up the right. A packet is a 5 × 3 grid:
//
//   top row        where it is going (purple)
//   middle, left   the IP it comes from: yours (ink) until the node, the node's (lavender) after it
//   bottom, right  your account (amber), inside HTTPS
//
//   your device    everything, as it is
//   your provider  disguised as noise of no fixed size: no destination, no account, not even "VPN"
//   Vessel node    the destination and your IP, not the account (HTTPS)
//   websites       the destination, the node's IP instead of yours, and your account once you sign in
//
// The pointer marks what the layer under it can read. Plain Canvas 2D, loaded after the page is up, only
// where there is room beside the questions (pages/faq.tsx).

const DEST = "#7c5cf0";
const YOU = "#13232a";
const NODE = "#c4b5fd";
const ACCOUNT = "#e39a0b";
const BODY = ["#9aa6ab", "#b6bfc3", "#87959b"];
const NOISE = ["#13232a", "#52646b", "#7d8b91", "#9aa6ab", "#a78bfa", "#c4b5fd"];
const RED = "#b3261e"; // the lens marks what a layer can read

const COLS = 5;
const ROWS = 3;
const CELL = 7;
const GAP = 3;
const PITCH = CELL + GAP;
const SPEED = 46;

// where each layer starts, as a share of the height; the labels in pages/faq.tsx use the same numbers
export const LAYERS = [0, 0.16, 0.48, 0.72] as const;
type Layer = 0 | 1 | 2 | 3;

interface Cell {
  gx: number;
  gy: number;
  body: string;
  noise: string;
  jx: number; // where it sits in the noise
  jy: number;
}

interface Packet {
  x: number;
  y: number;
  dir: 1 | -1;
  pad: number; // extra cells of padding while disguised
  cells: Cell[];
}

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const role = (c: Cell) =>
  c.gy === 0 ? "dest" : c.gy === 1 && c.gx === 0 ? "source" : c.gy === 2 && c.gx === COLS - 1 ? "account" : "body";

export function start(canvas: HTMLCanvasElement, opts: { reduced: boolean }): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let w = 0;
  let h = 0;
  let packets: Packet[] = [];
  let pointer: { x: number; y: number } | null = null;
  let clock = 0;
  let nextDown = 0;
  let nextUp = 0.9;
  let frame = 0;
  let last = 0;
  let running = false;

  const width = COLS * PITCH - GAP;
  const height = ROWS * PITCH - GAP;
  const top = (l: Layer) => LAYERS[l] * h;
  const layerAt = (y: number): Layer => (y >= top(3) ? 3 : y >= top(2) ? 2 : y >= top(1) ? 1 : 0);

  function packet(dir: 1 | -1): Packet {
    const cells: Cell[] = [];
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        cells.push({ gx, gy, body: pick(BODY), noise: pick(NOISE), jx: rand(-4, 4), jy: rand(-4, 4) });
      }
    }
    // the left edge belongs to the layer names (pages/faq.tsx)
    const lane = dir === 1 ? 0.42 : 0.78;
    return {
      x: w * lane - width / 2 + rand(-6, 6),
      y: dir === 1 ? -height - 4 : h + 4,
      dir,
      pad: Math.floor(rand(0, 7)),
      cells,
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    packets = [];
    clock = 0;
    nextDown = 0;
    nextUp = 0.9;
    for (let i = 0; i < 400; i++) step(1 / 30);
  }

  function step(dt: number) {
    clock += dt;
    if (clock >= nextDown) {
      packets.push(packet(1));
      nextDown = clock + rand(1.4, 2.2);
    }
    if (clock >= nextUp) {
      packets.push(packet(-1));
      nextUp = clock + rand(1.4, 2.2);
    }
    for (const p of packets) p.y += p.dir * SPEED * dt;
    packets = packets.filter((p) => p.y > -height - 10 && p.y < h + 10);
  }

  function colorOf(c: Cell, layer: Layer): string {
    const r = role(c);
    if (layer === 1) return c.noise;
    if (r === "dest") return DEST;
    if (r === "source") return layer === 3 ? NODE : YOU;
    if (r === "account") return layer === 2 ? c.body : ACCOUNT;
    return c.body;
  }

  // which cells the layer under the pointer can read
  function readable(c: Cell, layer: Layer): boolean {
    const r = role(c);
    if (layer === 0) return r !== "body";
    if (layer === 2) return r === "dest" || r === "source";
    if (layer === 3) return r === "source" || r === "account";
    return false;
  }

  function drawLayers(focus: Layer | null) {
    ctx!.lineWidth = 2;
    ctx!.strokeStyle = YOU;
    for (const l of [1, 2, 3] as Layer[]) {
      ctx!.globalAlpha = 0.25;
      ctx!.setLineDash([6, 6]);
      ctx!.beginPath();
      ctx!.moveTo(0, top(l));
      ctx!.lineTo(w, top(l));
      ctx!.stroke();
    }
    ctx!.setLineDash([]);
    if (focus !== null) {
      const y0 = top(focus);
      const y1 = focus === 3 ? h : top((focus + 1) as Layer);
      ctx!.globalAlpha = 0.55;
      ctx!.fillStyle = "#ffffff";
      ctx!.fillRect(0, y0, w, y1 - y0);
    }
    ctx!.globalAlpha = 1;
  }

  function drawPacket(p: Packet, focus: Layer | null) {
    const layer = layerAt(p.y + height / 2);
    const edge = Math.max(0, Math.min(1, (p.y + height) / 30, (h - p.y) / 30));
    // close to a layer line the packet is changing form, so its cells flicker
    const nearLine = [1, 2, 3].some((l) => Math.abs(p.y + height / 2 - top(l as Layer)) < 10);
    const disguised = layer === 1;
    ctx!.globalAlpha = edge;
    for (const c of p.cells) {
      let x = p.x + c.gx * PITCH;
      let y = p.y + c.gy * PITCH;
      if (disguised) {
        x += c.jx;
        y += c.jy;
      }
      if (nearLine) {
        x += rand(-2, 2);
        y += rand(-2, 2);
      }
      ctx!.fillStyle = colorOf(c, layer);
      ctx!.fillRect(x, y, CELL, CELL);
      if (focus === layer && readable(c, layer)) {
        ctx!.strokeStyle = RED;
        ctx!.lineWidth = 2;
        ctx!.strokeRect(x - 2, y - 2, CELL + 4, CELL + 4);
      }
    }
    if (disguised) {
      // padding of no fixed length, so not even the size gives it away; on the inner side of each lane
      const padX = (i: number) => (p.dir === 1 ? p.x + COLS * PITCH + (i % 3) * PITCH : p.x - (1 + (i % 3)) * PITCH);
      for (let i = 0; i < p.pad; i++) {
        ctx!.fillStyle = NOISE[(i * 7 + p.pad) % NOISE.length]!;
        ctx!.fillRect(padX(i), p.y + Math.floor(i / 3) * PITCH, CELL, CELL);
      }
      if (focus === 1) {
        // the provider has nothing to read: the whole thing is one unknown
        ctx!.strokeStyle = RED;
        ctx!.lineWidth = 1.5;
        ctx!.setLineDash([3, 3]);
        const extra = p.pad ? 3 * PITCH : 0;
        ctx!.strokeRect(p.x - 6 - (p.dir === 1 ? 0 : extra), p.y - 6, width + 12 + extra, height + 12);
        ctx!.setLineDash([]);
      }
    }
    ctx!.globalAlpha = 1;
  }

  function draw() {
    ctx!.clearRect(0, 0, w, h);
    const focus = pointer ? layerAt(pointer.y) : null;
    drawLayers(focus);
    for (const p of packets) drawPacket(p, focus);
  }

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt);
    draw();
    frame = requestAnimationFrame(loop);
  }

  function play() {
    if (running || opts.reduced) return;
    running = true;
    last = 0;
    frame = requestAnimationFrame(loop);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(frame);
  }

  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!running) draw();
  };
  const onLeave = () => {
    pointer = null;
    if (!running) draw();
  };
  let visible = true;
  const onVisibility = () => (document.hidden ? pause() : visible && play());
  const io = new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    if (visible && !document.hidden) play();
    else pause();
  });
  const ro = new ResizeObserver(() => {
    resize();
    draw();
  });

  resize();
  draw();
  ro.observe(canvas);
  io.observe(canvas);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  if (!opts.reduced) {
    document.addEventListener("visibilitychange", onVisibility);
    play();
  }

  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
