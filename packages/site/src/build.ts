import { fileURLToPath } from 'node:url';
import { buildSite } from './site.js';

const outDir = fileURLToPath(new URL('../dist/site', import.meta.url));
await buildSite(outDir);
console.log(`site written to ${outDir}`);
