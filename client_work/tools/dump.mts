import { writeFileSync } from 'node:fs';
const mod = await import(process.argv[2]);
const all = mod.ALL_DESTINATIONS ?? mod.CATALOGUE_ALL ?? mod.default ?? Object.values(mod).find((v: any) => Array.isArray(v));
writeFileSync(process.argv[3], JSON.stringify(all, null, 1));
console.log(Object.keys(mod), all.length);
