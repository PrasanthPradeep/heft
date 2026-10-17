import { segmentCells, readCell, decodeSevenSegment } from '../segments';
import { connectedComponents } from '../pixels';

const SHAPES: Record<string, [number, number, number, number]> = {
  A: [0.06, 0.02, 0.94, 0.14],
  G: [0.06, 0.45, 0.94, 0.55],
  D: [0.06, 0.86, 0.94, 0.98],
  F: [0.03, 0.08, 0.22, 0.47],
  B: [0.78, 0.08, 0.97, 0.47],
  E: [0.03, 0.53, 0.22, 0.92],
  C: [0.78, 0.53, 0.97, 0.92],
};
const DIG: Record<string, string[]> = {
  '0': ['A','B','C','D','E','F'], '1': ['B','C'], '2': ['A','B','D','E','G'],
  '5': ['A','C','D','F','G'], '7': ['A','B','C'], '8': ['A','B','C','D','E','F','G'],
};

function render(text: string, gap = 0) {
  const dw = 44, dh = 88, sp = 14, pad = 30;
  const slots = [...text].filter((c) => c !== '.').length;
  const hasD = text.includes('.');
  const dwDec = hasD ? 18 : 0;
  const w = pad * 2 + slots * dw + (slots - 1) * sp + dwDec;
  const h = pad * 2 + dh;
  const data = new Uint8Array(w * h);
  const paint = (x: number, y: number, ww: number, hh: number) => {
    for (let r = Math.max(0, Math.round(y)); r < Math.min(h, Math.round(y + hh)); r++)
      for (let c = Math.max(0, Math.round(x)); c < Math.min(w, Math.round(x + ww)); c++)
        data[r * w + c] = 1;
  };
  let cur = pad; let pending = false;
  for (const ch of text) {
    if (ch === '.') { pending = true; continue; }
    if (pending) {
      paint(cur, pad + 0.86 * dh, 0.22 * dw, 0.12 * dh);
      cur += dwDec; pending = false;
    }
    for (const s of DIG[ch] ?? []) {
      const [x0, y0, x1, y1] = SHAPES[s];
      paint(cur + x0 * dw + gap, pad + y0 * dh + gap, (x1 - x0) * dw - 2 * gap, (y1 - y0) * dh - 2 * gap);
    }
    cur += dw + sp;
  }
  return { data, width: w, height: h };
}

it('debug', () => {
  for (const text of ['0', '1', '8.8', '60.65', '55.2']) {
    const image = render(text);
    const comps = connectedComponents(image);
    const { cells, decimals } = segmentCells(comps);
    console.log(`\n### "${text}" comps=${comps.length} cells=${cells.length} decimals=${decimals.length}`);
    for (const c of comps) console.log(`   comp ${c.x},${c.y} ${c.width}x${c.height} a=${c.area}`);
    console.log(`   CELLS: ${JSON.stringify(cells)}`);
    console.log(`   DECS:  ${JSON.stringify(decimals)}`);
    if (cells.length) {
      const reading = decodeSevenSegment(image, comps);
      console.log(`   -> text='${reading.text}' conf=${reading.confidence.toFixed(2)} cells=${reading.cells.length}`);
      for (const cell of reading.cells)
        console.log(`      bits=${cell.bits.toString(2).padStart(7,'0')} d=${cell.distance} digit=${cell.digit} fills=${cell.fills.map((f) => f.toFixed(2)).join(',')}`);
    }
  }
});
