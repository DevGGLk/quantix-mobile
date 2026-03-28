import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'types', 'database.types.ts');

const banner = `/**
 * Generado con \`npm run gen:types\` (Supabase CLI y proyecto vinculado: \`supabase link\`).
 * Sin link: \`npx supabase gen types typescript --project-id <ref> > types/database.types.ts\`
 * Regenerar tras migraciones; no ampliar el esquema solo en este archivo.
 */

`;

try {
  const stdout = execSync('npx supabase gen types typescript --linked', {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  writeFileSync(outPath, banner + stdout, 'utf8');
  console.error('OK:', outPath);
} catch (e) {
  const stderr = e.stderr?.toString?.() ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  console.error('gen:types falló:', msg);
  if (stderr) console.error(stderr);
  process.exit(1);
}
