import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, outputs, ROOT } from './build.mjs';

export async function exportRelease(destination, root = ROOT) {
  if (!destination) throw new Error('请指定制品输出目录');
  await build({ check: true, root });
  const files = await outputs(root);
  const target = resolve(destination);
  await mkdir(target, { recursive: true });
  const canonical = await realpath(target);
  // 同一发布可重复导出；遇到不同内容时在写入任何文件前拒绝。
  const pending = [];
  for (const [name, content] of files) {
    const path = resolve(canonical, name);
    try {
      if (await readFile(path, 'utf8') !== content) throw new Error(`目标存在不同内容：${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      pending.push([path, content]);
    }
  }
  for (const [path, content] of pending) await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  return [...files.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('用法：node scripts/export.mjs --output <目录>');
  const names = await exportRelease(args[1]);
  console.log(`已导出 ${names.length} 个发布制品`);
}
