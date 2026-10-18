import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { extractDomains, report, sha256, confined, validateSources, sync } from '../scripts/sync-candidates.mjs';

const manifest = JSON.parse(await readFile(new URL('../jav-sites.json', import.meta.url), 'utf8'));
const fixture = Buffer.from(`// ==UserScript==\n// @name fixture\n// @match https://*.missav.ws/*\n// @match https://mirror.example/*\n// @include https://mirror.example/video/*\n// @match *://*/*\n// @include /^https?:.*/\n// @match https://127.0.0.1/*\n// ==/UserScript==\nthrow new Error('远程代码不得执行');\n`);
const source = { id: 'fixture', url: 'https://update.sleazyfork.org/scripts/123/456/fixture.user.js',
  evidence_url: 'https://update.sleazyfork.org/scripts/123/456/fixture.user.js',
  path: 'evidence/fixture.user.js', sha256: sha256(fixture) };
const registry = { version: 1, sources: [source] };

test('只读取元数据中的显式域名，通配与正则留为未解析记录', () => {
  const parsed = extractDomains(fixture.toString());
  assert.deepEqual([...parsed.domains.keys()], ['missav.ws', 'mirror.example']);
  assert.equal(parsed.skipped.length, 3);
});

test('所有远程域名保持待复核，既有域名只标记关联，内容按 SHA256 固定', () => {
  const result = report(manifest, registry, new Map([['fixture', fixture]]));
  assert.deepEqual(result.candidates.map(item => [item.domain, item.registered_site]),
    [['mirror.example', null], ['missav.ws', 'missav']]);
  assert.ok(result.candidates.every(item => item.status === 'candidate' && item.review === 'required' && item.confidence === 'unverified'));
  assert.deepEqual(report(manifest, registry, new Map([['fixture', fixture]])), result);
  assert.throws(() => report(manifest, registry, new Map([['fixture', Buffer.from('tampered')]])), /hash/);
});

test('来源只接受公开 Sleazy HTTPS URL、固定 hash 和 evidence 路径', () => {
  for (const patch of [
    { url: 'https://127.0.0.1/secret' }, { url: 'https://example.invalid/script.user.js' },
    { url: source.url + '?token=secret' }, { sha256: '' }, { path: 'jav-sites.json' },
  ]) assert.throws(() => validateSources({ version: 1, sources: [{ ...source, ...patch }] }));
  assert.throws(() => confined(resolve(tmpdir()), '../escape.json'));
});

test('连接声明形成新站候选，通配连接不形成域名', () => {
  const parsed = extractDomains('// ==UserScript==\n// @connect new-site.example\n// @connect *\n// ==/UserScript==');
  assert.deepEqual([...parsed.domains.keys()], ['new-site.example']);
  assert.deepEqual(parsed.skipped, ['*']);
});

test('元数据快照可离线重放，保留来源 hash 且拒绝元数据篡改', () => {
  const bytes = Buffer.from(JSON.stringify({ source_sha256: source.sha256, declarations: [['connect', 'new-site.example']] }));
  const selected = { ...source, format: 'metadata', path: 'docs/evidence/sleazy-metadata/fixture.json', metadata_sha256: sha256(bytes) };
  const result = report(manifest, { version: 1, sources: [selected] }, new Map([['fixture', bytes]]));
  assert.equal(result.candidates[0].domain, 'new-site.example');
  assert.equal(result.candidates[0].source_sha256, source.sha256);
  assert.throws(() => report(manifest, { version: 1, sources: [selected] }, new Map([['fixture', Buffer.from('{}')]])), /hash/);
});

test('离线同步只写候选，源清单与脚本快照保持原字节', async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), 'peach-userscript-')));
  try {
    await mkdir(join(root, 'evidence'));
    const manifestBytes = JSON.stringify(manifest);
    await writeFile(join(root, 'jav-sites.json'), manifestBytes);
    await writeFile(join(root, 'mirror-sources.json'), JSON.stringify(registry));
    await writeFile(join(root, source.path), fixture);
    const result = await sync({ root });
    assert.equal(result.candidates.length, 2);
    assert.equal(await readFile(join(root, 'jav-sites.json'), 'utf8'), manifestBytes);
    assert.deepEqual(await readFile(join(root, source.path)), fixture);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'candidates/mirrors.json'), 'utf8')), result);
    await assert.rejects(sync({ root, output: 'jav-sites.json' }), /candidates/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
