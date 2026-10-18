import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './build.mjs';
import { sha256 } from './sync-candidates.mjs';

const sourceIds = {
  missav: [576375, 529125], javlibrary: [576375, 449158], javbus: [576375], javmost: [429173],
  njav: [429173], avsox: [449158], netflav: [429173], bestjavporn: [429173], javmenu: [429173, 449158],
  avjoy: [429173], ggjav: [429173], av01: [429173], highporn: [429173], evojav: [429173],
  hayav: [429173], javhub: [429173], '141jav': [428639, 449158], '141ppv': [449158],
  freejavbt: [428639, 449158], javrate: [576375], sehuatang: [576375, 449158],
  '169bbs': [576375], hjd2048: [576375], airav: [449158], javbooks: [449158],
  javfree: [], javcv: [449158], projectjav: [449158], paipancon: [429173],
};

export async function recordReview(sourceDir, baselineFile, root = ROOT) {
  const manifest = JSON.parse(await readFile(resolve(root, 'jav-sites.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(resolve(baselineFile), 'utf8'));
  const baselineDomains = new Set(baseline.sites.flatMap(site => site.domains));
  const sources = JSON.parse(await readFile(resolve(sourceDir, 'sources.json'), 'utf8'));
  const probes = JSON.parse(await readFile(resolve(sourceDir, 'domain-probes.json'), 'utf8'));
  const metadata = [];
  const registry = { version: 1, sources: [] };
  await mkdir(resolve(root, 'docs/evidence/sleazy-metadata'), { recursive: true });
  for (const source of sources) {
    const bytes = await readFile(resolve(sourceDir, `${source.id}.user.js`));
    const rawHash = sha256(bytes);
    const lfHash = sha256(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')));
    if (rawHash !== source.sha256 && lfHash !== source.sha256) throw new Error(`来源快照 hash 不符：${source.id}`);
    metadata.push({ ...Object.fromEntries(['id', 'name', 'version', 'daily_installs', 'total_installs', 'url', 'code_url', 'sha256']
      .map(key => [key, source[key]])), archived_sha256: rawHash,
      archived_normalization: rawHash === source.sha256 ? 'none' : 'CRLF-to-LF' });
    const declarationSnapshot = JSON.stringify({ source_sha256: source.sha256,
      declarations: [...source.matches, ...source.connects.map(value => ['connect', value])] }, null, 2) + '\n';
    const metadataPath = `docs/evidence/sleazy-metadata/${source.id}.json`;
    await writeFile(resolve(root, metadataPath), declarationSnapshot, 'utf8');
    registry.sources.push({ id: `sleazy-${source.id}`, url: source.code_url, evidence_url: source.url,
      format: 'metadata', path: metadataPath, sha256: source.sha256, metadata_sha256: sha256(declarationSnapshot) });
  }
  const domains = new Set(manifest.sites.flatMap(site => site.domains));
  const registered = [];
  for (const site of manifest.sites) for (const domain of site.domains.filter(domain => !baselineDomains.has(domain))) {
    const directProbe = probes.find(probe => probe.domain === domain);
    const redirect = probes.find(probe => probe.final_url && new URL(probe.final_url).hostname.replace(/^www\./, '') === domain);
    const probe = directProbe || redirect;
    const refs = sourceIds[site.id] || [];
    const notes = [];
    if (site.id === 'sehuatang') notes.push('站点归属采用脚本声明；当前主页正文与标题混淆，真实页面验收未取得。');
    if (site.id === 'javlibrary') notes.push('镜像归属采用 576375 的显式域名枚举，403 挑战不作为详情验收。');
    if (site.id === 'javbus') notes.push('HTTPS 响应为 JavBus 年龄确认页，未提交年龄确认。');
    if (site.id === 'njav') notes.push('HTTPS 标题为 123AV，429173 声明 /zh/v/{{code}} 路径。');
    if (site.id === 'javfree') notes.push('来源为 HTTPS 首页身份探测，未引用第三方脚本实现。');
    registered.push({ domain, site_id: site.id, relationship: baseline.sites.some(item => item.id === site.id) ? 'mirror' : 'site',
      decision: 'registered', review_basis: '协调者审阅后的明确登记范围', source_ids: refs,
      probe: probe ? { evidence_type: directProbe ? 'direct' : 'redirect_target', ...probe } : { evidence_type: 'not_obtained' },
      automatic_detail_verified: false, extension_download_verified: false, notes });
  }
  const pending = probes.filter(probe => !domains.has(probe.domain)).map(probe => ({
    domain: probe.domain, decision: 'pending', probe,
    reason: probe.error ? 'TLS 或连接失败，未取得可用站点证据。'
      : ['avmoo.click', 'avmoo.cfd', 'hpav.tv'].includes(probe.domain) ? '空白、加载或跳转页面不足以确认归属。'
      : '站点响应或归属证据不足，保持待核验。',
  }));
  const result = { version: 1, observed_on: '2026-10-18', sources: metadata,
    scope: '仅记录公开元数据、探测事实和明确审阅后的站点范围；不包含第三方实现源码。',
    registered, pending, exclusions: ['超宽通配符不进入匹配清单', 'Avgle 和 R18.com 等历史入口不登记'] };
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  await writeFile(resolve(root, 'docs/evidence/site-review.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  await writeFile(resolve(root, 'mirror-sources.json'), JSON.stringify(registry, null, 2) + '\n', 'utf8');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--source-dir' || args[2] !== '--baseline') throw new Error('用法：node scripts/record-review.mjs --source-dir <本地取证目录> --baseline <导入前站点清单>');
  const result = await recordReview(args[1], args[3]);
  console.log(`记录 ${result.registered.length} 项域名登记和 ${result.pending.length} 项待核验记录`);
}
