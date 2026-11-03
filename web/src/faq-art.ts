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
// The pointer marks what the layer under it can read. Drawn like the home page's other pictures: the layers are thin
// plates seen from above at a slant, with an opening for each lane, and every cell of a packet is a small block.
// Plain Canvas 2D, loaded after the page is up, only where there is room beside the questions (pages/faq.tsx).

// the blueprint's cobalt in a few shades (styles.css, .faq-art__swatch); orange for the account, red for the lens
const DEST = "#2f6bff";
const YOU = "#0b3ca8";
const NODE = "#a5bcf2";
const ACCOUNT = "#e08a00";
const BODY = ["#a9b7d6", "#c3cde6", "#93a3c9"];
const NOISE = ["#0b3ca8", "#4a62a3", "#7d90c4", "#a9b7d6", "#6f95f5", "#a5bcf2"];
const RED = "#b3261e"; // the lens marks what a layer can read
const PLATE = "rgba(214, 226, 251, 0.6)";
// a block's depth, up and to the right like the title's (pages/block-title.tsx), and a plate's
const DX = 2.6;
const DY = 2;
const PLATE_DX = 32;
const PLATE_DY = 14;
const PLATE_T = 7; // how thick a plate is

// a colour lighter (k > 0) or darker (k < 0), for a block's top and side
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${ch.join(",")})`;
}

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

  // a parallelogram on a plate at y: from x0 to x1 along the front, PLATE_DX by PLATE_DY deep
  function slab(x0: number, x1: number, y: number) {
    ctx!.beginPath();
    ctx!.moveTo(x0, y);
    ctx!.lineTo(x1, y);
    ctx!.lineTo(x1 + PLATE_DX, y - PLATE_DY);
    ctx!.lineTo(x0 + PLATE_DX, y - PLATE_DY);
    ctx!.closePath();
  }

  function drawLayers(focus: Layer | null) {
    if (focus !== null) {
      const y0 = top(focus);
      const y1 = focus === 3 ? h : top((focus + 1) as Layer);
      ctx!.globalAlpha = 0.5;
      ctx!.fillStyle = "#ffffff";
      ctx!.fillRect(0, y0, w, y1 - y0);
      ctx!.globalAlpha = 1;
    }
    const hole = width + 22;
    for (const l of [1, 2, 3] as Layer[]) {
      const y = top(l);
      const x1 = w - PLATE_DX - 2;
      // the plate, its front edge, and an opening where each lane goes through
      // the top, the front edge and the right end, so the plate has a thickness
      ctx!.fillStyle = PLATE;
      slab(0, x1, y);
      ctx!.fill();
      ctx!.fillStyle = "rgba(11, 60, 168, 0.22)";
      ctx!.fillRect(0, y, x1, PLATE_T);
      ctx!.fillStyle = "rgba(11, 60, 168, 0.32)";
      ctx!.beginPath();
      ctx!.moveTo(x1, y);
      ctx!.lineTo(x1 + PLATE_DX, y - PLATE_DY);
      ctx!.lineTo(x1 + PLATE_DX, y - PLATE_DY + PLATE_T);
      ctx!.lineTo(x1, y + PLATE_T);
      ctx!.closePath();
      ctx!.fill();
      ctx!.globalCompositeOperation = "destination-out";
      for (const lane of [0.42, 0.78]) {
        const cx = w * lane;
        slab(cx - hole / 2 - PLATE_DX / 2, cx + hole / 2 - PLATE_DX / 2, y - 2);
        ctx!.fill();
        ctx!.fillRect(cx - hole / 2 - PLATE_DX / 2, y - 2, hole, PLATE_T + 3);
      }
      ctx!.globalCompositeOperation = "source-over";
      ctx!.lineWidth = 1.2;
      ctx!.strokeStyle = YOU;
      ctx!.globalAlpha = 0.7;
      slab(0, x1, y);
      ctx!.stroke();
      ctx!.strokeRect(0, y, x1, PLATE_T);
      for (const lane of [0.42, 0.78]) {
        const cx = w * lane;
        // the opening, and the far wall of its cut through the plate
        slab(cx - hole / 2 - PLATE_DX / 2, cx + hole / 2 - PLATE_DX / 2, y - 2);
        ctx!.stroke();
        ctx!.fillStyle = "rgba(11, 60, 168, 0.18)";
        ctx!.beginPath();
        ctx!.moveTo(cx - hole / 2 + PLATE_DX / 2, y - 2 - PLATE_DY);
        ctx!.lineTo(cx + hole / 2 + PLATE_DX / 2, y - 2 - PLATE_DY);
        ctx!.lineTo(cx + hole / 2 + PLATE_DX / 2, y - 2 - PLATE_DY + PLATE_T);
        ctx!.lineTo(cx - hole / 2 + PLATE_DX / 2, y - 2 - PLATE_DY + PLATE_T);
        ctx!.closePath();
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }
  }

  // a cell as a block: its front in the cell's colour, the top lighter and the right side darker
  function block(x: number, y: number, color: string) {
    ctx!.fillStyle = shade(color, 0.35);
    ctx!.beginPath();
    ctx!.moveTo(x, y);
    ctx!.lineTo(x + DX, y - DY);
    ctx!.lineTo(x + CELL + DX, y - DY);
    ctx!.lineTo(x + CELL, y);
    ctx!.closePath();
    ctx!.fill();
    ctx!.fillStyle = shade(color, -0.35);
    ctx!.beginPath();
    ctx!.moveTo(x + CELL, y);
    ctx!.lineTo(x + CELL + DX, y - DY);
    ctx!.lineTo(x + CELL + DX, y + CELL - DY);
    ctx!.lineTo(x + CELL, y + CELL);
    ctx!.closePath();
    ctx!.fill();
    ctx!.fillStyle = color;
    ctx!.fillRect(x, y, CELL, CELL);
  }

  function drawPacket(p: Packet, focus: Layer | null) {
    const layer = layerAt(p.y + height / 2);
    const edge = Math.max(0, Math.min(1, (p.y + height) / 30, (h - p.y) / 30));
    // close to a layer line the packet is changing form, so its cells flicker
    const nearLine = [1, 2, 3].some((l) => Math.abs(p.y + height / 2 - top(l as Layer)) < 10);
    const disguised = layer === 1;
    ctx!.globalAlpha = edge;
    // back to front: top rows first, right to left, so each block's front covers the depth of the ones behind it
    const cells = [...p.cells].sort((a, b) => a.gy - b.gy || b.gx - a.gx);
    for (const c of cells) {
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
      block(x, y, colorOf(c, layer));
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
        block(padX(i), p.y + Math.floor(i / 3) * PITCH, NOISE[(i * 7 + p.pad) % NOISE.length]!);
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
