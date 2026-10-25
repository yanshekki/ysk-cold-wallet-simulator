const COPY = {
  en: {
    kicker: '/ PROXY',
    title: 'CWS',
    subtitle: 'This page starts the USB-to-BLE proxy. The phone is still the hardware wallet.',
    start: 'Start',
    stop: 'Stop',
    idle: 'Waiting to scan',
    scanning: 'Scanning for the phone',
    connecting: 'Connecting GATT',
    gatt: 'BLE GATT up',
    hid: 'Virtual HID up',
    error: 'Error',
    hidIdle: 'idle',
    hidUp: 'up',
    hidSkipped: 'skipped',
    hidFailed: 'failed',
    pairing: 'Enter the 6-digit pairing code shown on the phone',
    pairingSubmit: 'Pair',
    logs: 'Console',
    tabProxy: 'Proxy',
    tabConsole: 'Console',
    waiting: 'Waiting for host… start the proxy.',
    search: 'Search',
    all: 'ALL',
    wrap: 'WRAP',
    follow: 'FOLLOW',
    prev: 'Prev',
    next: 'Next',
    copyLine: 'Copy line',
    copyMatch: 'Copy match',
    copyAll: 'Copy all',
    export: 'Export',
    clear: 'Clear',
    latest: 'Latest',
    copied: 'Copied',
    phone: 'GAP name',
    uuid: 'Service UUID',
    vid: 'VID / PID',
    mtu: 'MTU',
    hidLabel: 'HID',
    trezord: 'trezord',
    noPhone: 'NO PHONE',
    nativeMissing: 'Native radio is not built. Run yarn workspace @cws/native-proxy build.',
  },
  'zh-HK': {
    kicker: '/ 代理',
    title: 'CWS',
    subtitle: '此頁啟動 USB 至藍牙代理。簽署仍在電話確認。',
    start: '開始',
    stop: '停止',
    idle: '尚未掃描',
    scanning: '正在掃描電話',
    connecting: '正在連接 GATT',
    gatt: 'BLE GATT 已連接',
    hid: '虛擬 HID 已就緒',
    error: '錯誤',
    hidIdle: '閒置',
    hidUp: '已就緒',
    hidSkipped: '已跳過',
    hidFailed: '失敗',
    pairing: '輸入電話顯示的 6 位配對碼',
    pairingSubmit: '配對',
    logs: '紀錄',
    tabProxy: '代理',
    tabConsole: '紀錄',
    waiting: '等緊 host… 撳 Start 開 proxy。',
    search: '搜尋',
    all: '全部',
    wrap: '換行',
    follow: '跟隨',
    prev: '上一筆',
    next: '下一筆',
    copyLine: '複製行',
    copyMatch: '複製符合',
    copyAll: '複製全部',
    export: '匯出',
    clear: '清除',
    latest: '最新',
    copied: '已複製',
    phone: '廣播名稱',
    uuid: 'Service UUID',
    vid: 'VID / PID',
    mtu: 'MTU',
    hidLabel: 'HID',
    trezord: 'trezord',
    noPhone: '無電話',
    nativeMissing: '尚未編譯原生模組。請執行 yarn workspace @cws/native-proxy build。',
  },
};

const BRAND_LABEL = {
  ledger: 'Ledger',
  trezor: 'Trezor',
  onekey: 'OneKey',
};

const HID_COPY = {
  idle: 'hidIdle',
  up: 'hidUp',
  skipped: 'hidSkipped',
  failed: 'hidFailed',
};

const PHASE_COPY = {
  idle: 'idle',
  scanning: 'scanning',
  connecting: 'connecting',
  gatt: 'gatt',
  hid: 'hid',
  error: 'error',
};

const LANG_KEY = 'cws-proxy-lang';
const LOG_FONT_MIN = 10;
const LOG_FONT_MAX = 16;

function $(id) {
  return document.getElementById(id);
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function formatClock(running, startedAt, now) {
  if (!running || !startedAt) {
    return 'IDLE';
  }
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function formatHex(value) {
  return `0x${value.toString(16)}`;
}

function formatTime(at) {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function loadLang() {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'zh-HK' ? 'zh-HK' : 'en';
}

function inferChannel(line) {
  const text = line.toLowerCase();
  if (/\bfail|error|not privileged|aborted/.test(text)) {
    return 'error';
  }
  if (text.includes('hid')) {
    return 'hid';
  }
  if (text.includes('gatt') || text.includes('notify') || text.includes('mtu=')) {
    return 'gatt';
  }
  if (text.includes('scan') || text.includes('found ') || text.includes('connecting') || text.includes('ble')) {
    return 'ble';
  }
  return 'app';
}

function buildMatcher(query, caseSensitive, regex) {
  if (!query) {
    return { test: () => true, source: null, flags: 'g', error: null };
  }
  try {
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(source, flags);
    return {
      test: (text) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
      },
      source,
      flags,
      error: null,
    };
  } catch {
    return { test: () => false, source: null, flags: 'g', error: 'Invalid regex' };
  }
}

function paint(text, highlight) {
  const frag = document.createDocumentFragment();
  if (!highlight) {
    frag.append(text);
    return frag;
  }
  const flags = highlight.flags.includes('g') ? highlight.flags : `${highlight.flags}g`;
  const pattern = new RegExp(highlight.source, flags);
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > last) {
      frag.append(text.slice(last, match.index));
    }
    const hit = document.createElement('mark');
    hit.className = 'hit';
    hit.textContent = match[0];
    frag.append(hit);
    last = match.index + match[0].length;
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(text);
  }
  if (last < text.length) {
    frag.append(text.slice(last));
  }
  return frag;
}

function stepMatchIndex(current, count, delta) {
  if (count <= 0) {
    return 0;
  }
  return (current + delta + count * 10) % count;
}

const state = {
  lang: loadLang(),
  status: null,
  startedAt: 0,
  tab: 'proxy',
  filter: 'all',
  query: '',
  caseSensitive: false,
  regex: false,
  wrap: true,
  follow: true,
  fontSize: 12,
  matchIndex: 0,
};

function t(key) {
  return COPY[state.lang][key];
}

function visibleLogs(status) {
  const chronological = (status?.logs ?? []).slice().reverse();
  const filtered =
    state.filter === 'all'
      ? chronological
      : chronological.filter((entry) => inferChannel(entry.line) === state.filter);
  const matcher = buildMatcher(state.query, state.caseSensitive, state.regex);
  const searching = Boolean(state.query) && !matcher.error;
  const matched = searching ? filtered.filter((entry) => matcher.test(`${formatTime(entry.at)} ${entry.line}`)) : filtered;
  return { matcher, searching, filtered, matched, visible: searching ? matched : filtered };
}

function setTab(tab) {
  state.tab = tab;
  $('tab-proxy').classList.toggle('on', tab === 'proxy');
  $('tab-console').classList.toggle('on', tab === 'console');
  $('tab-proxy').setAttribute('aria-selected', tab === 'proxy' ? 'true' : 'false');
  $('tab-console').setAttribute('aria-selected', tab === 'console' ? 'true' : 'false');
  $('pane-proxy').classList.toggle('hidden', tab !== 'proxy');
  $('pane-console').classList.toggle('hidden', tab !== 'console');
  if (tab === 'console') {
    renderLogs();
  }
}

function renderCopy() {
  $('kicker').textContent = t('kicker');
  $('title').textContent = t('title');
  $('subtitle').textContent = t('subtitle');
  $('start').textContent = t('start');
  $('stop').textContent = t('stop');
  $('pair').textContent = t('pairingSubmit');
  $('pairing-label').textContent = t('pairing');
  $('tab-proxy').textContent = t('tabProxy');
  $('tab-console-label').textContent = t('tabConsole');
  $('filter-all').textContent = t('all');
  $('log-wrap').textContent = t('wrap');
  $('log-follow').textContent = t('follow');
  $('log-search').placeholder = t('search');
  $('log-prev').textContent = t('prev');
  $('log-next').textContent = t('next');
  $('log-copy-line').textContent = t('copyLine');
  $('log-copy-match').textContent = t('copyMatch');
  $('log-copy-all').textContent = t('copyAll');
  $('log-export').textContent = t('export');
  $('log-clear').textContent = t('clear');
  $('log-latest').textContent = t('latest');
  $('label-phone').textContent = t('phone');
  $('label-uuid').textContent = t('uuid');
  $('label-vid').textContent = t('vid');
  $('label-mtu').textContent = t('mtu');
  $('label-hid').textContent = t('hidLabel');
  $('label-trezord').textContent = t('trezord');
  $('lang-en')?.classList.toggle('on', state.lang === 'en');
  $('lang-zh')?.classList.toggle('on', state.lang === 'zh-HK');
  if (state.status) {
    renderStatus(state.status);
  }
}

function renderStatus(status) {
  state.status = status;
  if (status.running && !state.startedAt) {
    state.startedAt = Date.now();
  }
  if (!status.running) {
    state.startedAt = 0;
  }
  const live = status.radio !== 'IDLE';
  $('clock').textContent = formatClock(status.running, state.startedAt, Date.now());
  $('clock').classList.toggle('locked', !status.running);
  $('radio').textContent = status.radio;
  $('radio').parentElement.classList.toggle('on', live);
  $('pip').classList.toggle('on', live);
  $('host').textContent = status.phoneName || t('noPhone');
  const chip = $('chip');
  if (status.brand) {
    chip.textContent = BRAND_LABEL[status.brand] ?? status.brand;
    chip.classList.remove('hidden');
    chip.classList.toggle('on', live);
  } else {
    chip.classList.add('hidden');
  }
  const card = $('card');
  card.classList.remove('ledger', 'trezor', 'onekey');
  if (status.brand) {
    card.classList.add(status.brand);
  }
  $('brand').textContent = status.brand ? BRAND_LABEL[status.brand] ?? status.brand : '—';
  $('protocol').textContent = status.protocol ?? '';
  $('model').textContent = status.modelName ?? '—';
  $('phone').textContent = status.phoneName || '—';
  $('uuid').textContent = status.serviceUUID || '—';
  $('vidpid').textContent =
    status.vendorId != null && status.productId != null
      ? `${formatHex(status.vendorId)} / ${formatHex(status.productId)}`
      : '—';
  $('mtu').textContent = status.mtu != null ? String(status.mtu) : '—';
  $('hid').textContent = t(HID_COPY[status.hid] ?? 'hidIdle');
  const hidError = $('hid-error');
  if (status.hidError) {
    hidError.textContent = status.hidError;
    hidError.classList.remove('hidden');
  } else {
    hidError.classList.add('hidden');
  }
  const trezordRow = $('trezord-row');
  if (status.trezord) {
    trezordRow.classList.remove('hidden');
    $('trezord').textContent = status.trezord;
  } else {
    trezordRow.classList.add('hidden');
  }
  const phase = $('phase');
  const phaseKey = PHASE_COPY[status.phase] ?? 'idle';
  if (status.phase === 'error' && status.error) {
    phase.className = 'status error';
    phase.innerHTML = `<strong>${t('error')}</strong> ${status.error}`;
  } else if (!status.nativeOk) {
    phase.className = 'status error';
    phase.innerHTML = `<strong>${t('error')}</strong> ${t('nativeMissing')}`;
  } else {
    phase.className = 'status';
    phase.innerHTML = `<strong>${t(phaseKey)}</strong>`;
  }
  const pairing = $('pairing');
  pairing.classList.toggle('hidden', !status.pairing);
  pairing.hidden = !status.pairing;
  $('start').disabled = false;
  $('stop').disabled = false;
  const badge = $('log-badge');
  badge.textContent = String(status.logs.length);
  badge.classList.toggle('hidden', status.logs.length === 0);
  renderLogs();
}

function renderLogs() {
  const status = state.status;
  const logs = $('logs');
  const { matcher, searching, matched, visible } = visibleLogs(status);
  if (state.matchIndex >= visible.length) {
    state.matchIndex = 0;
  }
  $('log-count').textContent =
    matcher.error ?? (searching ? `${matched.length ? state.matchIndex + 1 : 0}/${matched.length}` : String(visible.length));
  $('log-wrap').classList.toggle('on', state.wrap);
  $('log-follow').classList.toggle('on', state.follow);
  $('log-case').classList.toggle('on', state.caseSensitive);
  $('log-regex').classList.toggle('on', state.regex);
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.classList.toggle('on', button.dataset.filter === state.filter);
  }
  $('log-prev').disabled = matched.length === 0;
  $('log-next').disabled = matched.length === 0;
  logs.replaceChildren();
  logs.style.fontSize = `${state.fontSize}px`;
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t('waiting');
    logs.append(empty);
    return;
  }
  const highlight = matcher.source ? new RegExp(matcher.source, matcher.flags) : null;
  visible.forEach((entry, index) => {
    const item = document.createElement('li');
    item.dataset.id = entry.id;
    if (!state.wrap) {
      item.classList.add('nowrap');
    }
    if (searching && index === state.matchIndex) {
      item.classList.add('active');
    }
    const gutter = document.createElement('span');
    gutter.className = 'gutter';
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = `${formatTime(entry.at)} `;
    const channel = document.createElement('span');
    const name = inferChannel(entry.line);
    channel.className = `channel ${name}`;
    channel.textContent = name.toUpperCase();
    gutter.append(ts, channel);
    const body = document.createElement('span');
    body.className = 'body';
    body.append(paint(entry.line, highlight));
    item.append(gutter, body);
    item.addEventListener('click', () => {
      void copyText(`${formatTime(entry.at)} ${entry.line}`);
    });
    logs.append(item);
  });
  if (searching && visible.length) {
    logs.children[state.matchIndex]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (state.follow) {
    logs.scrollTop = logs.scrollHeight;
  }
}

function formatLogText(entries) {
  return entries.map((entry) => `${formatTime(entry.at)} ${inferChannel(entry.line).toUpperCase()} ${entry.line}`).join('\n');
}

async function copyText(text) {
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function post(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
}

function connect() {
  const source = new EventSource('/events');
  source.onmessage = (event) => {
    try {
      renderStatus(JSON.parse(event.data));
    } catch {
      // ignore malformed frames
    }
  };
}

function bindCommand(id, path) {
  const button = $(id);
  let last = 0;
  const fire = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (event.type === 'click' && now - last < 300) {
      return;
    }
    last = now;
    void post(path);
  };
  button.addEventListener('pointerdown', fire);
  button.addEventListener('click', fire);
}

if (new URLSearchParams(location.search).get('native') === '1') {
  document.documentElement.classList.add('native-shell');
}

bindCommand('start', '/start');
bindCommand('stop', '/stop');
$('pair').addEventListener('click', () => {
  void post('/pairing', { code: $('code').value });
});
$('code').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void post('/pairing', { code: $('code').value });
  }
});
$('lang-en')?.addEventListener('click', () => {
  state.lang = 'en';
  localStorage.setItem(LANG_KEY, 'en');
  renderCopy();
});
$('lang-zh')?.addEventListener('click', () => {
  state.lang = 'zh-HK';
  localStorage.setItem(LANG_KEY, 'zh-HK');
  renderCopy();
});
$('tab-proxy').addEventListener('click', () => setTab('proxy'));
$('tab-console').addEventListener('click', () => setTab('console'));
for (const button of document.querySelectorAll('[data-filter]')) {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    state.matchIndex = 0;
    renderLogs();
  });
}
$('log-wrap').addEventListener('click', () => {
  state.wrap = !state.wrap;
  renderLogs();
});
$('log-follow').addEventListener('click', () => {
  state.follow = !state.follow;
  renderLogs();
});
$('log-case').addEventListener('click', () => {
  state.caseSensitive = !state.caseSensitive;
  state.matchIndex = 0;
  renderLogs();
});
$('log-regex').addEventListener('click', () => {
  state.regex = !state.regex;
  state.matchIndex = 0;
  renderLogs();
});
$('log-search').addEventListener('input', (event) => {
  state.query = event.target.value;
  state.matchIndex = 0;
  state.follow = false;
  renderLogs();
});
$('log-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    const { matched } = visibleLogs(state.status);
    if (!matched.length) {
      return;
    }
    state.follow = false;
    state.matchIndex = stepMatchIndex(state.matchIndex, matched.length, 1);
    renderLogs();
  }
});
$('log-prev').addEventListener('click', () => {
  const { matched } = visibleLogs(state.status);
  if (!matched.length) {
    return;
  }
  state.follow = false;
  state.matchIndex = stepMatchIndex(state.matchIndex, matched.length, -1);
  renderLogs();
});
$('log-next').addEventListener('click', () => {
  const { matched } = visibleLogs(state.status);
  if (!matched.length) {
    return;
  }
  state.follow = false;
  state.matchIndex = stepMatchIndex(state.matchIndex, matched.length, 1);
  renderLogs();
});
$('log-copy-line').addEventListener('click', () => {
  const { visible, searching } = visibleLogs(state.status);
  const entry = visible[searching ? state.matchIndex : visible.length - 1];
  void copyText(entry ? formatLogText([entry]) : '');
});
$('log-copy-match').addEventListener('click', () => {
  const { searching, matched } = visibleLogs(state.status);
  void copyText(searching ? formatLogText(matched) : '');
});
$('log-copy-all').addEventListener('click', () => {
  void copyText(formatLogText((state.status?.logs ?? []).slice().reverse()));
});
$('log-font-up').addEventListener('click', () => {
  state.fontSize = Math.min(LOG_FONT_MAX, state.fontSize + 1);
  renderLogs();
});
$('log-font-down').addEventListener('click', () => {
  state.fontSize = Math.max(LOG_FONT_MIN, state.fontSize - 1);
  renderLogs();
});
$('log-export').addEventListener('click', () => {
  downloadText('cws-proxy-console.txt', formatLogText((state.status?.logs ?? []).slice().reverse()));
});
$('log-clear').addEventListener('click', () => {
  void post('/logs/clear');
});
$('log-latest').addEventListener('click', () => {
  state.follow = true;
  renderLogs();
});
$('logs').addEventListener('scroll', () => {
  const logs = $('logs');
  const atBottom = logs.scrollTop + logs.clientHeight >= logs.scrollHeight - 64;
  if (!atBottom && state.follow) {
    state.follow = false;
    $('log-follow').classList.toggle('on', false);
  }
});

setInterval(() => {
  if (state.status) {
    $('clock').textContent = formatClock(state.status.running, state.startedAt, Date.now());
  }
}, 1000);

renderCopy();
connect();
