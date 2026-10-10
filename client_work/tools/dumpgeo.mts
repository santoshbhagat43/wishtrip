import { writeFileSync } from 'node:fs';
const g = await import(process.argv[2]);
const out: any = {};
for (const [k, v] of Object.entries(g)) if (typeof v === 'object') out[k] = v;
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]: any) => `${k}:${Object.keys(v).length}`).join(' '));
