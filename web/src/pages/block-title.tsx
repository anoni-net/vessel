// The home page's title, Vessel, stacked from blocks like the pictures under it: a 7-row bitmap font, each dot a
// block seen from the front with its top and right side drawn in perspective. The <h1> keeps the word as text for
// search engines and screen readers; the drawing is decoration. Rows build up from the bottom once, on load
// (styles.css, .block-title__r1–r7). Then a little pixel person carrying a cobalt packet hops across the letters,
// presses the packet into the l, and the word fills with cobalt from the bottom row up, like a vessel filling. The
// person stays on the l, blinking now and then; a tap on the title makes it jump. With prefers-reduced-motion the
// word is filled from the start and the person simply stands on the l.
import { useRef } from "preact/hooks";

const GLYPHS: Record<string, string[]> = {
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  l: ["110", "010", "010", "010", "010", "010", "111"],
};
const WORD = "Vessel";
const S = 10; // a block's front, in drawing units
const DX = 4.5; // how far the depth goes right
const DY = 3.5; // and up

interface Block { col: number; row: number; top: boolean; side: boolean }

// every dot of the word, with whether its top and right side show (no block above, no block to the right)
const grid: boolean[][] = Array.from({ length: 7 }, () => []);
let at = 0;
for (const ch of WORD) {
  const g = GLYPHS[ch];
  g.forEach((line, row) => [...line].forEach((bit, i) => { grid[row][at + i] = bit === "1"; }));
  at += g[0].length + 1;
}
const COLS = at - 1;
const BLOCKS: Block[] = [];
// back to front: top rows first, and right to left, so a block's front covers the depth of the ones behind it
for (let row = 0; row < 7; row++) {
  for (let col = COLS - 1; col >= 0; col--) {
    if (!grid[row][col]) continue;
    BLOCKS.push({ col, row, top: !grid[row - 1]?.[col], side: !grid[row][col + 1] });
  }
}
const W = COLS * S + DX;
const H = 7 * S + DY;

const pts = (...p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");

// the pixel person, 6 by 10 dots of 2 units, facing right; its feet at 0, 0. "#" ink, "o" the eye
const DOT = 2;
const BODY = [".####.", ".##o#.", ".####.", "..##..", ".#####", "..##..", "..##.."];
const LEGS = {
  stand: ["..##..", ".#..#.", ".#..#."],
  a: ["..##..", ".#..#.", "#....#"],
  b: ["..##..", "..##..", "..##.."],
};
function Dots({ rows, from }: { rows: string[]; from: number }) {
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    // a run of ink in a row is one rect
    const line = rows[r];
    for (let c = 0; c < line.length; c++) {
      if (line[c] === ".") continue;
      if (line[c] === "o") {
        out.push(<rect class="pixel-person__eye" x={(c - 3) * DOT} y={(from + r - 10) * DOT} width={DOT} height={DOT} />);
        continue;
      }
      let end = c;
      while (line[end + 1] === "#") end++;
      out.push(<rect x={(c - 3) * DOT} y={(from + r - 10) * DOT} width={(end - c + 1) * DOT} height={DOT} />);
      c = end;
    }
  }
  return <>{out}</>;
}

function PixelPerson() {
  return (
    <g class="pixel-person">
      <g class="pixel-person__jump">
        <g class="pixel-person__ink"><Dots rows={BODY} from={0} /></g>
        <g class="pixel-person__legs pixel-person__legs--a pixel-person__ink"><Dots rows={LEGS.a} from={7} /></g>
        <g class="pixel-person__legs pixel-person__legs--b pixel-person__ink"><Dots rows={LEGS.b} from={7} /></g>
        <g class="pixel-person__legs pixel-person__legs--stand pixel-person__ink"><Dots rows={LEGS.stand} from={7} /></g>
        {/* the packet it carries, a small block in the colour the word fills with */}
        <g class="pixel-person__packet">
          <polygon class="pixel-person__packet-top" points="5,-14 7,-15.5 13,-15.5 11,-14" />
          <polygon class="pixel-person__packet-side" points="11,-14 13,-15.5 13,-9.5 11,-8" />
          <rect class="pixel-person__packet-front" x="5" y="-14" width="6" height="6" />
        </g>
      </g>
    </g>
  );
}

/** `plain`: just the blocks, as outlines, standing still; for the footer's title block. */
export function BlockTitle({ plain = false }: { plain?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  // a tap: the person jumps; restarting the class restarts the animation
  const jump = () => {
    const el = svg.current?.querySelector(".pixel-person__jump");
    if (!el) return;
    el.classList.remove("pixel-person__jump--on");
    void (el as SVGGElement).getBBox();
    el.classList.add("pixel-person__jump--on");
  };
  return (
    <svg ref={svg} class={`block-title${plain ? " block-title--plain" : ""}`} viewBox={plain ? `-1 -1 ${W + 2} ${H + 2}` : `-1 -22 ${W + 2} ${H + 23}`}
      aria-hidden="true" onClick={plain ? undefined : jump}>
      {BLOCKS.map(({ col, row, top, side }) => {
        const x = col * S;
        const y = DY + row * S;
        return (
          <g class={`block-title__row block-title__r${7 - row}`}>
            {top && <polygon class="block-title__top" points={pts([x, y], [x + DX, y - DY], [x + S + DX, y - DY], [x + S, y])} />}
            {side && <polygon class="block-title__side" points={pts([x + S, y], [x + S + DX, y - DY], [x + S + DX, y + S - DY], [x + S, y + S])} />}
            <rect class="block-title__front" x={x} y={y} width={S} height={S} />
          </g>
        );
      })}
      {!plain && <PixelPerson />}
    </svg>
  );
}
