/** Per-destination gradient (we have no licensed photography yet, so no stock images). */
const PALETTES = [
  ["#0E5E52", "#57B8A3"], ["#C6522E", "#EFA23F"], ["#08423A", "#147A6B"], ["#6B4E16", "#EFA23F"],
  ["#147A6B", "#CFE6E0"], ["#16211E", "#2E9B87"], ["#E8663D", "#F7EBD3"],
];

export function gradientFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[hash % PALETTES.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
