import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';
import { test } from 'node:test';
import { ROOT, render, outputs, build, validateManifest } from '../scripts/build.mjs';
import { exportRelease } from '../scripts/export.mjs';

const manifest = JSON.parse(await readFile(new URL('../jav-sites.json', import.meta.url), 'utf8'));
const template = await readFile(new URL('../src/peach-jav.user.js', import.meta.url), 'utf8');

test('安装产物可解析，元数据匹配清单且每个域名覆盖 HTTPS 主域与子域', async () => {
  const result = await outputs();
  const script = result.get('peach-jav.user.js');
  assert.doesNotThrow(() => new Script(script));
  const metadata = new Map([...script.matchAll(/^\/\/ @(\w+)\s+(.+)$/gm)]
    .filter(match => match[1] !== 'match').map(match => [match[1], match[2]]));
  assert.equal(metadata.get('version'), '0.4.1');
  assert.equal(metadata.get('namespace'), 'https://github.com/peach-mitao/peach-userscript');
  assert.equal(metadata.get('source'), metadata.get('namespace'));
  assert.equal(metadata.get('supportURL'), metadata.get('namespace') + '/issues');
  const matches = [...script.matchAll(/^\/\/ @match\s+(.+)$/gm)].map(match => match[1]);
  assert.deepEqual(matches, manifest.sites.flatMap(site => site.domains.flatMap(domain =>
    [`https://${domain}/*`, `https://*.${domain}/*`])).concat([
      'https://ibucket.org/embed/*', 'https://lk1.supremejav.com/supjav.php*', 'https://fc2stream.tv/*',
    ]));
  assert.equal(new Set(matches).size, matches.length);
});

test('构建不依赖时间，CRLF 模板得到同一份 LF 产物，工作区产物一致', async () => {
  const first = await outputs(ROOT);
  assert.deepEqual(await outputs(ROOT), first);
  assert.equal(render(template.replace(/\r?\n/g, '\r\n'), manifest, '0.4.1'), first.get('peach-jav.user.js'));
  await build({ check: true });
});

test('站点清单无效时拒绝构建', () => {
  for (const change of [
    value => { value.version = 2; },
    value => { value.sites.push(structuredClone(value.sites[0])); },
    value => { value.sites[0].domains.push('evil.invalid/*\n// @grant unsafeWindow'); },
    value => { value.sites[0].domains = ['127.0.0.1']; },
    value => { value.sites[0].detail_pattern = '['; },
    value => { delete value.sites[0].selectors; },
    value => { value.sites[0].query_keys = ['token with space']; },
  ]) {
    const invalid = structuredClone(manifest);
    change(invalid);
    assert.throws(() => validateManifest(invalid));
  }
});

test('模板缺失、重复标记或版本漂移时拒绝构建', () => {
  for (const source of [template.replace('__PEACH_JAV_SITES__', '{}'), template + '\n// __PEACH_JAV_MATCHES__']) {
    assert.throws(() => render(source, manifest, '0.4.1'));
  }
  assert.throws(() => render(template, manifest, '0.3.1'));
});

test('发布制品导出可重复且校验覆盖脚本与服务端快照，不覆盖不同文件', async () => {
  const target = resolve(await mkdtemp(join(tmpdir(), 'peach-export-')));
  try {
    const names = await exportRelease(target);
    assert.deepEqual(await exportRelease(target), names);
    const release = JSON.parse(await readFile(join(target, 'release.json'), 'utf8'));
    for (const [name, hash] of Object.entries(release.files)) {
      const bytes = await readFile(join(target, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
    }
    assert.deepEqual(JSON.parse(await readFile(join(target, 'jav-sites.json'), 'utf8')), manifest);
    await writeFile(join(target, 'jav-sites.json'), 'different');
    await assert.rejects(exportRelease(target), /不同内容/);
    assert.equal(await readFile(join(target, 'jav-sites.json'), 'utf8'), 'different');
  } finally { await rm(target, { recursive: true, force: true }); }
});
