import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, validateManifest, validDomain } from './build.mjs';

const MAX_BYTES = 2_000_000;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHosts = new Set(['sleazyfork.org', 'www.sleazyfork.org', 'update.sleazyfork.org']);

export function confined(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('文件路径必须相对仓库根目录');
  const result = resolve(root, path);
  const rel = relative(root, result);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('文件路径超出仓库目录');
  return result;
}

export function validateSources(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.sources) || registry.sources.length > 50) throw new Error('候选来源清单无效');
  const ids = new Set();
  for (const source of registry.sources) {
    let url, evidence;
    try { url = new URL(source.url); evidence = new URL(source.evidence_url); } catch { throw new Error('候选来源 URL 无效'); }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id || '') || ids.has(source.id)
      || !/^[a-f0-9]{64}$/.test(source.sha256 || '') || typeof source.path !== 'string'
      || !(source.format === 'metadata' ? source.path.startsWith('docs/evidence/sleazy-metadata/')
        && /^[a-f0-9]{64}$/.test(source.metadata_sha256 || '') : source.format === undefined && source.path.startsWith('evidence/'))
      || url.protocol !== 'https:' || !sourceHosts.has(url.hostname)
      || url.username || url.password || url.search || url.hash || url.port
      || evidence.protocol !== 'https:' || !sourceHosts.has(evidence.hostname) || evidence.port
      || evidence.username || evidence.password || evidence.search || evidence.hash) {
      throw new Error('来源须包含唯一 ID、固定 SHA256、evidence/ 路径和公开 Sleazy URL');
    }
    ids.add(source.id);
  }
  return registry;
}

export function extractDomains(script) {
  const metadata = /^\s*\/\/ ==UserScript==\r?\n([\s\S]*?)^\/\/ ==\/UserScript==/m.exec(script)?.[1];
  if (!metadata || metadata.length > 100_000) throw new Error('未取得有效用户脚本元数据');
  const domains = new Map();
  const skipped = [];
  for (const line of metadata.split(/\r?\n/)) {
    const directive = /^\/\/\s+@(match|include|connect)\s+(.+?)\s*$/.exec(line);
    if (!directive) continue;
    const pattern = directive[2];
    const host = directive[1] === 'connect' ? pattern
      : /^(?:https?|\*):\/\/(?:\*\.)?([^/:?#*]+)\/[^\s]*$/.exec(pattern)?.[1];
    if (!validDomain(host)) { skipped.push(pattern); continue; }
    const patterns = domains.get(host) || new Set();
    patterns.add(directive[1] === 'connect' ? `@connect ${pattern}` : pattern);
    domains.set(host, patterns);
  }
  return { domains, skipped: [...new Set(skipped)].sort() };
}

export function report(manifest, registry, snapshots) {
  validateManifest(manifest);
  validateSources(registry);
  const known = manifest.sites.flatMap(site => site.domains.map(domain => ({ domain, site: site.id })));
  const candidates = [];
  const sources = [];
  for (const source of [...registry.sources].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const bytes = snapshots.get(source.id);
    if (!bytes || bytes.byteLength > MAX_BYTES || sha256(bytes) !== (source.format === 'metadata' ? source.metadata_sha256 : source.sha256)) throw new Error(`快照 hash 或大小不符：${source.id}`);
    let script = Buffer.from(bytes).toString('utf8');
    if (source.format === 'metadata') {
      const metadata = JSON.parse(script);
      if (metadata.source_sha256 !== source.sha256 || !Array.isArray(metadata.declarations)
        || !metadata.declarations.every(item => Array.isArray(item) && item.length === 2
          && ['match', 'include', 'connect'].includes(item[0]) && typeof item[1] === 'string'
          && !/[\r\n]/.test(item[1]))) throw new Error('元数据快照无效');
      script = `// ==UserScript==\n${metadata.declarations.map(([key, value]) => `// @${key} ${value}`).join('\n')}\n// ==/UserScript==`;
    }
    const parsed = extractDomains(script);
    sources.push({ id: source.id, url: source.url, evidence_url: source.evidence_url,
      sha256: source.sha256, snapshot_format: source.format || 'userscript',
      ...(source.metadata_sha256 ? { metadata_sha256: source.metadata_sha256 } : {}), skipped_patterns: parsed.skipped });
    for (const [domain, patterns] of parsed.domains) {
      const match = known.find(item => domain === item.domain || domain.endsWith(`.${item.domain}`));
      candidates.push({ domain, source_id: source.id, source_url: source.url, source_sha256: source.sha256,
        patterns: [...patterns].sort(), registered_site: match?.site || null,
        status: 'candidate', review: 'required', confidence: 'unverified' });
    }
  }
  candidates.sort((a, b) => a.domain.localeCompare(b.domain, 'en') || a.source_id.localeCompare(b.source_id, 'en'));
  return { version: 1, sources, candidates };
}

async function download(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'text/plain', 'User-Agent': 'peach-userscript-candidate-review/0.3.0' } });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error('来源超过 2 MB');
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks);
}

export async function sync({ root = ROOT, fetchMissing = false, output = 'candidates/mirrors.json' } = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'jav-sites.json'), 'utf8'));
  const registry = validateSources(JSON.parse(await readFile(resolve(root, 'mirror-sources.json'), 'utf8')));
  if (!output.startsWith('candidates/')) throw new Error('输出必须放在 candidates/');
  const outputPath = confined(root, output);
  const snapshots = new Map();
  const downloaded = [];
  for (const source of registry.sources) {
    const path = confined(root, source.path);
    let bytes;
    try { bytes = await readFile(path); } catch (error) {
      if (error.code !== 'ENOENT' || !fetchMissing) throw error;
      if (source.format === 'metadata') throw new Error('元数据快照缺失，请从已复核的本地证据重新生成');
      bytes = await download(source.url);
      downloaded.push({ path, bytes });
    }
    snapshots.set(source.id, bytes);
  }
  const result = report(manifest, registry, snapshots);
  for (const { path, bytes } of downloaded) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--fetch') || args.length > 1) throw new Error('用法：node scripts/sync-candidates.mjs [--fetch]');
  const result = await sync({ fetchMissing: args.includes('--fetch') });
  console.log(`生成 ${result.candidates.length} 条待复核候选：candidates/mirrors.json`);
}
