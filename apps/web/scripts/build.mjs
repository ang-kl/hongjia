// Builds apps/web/dist: the server, the public files, and one browser script that joins the shared
// device profile with the small code that applies it. The result runs with no node_modules.
import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const appRoot = new URL('../', import.meta.url);

export async function build(outDir = new URL('dist/', appRoot)) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(new URL('public/assets/', outDir), { recursive: true });

  for (const file of ['server.mjs', 'headers.mjs']) {
    await copyFile(new URL(`src/${file}`, appRoot), new URL(file, outDir));
  }
  await copyFile(new URL('public/index.html', appRoot), new URL('public/index.html', outDir));
  await copyFile(new URL('public/assets/site.css', appRoot), new URL('public/assets/site.css', outDir));

  const profile = await readFile(new URL(import.meta.resolve('@hongjia/shared/device-profile')), 'utf8');
  const apply = await readFile(new URL('src/client/apply-profile.mjs', appRoot), 'utf8');
  const applyBody = apply.replace(/^import\s.+?;\s*$/gm, '').trimStart();
  if (/^\s*import\s/m.test(applyBody)) throw new Error('apply-profile.mjs may only import the shared device profile.');
  const script = `// Built file. Sources: packages/shared/src/device-profile.mjs and apps/web/src/client/apply-profile.mjs\n${profile}\n${applyBody}`;
  const scriptUrl = new URL('public/assets/site.mjs', outDir);
  await writeFile(scriptUrl, script);
  execFileSync(process.execPath, ['--check', fileURLToPath(scriptUrl)]);
  return outDir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await build();
  console.log(`built ${fileURLToPath(out)}`);
}
