import { readFile, writeFile, stat, lstat, realpath, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, ROOT } from './build.mjs';

const repository = 'https://github.com/peach-mitao/peach-userscript';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contained = (root, path) => {
  const rel = relative(root, path);
  return !rel.startsWith('..') && !isAbsolute(rel);
};

export async function peachWorktree(target) {
  const root = await realpath(resolve(target));
  if (!(await stat(join(root, '.git'))).isFile()) throw new Error('目标必须是注册的 Peach 隔离工作树');
  const pointer = /^gitdir: (.+)\r?\n?$/.exec(await readFile(join(root, '.git'), 'utf8'));
  if (!pointer) throw new Error('目标 Git 工作树指针无效');
  const gitdir = await realpath(resolve(root, pointer[1]));
  const backpointer = (await readFile(join(gitdir, 'gitdir'), 'utf8')).trim();
  if (await realpath(resolve(gitdir, backpointer)) !== await realpath(join(root, '.git'))) throw new Error('目标工作树未注册到对应 Git 元数据');
  await stat(join(gitdir, 'HEAD'));
  const common = await realpath(resolve(gitdir, (await readFile(join(gitdir, 'commondir'), 'utf8')).trim()));
  if (!(await stat(join(common, 'config'))).isFile()) throw new Error('目标 Git 公共目录无效');
  const project = await readFile(join(root, 'pyproject.toml'), 'utf8');
  const projectSection = /^\[project\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(project)?.[1];
  if (!/^name\s*=\s*["']peach["']\s*$/m.test(projectSection || '')) throw new Error('目标项目不是 Peach');
  await stat(join(root, 'src/peach/__init__.py'));
  const integrations = await realpath(join(root, 'web/integrations'));
  if (!contained(root, integrations)) throw new Error('目标 integrations 目录超出工作树');
  return { root, integrations };
}

export async function exportPeach({ target, commit, apply = false, root = ROOT }) {
  if (!target || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('需要目标工作树及 40 位小写上游提交 SHA');
  await build({ check: true, root });
  const directory = await peachWorktree(target);
  const release = JSON.parse(await readFile(resolve(root, 'dist/release.json'), 'utf8'));
  if (release.repository !== repository || release.site_schema_version !== 1
    || Object.keys(release.files || {}).sort().join(',') !== 'jav-sites.json,peach-jav.user.js') throw new Error('发布清单无效');
  const files = new Map();
  for (const name of ['peach-jav.user.js', 'jav-sites.json']) {
    const bytes = await readFile(resolve(root, 'dist', name));
    if (sha(bytes) !== release.files[name]) throw new Error(`发布 hash 不符：${name}`);
    files.set(name, bytes);
  }
  const provenance = { version: release.version, repository, commit,
    site_schema_version: release.site_schema_version, files: release.files };
  files.set('jav-userscript-release.json', Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
  const plan = [];
  for (const [name, bytes] of files) {
    const path = join(directory.integrations, name);
    let previous = null;
    try {
      if (!(await lstat(path)).isFile()) throw new Error(`目标制品不是普通文件：${name}`);
      previous = await readFile(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    plan.push({ name, path, bytes, previous, action: previous?.equals(bytes) ? 'unchanged' : previous ? 'replace' : 'create' });
  }
  if (apply) {
    const staged = [];
    try {
      for (const item of plan.filter(item => item.action !== 'unchanged')) {
        const path = join(dirname(item.path), `.peach-userscript-${randomUUID()}.tmp`);
        await writeFile(path, item.bytes, { flag: 'wx' });
        staged.push({ path, target: item.path });
      }
      for (const item of staged) await rename(item.path, item.target);
    } finally { for (const item of staged) await rm(item.path, { force: true }); }
  }
  return { applied: apply, version: release.version, commit,
    files: plan.map(item => ({ name: item.name, action: item.action, sha256: sha(item.bytes) })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--apply' && !options.apply) options.apply = true;
    else if (['--target', '--commit'].includes(name) && !options[name.slice(2)] && args[index + 1] && !args[index + 1].startsWith('--')) options[name.slice(2)] = args[++index];
    else throw new Error('用法：node scripts/export-peach.mjs --target <Peach隔离工作树> --commit <40位提交SHA> [--apply]');
  }
  console.log(JSON.stringify(await exportPeach(options), null, 2));
}
