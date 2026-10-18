import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exportPeach } from '../scripts/export-peach.mjs';

test('Peach 导出预览不改文件，apply 只同步指定制品并记录上游提交', async () => {
  const fixture = resolve(await mkdtemp(join(tmpdir(), 'peach-consumer-')));
  const target = join(fixture, 'worktree');
  const gitdir = join(fixture, 'common/worktrees/fixture');
  const commit = 'a'.repeat(40);
  try {
    for (const path of [gitdir, join(target, 'src/peach'), join(target, 'web/integrations')]) await mkdir(path, { recursive: true });
    await writeFile(join(target, '.git'), `gitdir: ${gitdir.replaceAll('\\', '/')}\n`);
    await writeFile(join(gitdir, 'gitdir'), join(target, '.git').replaceAll('\\', '/') + '\n');
    await writeFile(join(gitdir, 'commondir'), '../..\n');
    await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/fixture\n');
    await writeFile(join(fixture, 'common/config'), '[core]\n');
    await writeFile(join(target, 'pyproject.toml'), '[project]\nname = "peach"\n[tool.fixture]\n');
    await writeFile(join(target, 'src/peach/__init__.py'), '');
    await writeFile(join(target, 'web/integrations/unrelated.json'), 'keep');
    const preview = await exportPeach({ target, commit });
    assert.equal(preview.applied, false);
    await assert.rejects(readFile(join(target, 'web/integrations/peach-jav.user.js')), { code: 'ENOENT' });
    const applied = await exportPeach({ target, commit, apply: true });
    assert.deepEqual(applied.files.map(item => item.name), ['peach-jav.user.js', 'jav-sites.json', 'jav-userscript-release.json']);
    const provenance = JSON.parse(await readFile(join(target, 'web/integrations/jav-userscript-release.json'), 'utf8'));
    assert.equal(provenance.commit, commit);
    assert.equal(provenance.version, '0.3.0');
    assert.equal(await readFile(join(target, 'web/integrations/unrelated.json'), 'utf8'), 'keep');
    assert.ok((await exportPeach({ target, commit })).files.every(item => item.action === 'unchanged'));
    await assert.rejects(exportPeach({ target, commit: 'main', apply: true }), /40 位/);
    await writeFile(join(target, 'pyproject.toml'), '[project]\nname = "other"\n');
    await assert.rejects(exportPeach({ target, commit }), /不是 Peach/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
