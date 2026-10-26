import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import type { Browser, Frame, Page } from 'playwright-core';
import { launch, VIEWPORTS } from './harness.ts';

const SCRIPT = readFileSync(new URL('../dist/peach-jav.user.js', import.meta.url), 'utf8');
const BASE = 'https://peach.example.invalid';
const TOKEN = 'test-only-watch-token';

async function driver(target: Frame | Page, selector: string) {
  await target.evaluate(selector => {
    const video = document.querySelector(selector)! as HTMLVideoElement;
    const state = { position: 0, paused: false, seeking: false, ready: 4, rate: 1, src: 'main' };
    Object.assign(window, { watchVideo: state });
    for (const [key, get] of Object.entries({ currentTime: () => state.position, duration: () => 600,
      paused: () => state.paused, seeking: () => state.seeking, readyState: () => state.ready,
      playbackRate: () => state.rate, currentSrc: () => state.src })) Object.defineProperty(video, key, { get });
    setInterval(() => {
      if (!state.paused && !state.seeking && state.ready >= 2) state.position += 0.1 * state.rate;
    }, 100);
  }, selector);
}

describe('站外观看记录', () => {
  let browser: Browser;
  before(async () => { browser = await launch(); });
  after(async () => { await browser?.close(); });

  async function open({ configured = true, frame = false, site = 'supjav', conflict = false,
    nested = false, unsupported = false, viewport = VIEWPORTS[0] } = {}) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', error => problems.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      let html = '';
      if (url.hostname === 'ibucket.org') html = '<div id="player"><video></video></div>';
      else if (url.hostname === 'fc2stream.tv') html = '<div id="vplayer"><video></video></div>';
      else if (url.hostname === 'lk1.supremejav.com') html = '<iframe src="https://fc2stream.tv/embed/test"></iframe>';
      else if (site === 'uncenx') html = '<h1>ABC-123</h1><iframe src="https://ibucket.org/embed/abc-123"></iframe>';
      else if (unsupported) html = '<div class="archive-title"><h1>ABC-123</h1></div><a class="btn-server active">EVS</a><div id="dz_video"><iframe id="video" src="https://evs.example.invalid/embed/test"></iframe></div>';
      else if (nested) html = '<div class="archive-title"><h1>ABC-123</h1></div><div id="dz_video"><iframe id="video" src="https://lk1.supremejav.com/supjav.php?l=test"></iframe></div>';
      else html = `<div class="archive-title"><h1>ABC-123${conflict ? ' ABC-124' : ''}</h1></div><div id="dz_video"><video></video></div><aside><video></video></aside>`;
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>ABC-123</title>${html}` });
    });
    await context.addInitScript(({ base, token, configured }) => {
      const values: Record<string, unknown> = configured ? { 'peach.watch.config': { base, token } } : {};
      const mock = { calls: [] as Record<string, unknown>[], values, menus: {} as Record<string, () => void>,
        fail: false, status: 200, malformed: false };
      Object.assign(window, { watchMock: mock,
        GM_getValue: (key: string, fallback: unknown) => values[key] ?? fallback,
        GM_setValue: (key: string, value: unknown) => { values[key] = value; },
        GM_listValues: () => Object.keys(values), GM_deleteValue: (key: string) => { delete values[key]; },
        GM_registerMenuCommand: (name: string, callback: () => void) => { mock.menus[name] = callback; },
        GM_xmlhttpRequest: (request: Record<string, unknown> & { onload(value: unknown): void; onerror(): void }) => {
          mock.calls.push({ method: request.method, url: request.url, data: request.data, headers: request.headers, anonymous: request.anonymous });
          if (mock.fail) request.onerror(); else request.onload({ status: mock.status,
            responseText: mock.malformed ? '{"ok":false}' : '{"ok":true}' });
        },
      });
    }, { base: BASE, token: TOKEN, configured });
    await page.goto(site === 'uncenx' ? 'https://www.uncenx.com/ja/abc-123' : 'https://supjav.com/ja/123.html');
    await page.clock.install();
    if (nested) {
      for (const child of page.frames().slice(1)) await child.addScriptTag({ content: SCRIPT });
      await driver(page.frames().find(value => value.url().includes('fc2stream.tv'))!, 'video');
    } else if (frame) {
      const child = page.frames().find(value => value.url().startsWith('https://ibucket.org/'))!;
      await child.addScriptTag({ content: SCRIPT });
      await driver(child, 'video');
    } else if (!unsupported) await driver(page, '#dz_video video');
    await page.addScriptTag({ content: SCRIPT });
    return { page, problems, close: () => context.close() };
  }

  async function reports(page: Page) {
    return page.evaluate(() => (window as any).watchMock.calls.filter((call: any) => call.method === 'POST' && call.url.endsWith('/external-watch'))
      .map((call: any) => JSON.parse(call.data)));
  }

  const watchText = (page: Page) => page.locator('#peach-jav-action [data-peach-watch]');

  it('已配对页面独立显示服务器连接与实际保存回执', async () => {
    const opened = await open();
    try {
      await opened.page.clock.runFor(12_000);
      assert.match(await watchText(opened.page).innerText(), /已保存/);
      assert.ok(await opened.page.evaluate(() => (window as any).watchMock.calls.some((r: any) =>
        r.method === 'GET' && r.url.endsWith('/external-watch'))));
    } finally { await opened.close(); }
  });

  it('未连接的 Supjav 播放器明确提示 FST 与脚本权限且不伪造观看', async () => {
    const opened = await open({ unsupported: true });
    try {
      await opened.page.clock.runFor(6000);
      assert.match(await watchText(opened.page).innerText(), /FST/);
      assert.match(await watchText(opened.page).innerText(), /播放器未连接/);
      assert.deepEqual(await reports(opened.page), []);
    } finally { await opened.close(); }
  });

  it('网络失败在观看状态显示且恢复后显示保存回执', async () => {
    const opened = await open();
    try {
      await opened.page.evaluate(() => { (window as any).watchMock.fail = true; });
      await opened.page.clock.runFor(12_000);
      assert.match(await watchText(opened.page).innerText(), /无法连接/);
      await opened.page.evaluate(() => { (window as any).watchMock.fail = false; });
      await opened.page.clock.runFor(12_000);
      assert.match(await watchText(opened.page).innerText(), /已保存/);
    } finally { await opened.close(); }
  });

  it('观看拒绝与无效回执分别显示且保留待发送快照', async () => {
    const opened = await open(); const page = opened.page;
    try {
      await page.evaluate(() => { (window as any).watchMock.status = 401; });
      await page.clock.runFor(12_000);
      assert.match(await watchText(page).innerText(), /观看令牌无效/);
      assert.doesNotMatch(await watchText(page).innerText(), /已保存/);
      await page.evaluate(() => { (window as any).watchMock.status = 200; (window as any).watchMock.malformed = true; });
      await page.clock.runFor(12_000);
      assert.match(await watchText(page).innerText(), /回执无效/);
      assert.ok(await page.evaluate(() => Object.keys((window as any).watchMock.values)
        .some(key => key.startsWith('peach.watch.pending.'))));
      await page.evaluate(() => { (window as any).watchMock.malformed = false; });
      await page.clock.runFor(12_000);
      assert.match(await watchText(page).innerText(), /已保存/);
    } finally { await opened.close(); }
  });

  it('连接检查使用观看令牌且不提交播放记录，清除下载配对保留观看配对', async () => {
    const opened = await open(); const page = opened.page;
    const alerts: string[] = [];
    page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.accept(); });
    try {
      await page.evaluate(({ base, token }) => {
        const mock = (window as any).watchMock;
        mock.values['peach.jav.base'] = base; mock.values['peach.jav.token'] = 'wrong-download-token';
        mock.menus['检查站外观看连接']();
      }, { base: BASE, token: TOKEN });
      assert.ok(alerts.includes('Peach 连接成功'));
      await page.evaluate(() => { (window as any).watchMock.menus['清除浏览器添加配置'](); });
      const values = await page.evaluate(() => (window as any).watchMock.values);
      assert.equal(values['peach.jav.token'], undefined);
      assert.equal(values['peach.watch.config'].token, TOKEN);
      assert.deepEqual(await reports(page), []);
      assert.ok(await page.evaluate(({ token }) => (window as any).watchMock.calls.some((r: any) =>
        r.method === 'GET' && r.url.endsWith('/external-watch') && r.headers.Authorization === `Bearer ${token}`), { token: TOKEN }));
      assert.ok(alerts.every(message => !message.includes(TOKEN)));
    } finally { await opened.close(); }
  });

  for (const viewport of VIEWPORTS) it(`${viewport.name} 记录播放墙钟时间和独立覆盖区间`, async () => {
    const opened = await open({ viewport });
    try {
      await opened.page.clock.runFor(12_000);
      const values = await reports(opened.page);
      assert.ok(values.length > 0);
      const last = values.at(-1);
      assert.equal(last.code, 'ABC-123'); assert.equal(last.site, 'supjav');
      assert.ok(last.seconds >= 8 && last.seconds <= 12);
      assert.ok(last.intervals[0][1] > 8);
      assert.deepEqual(opened.problems, []);
      const size = await opened.page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(size.width <= size.viewport);
    } finally { await opened.close(); }
  });

  it('未配对或身份冲突时不产生观看上报', async () => {
    for (const options of [{ configured: false }, { conflict: true }]) {
      const opened = await open(options);
      try { await opened.page.clock.runFor(15_000); assert.deepEqual(await reports(opened.page), []); }
      finally { await opened.close(); }
    }
  });

  it('倍速使用墙钟时间，拖动暂停缓冲和广告不累加观看时间', async () => {
    const opened = await open(); const page = opened.page;
    try {
      await page.evaluate(() => { (window as any).watchVideo.rate = 2; });
      await page.clock.runFor(12_000);
      const fast = (await reports(page)).at(-1);
      assert.ok(fast.seconds < 12); assert.ok(fast.intervals[0][1] > fast.seconds * 1.8);
      await page.evaluate(() => {
        const state = (window as any).watchVideo; state.seeking = true; state.position = 300;
        document.querySelector('video')!.dispatchEvent(new Event('seeking'));
      });
      await page.clock.runFor(1000);
      await page.evaluate(() => { (window as any).watchVideo.seeking = false; (window as any).watchVideo.paused = true; });
      await page.clock.runFor(12_000);
      const paused = (await reports(page)).at(-1);
      assert.ok(paused.seconds <= fast.seconds + 2);
      await page.evaluate(() => {
        (window as any).watchVideo.paused = false; document.querySelector('#dz_video')!.classList.add('jw-flag-ads');
      });
      await page.clock.runFor(12_000);
      assert.equal((await reports(page)).at(-1).seconds, paused.seconds);
      await page.evaluate(() => { document.querySelector('#dz_video')!.classList.remove('jw-flag-ads'); (window as any).watchVideo.ready = 1; });
      await page.clock.runFor(12_000);
      assert.equal((await reports(page)).at(-1).seconds, paused.seconds);
    } finally { await opened.close(); }
  });

  it('UNCENX 已确认 frame 只传测量值，令牌只由顶层脚本发送', async () => {
    const opened = await open({ site: 'uncenx', frame: true });
    try {
      await opened.page.clock.runFor(15_000);
      const values = await reports(opened.page);
      assert.ok(values.length); assert.equal(values.at(-1).site, 'uncenx');
      const child = opened.page.frames().find(value => value.url().includes('ibucket.org'))!;
      assert.equal(await child.evaluate(() => (window as any).watchMock.calls.length), 0);
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close(); }
  });

  it('失败保留累计快照用于重试，主动关闭撤销本机收集', async () => {
    const opened = await open(); const page = opened.page;
    try {
      await page.evaluate(() => { (window as any).watchMock.fail = true; });
      await page.clock.runFor(12_000);
      const first = (await reports(page))[0];
      assert.ok(await page.evaluate(() => Object.keys((window as any).watchMock.values).some(key => key.startsWith('peach.watch.pending.'))));
      await page.evaluate(() => { (window as any).watchMock.fail = false; });
      await page.clock.runFor(20_000);
      const last = (await reports(page)).at(-1);
      assert.equal(first.session, last.session); assert.ok(last.sequence > first.sequence);
      await page.evaluate(() => { (window as any).watchMock.menus['关闭站外观看记录'](); });
      const count = (await reports(page)).length;
      await page.clock.runFor(20_000);
      assert.equal((await reports(page)).length, count);
    } finally { await opened.close(); }
  });

  it('Supjav 嵌套 frame 接力并拒绝顶层伪造的播放消息', async () => {
    const opened = await open({ nested: true }); const page = opened.page;
    try {
      await page.evaluate(() => window.postMessage({ type: 'peach-watch-report', nonce: 'forged',
        value: { session: 'aa000000-0000-0000-0000-000000000001', sequence: 1, seconds: 50,
          elapsed: 50, duration: 600, intervals: [[0, 50]] } }, location.origin));
      await page.clock.runFor(2000);
      assert.deepEqual(await reports(page), []);
      // frame 消息由浏览器任务队列递送；每个心跳间隔交还事件循环。
      for (let step = 0; step < 26; step++) {
        await page.clock.runFor(500);
        await page.waitForTimeout(10);
      }
      const values = await reports(page);
      assert.ok(values.length); assert.equal(values.at(-1).site, 'supjav');
      assert.match(await watchText(page).innerText(), /正在播放/);
      assert.match(await watchText(page).innerText(), /已保存/);
      for (const child of page.frames().slice(1)) {
        assert.equal(await child.evaluate(() => (window as any).watchMock.calls.length), 0);
      }
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close(); }
  });

  it('地址不匹配和过期记录不阻塞当前地址的有界重试队列', async () => {
    const opened = await open(); const page = opened.page;
    try {
      await page.evaluate(({ base }) => {
        const values = (window as any).watchMock.values;
        for (let i = 0; i < 70; i++) values['peach.watch.pending.old' + i] = {
          base: 'https://old.example.invalid', at: Date.now() - 25 * 3600_000, body: { session: 'old' + i } };
        values['peach.watch.pending.current'] = { base, at: Date.now(), body: {
          code: 'ABC-123', site: 'supjav', page: 'https://supjav.com/ja/123.html',
          session: 'aa000000-0000-0000-0000-000000000001', sequence: 100, seconds: 120,
          elapsed: 180, duration: 600, intervals: [[0, 120]] } };
        (window as any).watchVideo.paused = true;
      }, { base: BASE });
      await page.clock.runFor(31_000);
      assert.ok((await reports(page)).some((value: any) => value.sequence === 100));
      assert.equal(await page.evaluate(() => Object.keys((window as any).watchMock.values)
        .filter(key => key.startsWith('peach.watch.pending.')).length), 0);
    } finally { await opened.close(); }
  });
});
