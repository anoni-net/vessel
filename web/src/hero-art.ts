// The home page's moving picture of how Vessel hides a VPN connection. WireGuard already encrypts what a
// packet carries, so every packet's body here is noise; what gives WireGuard away is its outline.
//
//   top lane: plain WireGuard. Every packet has the same size, the same header and the same spacing, so
//     the checkpoint in the middle (deep packet inspection) recognizes it and it is dropped.
//   bottom lane: Vessel (AmneziaWG). Each round starts with decoy packets of random sizes (Jc, Jmin, Jmax)
//     that the server throws away, then a first packet dressed as other traffic (the QUIC-shaped I1),
//     then data packets whose size and header differ every time. Nothing stays the same, and they pass.
//
// A Vessel packet shakes as it crosses the checkpoint, inspected but with nothing to recognize, and goes on.
//
// The pointer is a lens showing what an observer sees: the fixed header of a WireGuard packet stands out,
// a Vessel packet has nothing steady to hold on to.
//
// On touch screens there is no hovering, so a tap shows the lens for a moment instead; dragging stays free
// for scrolling the page. Plain Canvas 2D, no dependencies, loaded after the page is up (pages/home.tsx).

const INK = "#13232a";
const HEADER = "#7c5cf0";
const RED = "#b3261e";
// bodies are encrypted, so any shade; headers are what an observer reads
const BODY = ["#13232a", "#2c3b42", "#52646b", "#7d8b91"];
const HEADERS = ["#7c5cf0", "#a78bfa", "#13232a", "#52646b", "#c4b5fd"];
const DECOY = ["#c4b5fd", "#d8ccfe", "#b9a6fb"];

const CELL = 7; // px, before devicePixelRatio
const GAP = 3;
const PITCH = CELL + GAP;
const FADE = 50; // fade in and out over this much of each edge
const LENS = 70;
const SCAN = 24; // a Vessel packet shakes this close to the checkpoint: inspected, nothing to recognize
const LANE_SPEED = 60; // Vessel packets in a round share a speed, so they do not run into each other

type Kind = "plain" | "data" | "decoy" | "lead";

interface Cell {
  gx: number;
  gy: number;
  color: string;
  header: boolean;
  // once caught: where the cell flies, outward from the packet's centre
  ox: number;
  oy: number;
  seed: number;
}

interface Block {
  kind: Kind;
  x: number;
  y: number;
  cols: number;
  rows: number;
  speed: number;
  cells: Cell[];
  caught: number; // seconds since the checkpoint caught it, -1 if not
}

interface Dust {
  x: number;
  y: number;
  vx: number;
  size: number;
}

const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

export function start(canvas: HTMLCanvasElement, opts: { reduced: boolean }): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let w = 0;
  let h = 0;
  let blocks: Block[] = [];
  let dust: Dust[] = [];
  let pointer: { x: number; y: number } | null = null;
  let clock = 0;
  let nextPlain = 0;
  let queue: Array<{ at: number; kind: Kind; size?: [number, number] }> = [];
  let nextRound = 0;
  let frame = 0;
  let last = 0;
  let running = false;

  const plainY = () => h * 0.3;
  const vesselY = () => h * 0.7;
  const checkpoint = () => w * 0.52;

  function block(kind: Kind, x: number, size?: [number, number]): Block {
    let cols: number, rows: number, speed: number, y: number;
    if (kind === "plain") {
      [cols, rows, speed, y] = [6, 4, 62, plainY()];
    } else if (kind === "decoy") {
      [cols, rows, speed, y] = [randInt(1, 4), randInt(1, 3), rand(70, 95), vesselY() + rand(-34, 34)];
    } else if (kind === "lead") {
      [cols, rows, speed, y] = [7, 3, LANE_SPEED, vesselY() + rand(-10, 10)];
    } else {
      [cols, rows, speed, y] = [size?.[0] ?? 6, size?.[1] ?? 4, LANE_SPEED, vesselY() + rand(-22, 22)];
    }
    const header = kind === "plain" ? HEADER : pick(HEADERS);
    const cells: Cell[] = [];
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const isHeader = gy === 0 && (kind === "plain" || kind === "data");
        cells.push({
          gx, gy, header: isHeader, ox: 0, oy: 0, seed: Math.random() * 1000,
          // the plain header is the same every time; a Vessel header is a different color each packet
          color: kind === "decoy" ? pick(DECOY) : isHeader ? header : pick(BODY),
        });
      }
    }
    return { kind, x, y: y - (rows * PITCH) / 2, cols, rows, speed, cells, caught: -1 };
  }

  function planRound() {
    // decoys first, then the disguised first packet, then the data, at uneven gaps
    let at = clock;
    for (let i = randInt(1, 3); i > 0; i--) queue.push({ at: (at += rand(0.12, 0.35)), kind: "decoy" });
    queue.push({ at: (at += rand(0.25, 0.45)), kind: "lead" });
    // each packet leaves once the one before it is clear, plus an uneven pause
    let before = 7 * PITCH;
    for (let i = randInt(2, 4); i > 0; i--) {
      const size: [number, number] = [randInt(3, 9), randInt(2, 5)];
      queue.push({ at: (at += before / LANE_SPEED + rand(0.15, 0.6)), kind: "data", size });
      before = size[0] * PITCH;
    }
    nextRound = at + before / LANE_SPEED + rand(1.0, 2.0);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    blocks = [];
    queue = [];
    clock = 0;
    nextPlain = 0;
    nextRound = 0;
    dust = Array.from({ length: Math.round((w * h) / 3200) }, () => ({
      x: Math.random() * w, y: Math.random() * h, vx: rand(5, 16), size: rand(1.2, 2.6),
    }));
    // start mid-stream, so the first frame already tells the story
    for (let i = 0; i < 300; i++) step(1 / 30);
  }

  function step(dt: number) {
    clock += dt;
    if (clock >= nextPlain) {
      blocks.push(block("plain", -6 * PITCH));
      nextPlain = clock + 1.7; // like clockwork
    }
    if (clock >= nextRound) planRound();
    queue = queue.filter((q) => {
      if (q.at > clock) return true;
      blocks.push(block(q.kind, -10 * PITCH, q.size));
      return false;
    });
    const cp = checkpoint();
    for (const b of blocks) {
      if (b.caught >= 0) {
        b.caught += dt;
        continue;
      }
      b.x += b.speed * dt;
      // the checkpoint knows WireGuard by its fixed size and header
      if (b.kind === "plain" && b.x + b.cols * PITCH >= cp) {
        b.caught = 0;
        // it bursts where it stands: each cell heads away from the centre, a little at random
        const cx = ((b.cols - 1) * PITCH) / 2;
        const cy = ((b.rows - 1) * PITCH) / 2;
        for (const c of b.cells) {
          const dx = c.gx * PITCH - cx + rand(-4, 4);
          const dy = c.gy * PITCH - cy + rand(-4, 4);
          const len = Math.hypot(dx, dy) || 1;
          const reach = rand(18, 42);
          c.ox = (dx / len) * reach;
          c.oy = (dy / len) * reach;
        }
      }
    }
    blocks = blocks.filter((b) => (b.caught < 0 ? b.x < w + 20 : b.caught < 1.1));
    for (const d of dust) {
      d.x += d.vx * dt;
      if (d.x > w + 4) d.x = -4;
    }
  }

  const edge = (x: number) => Math.max(0, Math.min(1, x / FADE, (w - x) / FADE));

  function drawCheckpoint() {
    const cp = checkpoint();
    ctx!.strokeStyle = INK;
    ctx!.globalAlpha = 0.35;
    ctx!.lineWidth = 2;
    ctx!.setLineDash([6, 6]);
    ctx!.beginPath();
    ctx!.moveTo(cp, h * 0.08);
    ctx!.lineTo(cp, h * 0.92);
    ctx!.stroke();
    ctx!.setLineDash([]);
    // a scan dot running up and down the line
    const sy = h * 0.08 + ((Math.sin(clock * 1.6) + 1) / 2) * h * 0.84;
    ctx!.globalAlpha = 0.9;
    ctx!.fillStyle = HEADER;
    ctx!.fillRect(cp - 4, sy - 4, 8, 8);
    // where each lane ends up: dropped at the checkpoint, through to the far side
    ctx!.lineWidth = 3;
    ctx!.globalAlpha = 0.55;
    ctx!.strokeStyle = RED;
    const x0 = cp + 18;
    const y0 = plainY();
    ctx!.beginPath();
    ctx!.moveTo(x0 - 7, y0 - 7);
    ctx!.lineTo(x0 + 7, y0 + 7);
    ctx!.moveTo(x0 + 7, y0 - 7);
    ctx!.lineTo(x0 - 7, y0 + 7);
    ctx!.stroke();
    ctx!.globalAlpha = 1;
  }

  function drawBlock(b: Block, lensOn: boolean) {
    const decoyFade = b.kind === "decoy" ? 1 - Math.min(1, Math.max(0, (b.x - w * 0.72) / (w * 0.12))) : 1;
    const caughtFade = b.caught >= 0 ? Math.max(0, 1 - b.caught / 1.1) : 1;
    // ease out: fast at first, settling as it fades
    const burst = b.caught >= 0 ? 1 - (1 - Math.min(1, b.caught / 1.1)) ** 3 : 0;
    for (const c of b.cells) {
      let x = b.x + c.gx * PITCH + c.ox * burst;
      let y = b.y + c.gy * PITCH + c.oy * burst;
      const inLens = lensOn && pointer && Math.hypot(x - pointer.x, y - pointer.y) < LENS;
      if (b.kind !== "plain") {
        const near = 1 - Math.abs(x + CELL / 2 - checkpoint()) / SCAN;
        if (near > 0) {
          x += rand(-3.5, 3.5) * near;
          y += rand(-3.5, 3.5) * near;
        }
      }
      if (inLens && b.kind !== "plain") {
        // under the lens a Vessel packet has nothing steady to read
        x += rand(-3, 3);
        y += rand(-3, 3);
      }
      ctx!.globalAlpha = edge(x) * decoyFade * caughtFade;
      if (b.kind === "lead") {
        ctx!.strokeStyle = INK;
        ctx!.lineWidth = 1.5;
        ctx!.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5);
        continue;
      }
      ctx!.fillStyle = b.caught >= 0 ? RED : c.color;
      const size = CELL * (1 - burst * 0.6);
      ctx!.fillRect(x + (CELL - size) / 2, y + (CELL - size) / 2, size, size);
      if (inLens && b.kind === "plain" && c.header) {
        // the observer spots WireGuard's fixed header
        ctx!.strokeStyle = RED;
        ctx!.lineWidth = 2;
        ctx!.strokeRect(x - 2, y - 2, CELL + 4, CELL + 4);
      }
    }
  }

  function draw() {
    ctx!.clearRect(0, 0, w, h);
    ctx!.fillStyle = INK;
    for (const d of dust) {
      ctx!.globalAlpha = 0.14 * edge(d.x);
      ctx!.fillRect(d.x, d.y, d.size, d.size);
    }
    drawCheckpoint();
    for (const b of blocks) drawBlock(b, true);
    if (pointer) {
      ctx!.globalAlpha = 0.45;
      ctx!.strokeStyle = INK;
      ctx!.lineWidth = 2;
      ctx!.setLineDash([4, 5]);
      ctx!.beginPath();
      ctx!.arc(pointer.x, pointer.y, LENS, 0, Math.PI * 2);
      ctx!.stroke();
      ctx!.setLineDash([]);
    }
    ctx!.globalAlpha = 1;
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

  const at = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    pointer = at(e);
    if (!running) draw();
  };
  let tapTimer = 0;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    pointer = at(e);
    window.clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => (pointer = null), 1500);
  };
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
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
  if (!opts.reduced) {
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    play();
  }

  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    window.clearTimeout(tapTimer);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
