import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KEYS = new Set(['id', 'label', 'kind', 'domains', 'mode', 'detail_pattern', 'selectors', 'query_keys']);
export function validDomain(host) {
  return typeof host === 'string' && host.length <= 253
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
    && /\.[a-z]{2,63}$/.test(host);
}
export function validateManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.sites) || !manifest.sites.length
    || Object.keys(manifest).some(key => !['version', 'sites'].includes(key))) throw new Error('站点清单格式无效');
  const ids = new Set();
  const domains = new Set();
  for (const site of manifest.sites) {
    if (!site || typeof site !== 'object' || Object.keys(site).some(key => !KEYS.has(key))
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.id || '') || ids.has(site.id)
      || !['label', 'kind'].every(key => typeof site[key] === 'string' && site[key].trim())
      || !['automatic', 'selection'].includes(site.mode)
      || !Array.isArray(site.domains) || !site.domains.length) throw new Error('站点条目无效');
    ids.add(site.id);
    for (const domain of site.domains) {
      if (!validDomain(domain) || domains.has(domain)) throw new Error(`域名无效或重复：${domain}`);
      domains.add(domain);
    }
    for (const key of ['selectors', 'query_keys']) {
      if (site[key] !== undefined && (!Array.isArray(site[key]) || !site[key].length
        || !site[key].every(value => typeof value === 'string' && value.trim())
        || new Set(site[key]).size !== site[key].length)) throw new Error(`${site.id} 的 ${key} 无效`);
    }
    if (site.query_keys?.some(key => !/^[A-Za-z0-9_-]+$/.test(key))) throw new Error('作品参数无效');
    if (site.detail_pattern !== undefined) {
      if (typeof site.detail_pattern !== 'string' || !site.detail_pattern.startsWith('^')) throw new Error('详情路径无效');
      new RegExp(site.detail_pattern, 'i');
    }
    if (site.mode === 'automatic' && (!site.detail_pattern || !site.selectors?.length)) throw new Error('自动识别需要详情路径和字段');
  }
  return manifest;
}

function replaceOnce(source, marker, value) {
  if (source.split(marker).length !== 2) throw new Error(`模板标记必须唯一：${marker}`);
  return source.replace(marker, () => value);
}

export function render(template, manifest, version) {
  validateManifest(manifest);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本无效');
  if (template.match(/^\/\/ @version\s+(.+)$/m)?.[1].trim() !== version) throw new Error('模板和 package.json 版本不一致');
  const matches = manifest.sites.flatMap(site => site.domains.flatMap(domain =>
    [`// @match        https://${domain}/*`, `// @match        https://*.${domain}/*`])).join('\n');
  let result = replaceOnce(template.replace(/\r\n/g, '\n'), '// __PEACH_JAV_MATCHES__', matches);
  result = replaceOnce(result, '__PEACH_JAV_SITES__', JSON.stringify(manifest));
  if (/__PEACH_JAV_/.test(result)) throw new Error('构建产物含未展开的标记');
  return result.trimEnd() + '\n';
}

export async function outputs(root = ROOT) {
  const [template, manifest, pkg] = await Promise.all([
    readFile(resolve(root, 'src/peach-jav.user.js'), 'utf8'),
    readFile(resolve(root, 'jav-sites.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  const script = render(template, manifest, pkg.version);
  const snapshot = JSON.stringify(manifest, null, 2) + '\n';
  const sha = value => createHash('sha256').update(value).digest('hex');
  const release = JSON.stringify({ version: pkg.version, site_schema_version: manifest.version,
    repository: 'https://github.com/peach-mitao/peach-userscript',
    files: { 'peach-jav.user.js': sha(script), 'jav-sites.json': sha(snapshot) } }, null, 2) + '\n';
  return new Map([
    ['peach-jav.user.js', script],
    ['jav-sites.json', snapshot],
    ['release.json', release],
    ['SHA256SUMS', `${sha(script)}  peach-jav.user.js\n${sha(snapshot)}  jav-sites.json\n${sha(release)}  release.json\n`],
  ]);
}

export async function build({ check = false, root = ROOT } = {}) {
  for (const [name, value] of await outputs(root)) {
    const path = resolve(root, 'dist', name);
    if (check) {
      if (await readFile(path, 'utf8') !== value) throw new Error(`产物需要重新构建：dist/${name}`);
    } else {
      await mkdir(resolve(root, 'dist'), { recursive: true });
      await writeFile(path, value, 'utf8');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('用法：node scripts/build.mjs [--check]');
  await build({ check: args.includes('--check') });
  console.log(args.includes('--check') ? '构建产物一致' : '构建完成：dist/peach-jav.user.js');
}
