// ==UserScript==
// @name         Peach · JAV 入库
// @namespace    https://github.com/peach-mitao/peach-userscript
// @source       https://github.com/peach-mitao/peach-userscript
// @supportURL   https://github.com/peach-mitao/peach-userscript/issues
// @homepageURL  https://github.com/peach-mitao/peach-userscript
// @license      AGPL-3.0-or-later
// @version      0.3.0
// @description  在 JAV 作品详情页识别或选中番号，交给 Peach 下载入库。
// __PEACH_JAV_MATCHES__
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        window.onurlchange
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const SITE_RULES = __PEACH_JAV_SITES__;
  const STORAGE_BASE = 'peach.jav.base';
  const STORAGE_TOKEN = 'peach.jav.token';
  const ROOT_ID = 'peach-jav-action';
  if (globalThis.__peachJavUserscriptActive) return;
  globalThis.__peachJavUserscriptActive = true;
  const ACTIVE = new Set(['queued', 'searching', 'submitted']);
  const STATES = new Set([...ACTIVE, 'ingested', 'owned', 'failed', 'no_match', 'idle']);
  const LABELS = {
    queued: '已排队', searching: '正在搜磁力', submitted: '云下载中',
    ingested: '已入库', owned: '馆藏已有', failed: '任务失败', no_match: '未找到资源', idle: '可以加入 Peach',
  };
  const attempts = new Set();
  let generation = 0;
  let current = null;
  let pageKey = '';
  let refreshTimer;
  let selected = null;

  // 只做粗提取；合法番号由 Peach 校验。
  function candidates(value) {
    const found = new Set();
    const bounded = String(value || '').slice(0, 800).toUpperCase();
    let rest = bounded.replace(/\bFC2(?:[-_ ]?PPV)?[-_ ]?(\d{4,9})\b/g, (_, digits) => {
      found.add(`FC2-PPV-${digits}`);
      return ' ';
    });
    rest = rest.replace(/\b([NK])(\d{4})\b/g, (_, prefix, digits) => {
      found.add(prefix.toLowerCase() + digits);
      return ' ';
    });
    for (const match of rest.matchAll(/\b((?:\d{1,5})?[A-Z]{2,12})[-_]?(\d{1,8})(?=$|[^A-Z0-9])/g)) {
      found.add(`${match[1]}-${match[2]}`);
    }
    for (const match of rest.matchAll(/\b\d{6}[-_]\d{3}\b/g)) found.add(match[0]);
    return found;
  }

  function comparisonKey(code) {
    if (code.startsWith('FC2-PPV-')) return code;
    return code.replace(/^((?:\d+)?[A-Z]+)-0*(\d+)$/, '$1-$2');
  }

  function siteFor(url) {
    if (url.protocol !== 'https:') return null;
    return SITE_RULES.sites.find(site => site.domains.some(domain =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`))) || null;
  }

  function sourcePage(url, site) {
    const source = new URL(url.origin + url.pathname);
    for (const key of site.query_keys || []) {
      const values = url.searchParams.getAll(key);
      if (values.length === 1 && /^[A-Za-z0-9_-]{1,100}$/.test(values[0])) {
        source.searchParams.set(key, values[0]);
      }
    }
    return source.href;
  }

  function fieldText(field) {
    if (field.hasAttribute('data-video-code')) return field.getAttribute('data-video-code');
    if (field.id === '__NEXT_DATA__') {
      const raw = field.textContent || '';
      if (raw.length > 1_000_000) return '';
      try {
        const props = JSON.parse(raw).props?.pageProps;
        const work = props?.work || (props?.works?.length === 1 ? props.works[0] : null);
        return String(work?.work_id || '');
      } catch { return ''; }
    }
    const text = (field.textContent || '').slice(0, 800);
    if (field.matches('dt, strong, b, .header, p')) {
      const label = text.trim().split(/[:：]/, 1)[0].trim().toLowerCase();
      const labelled = ['番号', '番號', '品番', '識別碼', '识别码', 'id', 'code'].includes(label)
        || /^(番号|番號|品番|識別碼|识别码|ID|Code)\s*[:：]/i.test(text.trim());
      if (!labelled) return '';
      if (field.tagName === 'DT') return field.nextElementSibling?.tagName === 'DD' ? field.nextElementSibling.textContent : '';
      if (field.tagName === 'P') return text;
      let value = text;
      let next = field.nextSibling;
      for (let index = 0; next && index < 4; index++, next = next.nextSibling) {
        if (next.nodeType === Node.ELEMENT_NODE && next.matches('br, b, strong, .header')) break;
        value += ` ${(next.textContent || '').slice(0, 800)}`;
      }
      return value.slice(0, 800);
    }
    return text;
  }

  function automaticIdentity(url, site) {
    if (site.mode !== 'automatic' || !site.detail_pattern) return null;
    const match = new RegExp(site.detail_pattern, 'i').exec(url.pathname);
    if (!match) return null;
    if (site.query_keys?.length && !site.query_keys.every(key => url.searchParams.getAll(key).length === 1
      && /^[A-Za-z0-9_-]{1,100}$/.test(url.searchParams.get(key)))) return null;
    let decoded = '';
    try { decoded = decodeURIComponent(match[1] || ''); } catch { return null; }
    const pathCodes = candidates(decoded);
    if (match[1] && !pathCodes.size) return null;
    const codes = new Map([...pathCodes].map(code => [comparisonKey(code), code]));
    const brand = site.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const title = document.title.replace(new RegExp(`(^|[^A-Z0-9])${brand}(?=$|[^A-Z0-9])`, 'gi'), '$1 ');
    const fields = [title];
    const seen = new Set();
    for (const selector of site.selectors || []) {
      const nodes = [...document.querySelectorAll(selector)].slice(0, 40);
      for (const field of nodes) {
        if (seen.has(field)) continue;
        seen.add(field);
        fields.push(fieldText(field));
        if (field.matches('h1,h2,h3,h4')) break;
      }
    }
    let foundField = false;
    for (const field of fields) for (const code of candidates(field)) {
      foundField = true;
      if (!codes.has(comparisonKey(code))) codes.set(comparisonKey(code), code);
    }
    if (!foundField) return null;
    return {
      code: codes.size === 1 ? [...codes.values()][0] : '',
      conflict: codes.size !== 1,
      source: sourcePage(url, site),
    };
  }

  function identity() {
    const url = new URL(location.href);
    const site = siteFor(url);
    if (!site) return null;
    if (selected?.url !== location.href) selected = null;
    return selected || automaticIdentity(url, site);
  }

  function selectCode() {
    const url = new URL(location.href);
    const site = siteFor(url);
    if (!site) return;
    const raw = String(getSelection() || '').trim();
    const shortCode = /^(?:FC2(?:[-_ ]?PPV)?[-_ ]?\d{4,9}|[NK]\d{4}|(?:\d{1,5})?[A-Z]{2,12}[-_]?\d{1,8}|\d{6}[-_]\d{3})$/i;
    const extracted = candidates(raw);
    if (raw.length > 80 || !shortCode.test(raw) || extracted.size !== 1) {
      alert('请只选中一个完整的短番号。');
      return;
    }
    selected = { url: location.href, code: [...extracted][0], conflict: false, source: sourcePage(url, site) };
    pageKey = '';
    refresh();
  }

  function settings(rawBase, rawToken) {
    const base = new URL(String(rawBase).trim());
    const token = String(rawToken).trim();
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (!(base.protocol === 'https:' || (base.protocol === 'http:' && loopback))
      || base.username || base.password || base.search || base.hash || base.pathname !== '/'
      || !token || token.length > 256 || /[\r\n]/.test(String(rawToken))) throw new Error();
    return { base: base.origin, token };
  }

  function configuration() {
    try {
      return settings(GM_getValue(STORAGE_BASE, ''), GM_getValue(STORAGE_TOKEN, ''));
    } catch { return null; }
  }

  function configure() {
    const base = prompt('Peach 地址（含 http:// 或 https://）', String(GM_getValue(STORAGE_BASE, '') || ''));
    if (base === null) return;
    const token = prompt('Peach 专用令牌', '');
    if (token === null) return;
    try {
      const config = settings(base, token);
      GM_setValue(STORAGE_BASE, config.base);
      GM_setValue(STORAGE_TOKEN, config.token);
      pageKey = '';
      refresh();
    } catch {
      if (current) current.note.textContent = '地址或令牌无效，请在用户脚本菜单中配置。';
    }
  }

  GM_registerMenuCommand('配置 Peach 地址与令牌', configure);
  GM_registerMenuCommand('选中番号加入 Peach', selectCode);

  function request(config, code, source, method) {
    return new Promise((resolve, reject) => {
      const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' };
      if (method === 'POST') headers['Content-Type'] = 'application/json';
      try {
        GM_xmlhttpRequest({
          method,
          url: `${config.base}/api/jav-browser${method === 'GET' ? `?code=${encodeURIComponent(code)}` : ''}`,
          headers,
          ...(method === 'POST' ? { data: JSON.stringify({ code, source_url: source }) } : {}),
          anonymous: true,
          timeout: 15_000,
          onload(response) {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(response.status === 401 || response.status === 403 ? '令牌无效或无权限，请重新配置。' : 'Peach 请求失败，请查询状态。'));
              return;
            }
            try {
              const body = JSON.parse(response.responseText);
              if (body.ok !== true || !STATES.has(body.state) || typeof body.code !== 'string'
                || candidates(body.code).size !== 1
                || ![...candidates(body.code)].some(candidate => comparisonKey(candidate) === comparisonKey(code))) throw new Error();
              resolve(body);
            } catch { reject(new Error('Peach 返回的状态无效，请查询状态。')); }
          },
          onerror: () => reject(new Error('无法连接 Peach，请查询状态。')),
          ontimeout: () => reject(new Error('Peach 请求超时，请查询状态。')),
          onabort: () => reject(new Error('Peach 请求已中止，请查询状态。')),
        });
      } catch { reject(new Error('无法连接 Peach，请查询状态。')); }
    });
  }

  function alive(view) { return current === view && generation === view.generation && view.url === location.href; }

  function render(view) {
    if (!alive(view)) return;
    const terminalSuccess = ['ingested', 'owned'].includes(view.state);
    view.button.disabled = view.identity.conflict || terminalSuccess;
    view.button.setAttribute('aria-busy', String(view.busy));
    view.button.setAttribute('aria-disabled', String(view.busy || view.button.disabled));
    view.button.textContent = view.identity.conflict ? '番号存在冲突'
      : !configuration() ? '配置 Peach'
      : terminalSuccess ? LABELS[view.state]
      : view.busy ? '正在查询 Peach'
      : view.queryOnly || ACTIVE.has(view.state) ? '查询 Peach 状态'
      : ['failed', 'no_match'].includes(view.state) ? '重试加入 Peach' : '加入 Peach';
  }

  function applyState(view, body) {
    view.state = body.state;
    view.queryOnly = ACTIVE.has(body.state);
    if (!view.queryOnly) attempts.delete(comparisonKey(view.identity.code));
    view.note.textContent = `${view.identity.code} · ${LABELS[body.state]}`;
    render(view);
  }

  async function query(view, method = 'GET') {
    if (!alive(view) || view.busy) return;
    const config = configuration();
    if (!config) { configure(); return; }
    view.busy = true;
    if (method === 'POST') {
      attempts.add(comparisonKey(view.identity.code));
      view.queryOnly = true;
      view.note.textContent = `${view.identity.code} · 正在交给 Peach`;
    }
    render(view);
    const deadline = Date.now() + 120_000;
    try {
      let body = await request(config, view.identity.code, view.identity.source, method);
      if (!alive(view)) return;
      applyState(view, body);
      for (let count = 0; ACTIVE.has(body.state) && count < 30 && Date.now() < deadline; count++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!alive(view)) return;
        body = await request(config, view.identity.code, view.identity.source, 'GET');
        if (!alive(view)) return;
        applyState(view, body);
      }
      if (ACTIVE.has(body.state)) view.note.textContent = `${view.identity.code} · 任务仍在继续，可查询状态。`;
    } catch (error) {
      if (alive(view)) {
        view.queryOnly = true;
        view.note.textContent = error.message;
      }
    } finally {
      if (alive(view)) { view.busy = false; render(view); }
    }
  }

  function refresh() {
    const item = identity();
    const key = `${location.href}|${item?.code || ''}|${Boolean(item?.conflict)}`;
    if (key === pageKey && (!item || current?.root.isConnected)) return;
    pageKey = key;
    generation++;
    current?.root.remove();
    current = null;
    if (!item || !document.body) return;
    // Shadow DOM 隔离宿主样式；凭据只保留在 GM 存储与请求闭包中。
    document.getElementById(ROOT_ID)?.remove();
    const root = document.createElement('aside');
    root.id = ROOT_ID;
    root.setAttribute('aria-label', 'Peach 入库');
    const shadow = root.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px);font:400 14px/1.5 system-ui;color:#171717}section{background:#fff;border:1px solid #ccc;border-radius:8px;padding:12px;max-width:300px;box-shadow:0 2px 12px #0002}button{font:500 14px/1.5 system-ui;color:#fff;background:#171717;border:1px solid #171717;border-radius:6px;padding:8px 12px;cursor:pointer}button:hover{background:#333}button:focus-visible{outline:2px solid #2563eb;outline-offset:3px}button:disabled,button[aria-disabled=true]{color:#666;background:#eee;border-color:#ccc;cursor:default}p{margin:8px 0 0;overflow-wrap:anywhere}`;
    const panel = document.createElement('section');
    const button = document.createElement('button');
    button.type = 'button';
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    panel.append(button, note);
    shadow.append(style, panel);
    document.body.append(root);
    const view = { root, button, note, identity: item, url: location.href, generation, state: 'idle', busy: false, queryOnly: attempts.has(comparisonKey(item.code)) };
    current = view;
    note.textContent = item.conflict ? '页面身份不一致，请核对番号。' : `${item.code} · ${configuration() ? '正在查询 Peach' : '请先配置 Peach 地址与令牌。'}`;
    button.addEventListener('click', () => {
      if (!alive(view) || view.busy || view.button.disabled) return;
      if (!configuration()) { configure(); return; }
      void query(view, view.queryOnly || ACTIVE.has(view.state) ? 'GET' : 'POST');
    });
    render(view);
    if (!item.conflict && configuration()) void query(view);
  }

  const schedule = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 100);
  };
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  addEventListener('popstate', schedule);
  addEventListener('hashchange', schedule);
  const navigated = () => {
    generation++;
    pageKey = '';
    selected = null;
    schedule();
  };
  addEventListener('urlchange', navigated);
  globalThis.navigation?.addEventListener('navigate', navigated);
  // 用户脚本沙箱无需替换页面的 History API。
  setInterval(refresh, 750);
  refresh();
})();
