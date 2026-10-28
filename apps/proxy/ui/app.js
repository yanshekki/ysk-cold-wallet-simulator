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
  lab: null,
  labKey: '',
  labBrand: 'ledger',
  labSection: '',
  labBusy: false,
  labResult: '',
  labError: false,
  labEditor: null,
};

function t(key) {
  return (COPY[state.lang] ?? COPY.en)[key] ?? COPY.en[key] ?? key;
}

function labActionTitle(action) {
  return state.lang === 'zh-HK' ? action.zh : action.en;
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
  $('tab-lab').classList.toggle('on', tab === 'lab');
  $('tab-console').classList.toggle('on', tab === 'console');
  $('tab-proxy').setAttribute('aria-selected', tab === 'proxy' ? 'true' : 'false');
  $('tab-lab').setAttribute('aria-selected', tab === 'lab' ? 'true' : 'false');
  $('tab-console').setAttribute('aria-selected', tab === 'console' ? 'true' : 'false');
  $('pane-proxy').classList.toggle('hidden', tab !== 'proxy');
  $('pane-lab').classList.toggle('hidden', tab !== 'lab');
  $('pane-console').classList.toggle('hidden', tab !== 'console');
  if (tab === 'console') {
    renderLogs();
  }
  if (tab === 'lab') {
    void fetchLabCatalog();
  }
}

function renderCopy() {
  $('kicker').textContent = t('kicker');
  $('title').textContent = t('title');
  $('subtitle').textContent = t('subtitle');
  const langLabelEl = document.querySelector('.lang-label');
  if (langLabelEl) {
    langLabelEl.textContent = t('lang');
  }
  renderPower();
  $('pair').textContent = t('pairingSubmit');
  $('pairing-label').textContent = t('pairing');
  $('tab-proxy').textContent = t('tabProxy');
  $('tab-lab').textContent = t('tabLab');
  $('tab-console-label').textContent = t('tabConsole');
  $('lab-kicker').textContent = t('labKicker');
  $('lab-faucet').textContent = t('labFaucet');
  $('lab-run').textContent = t('labRun');
  $('lab-close').textContent = t('labClose');
  $('lab-label-path').textContent = t('labPath');
  $('lab-label-utf8').textContent = t('labUtf8');
  $('lab-label-hex').textContent = t('labHex');
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
  const langSelect = $('lang-select');
  if (langSelect) {
    langSelect.value = state.lang;
    langSelect.setAttribute('aria-label', t('lang'));
  }
  document.documentElement.lang = state.lang === 'zh-HK' ? 'zh-HK' : state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  if (state.status) {
    renderStatus(state.status);
  }
  renderLab();
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
  renderPower();
  maybeRefreshLab(status);
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
    headers: {
      'X-CWS-Proxy': '1',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    return response.json();
  }
  return undefined;
}

function renderPower() {
  const power = $('power');
  const running = Boolean(state.status?.running);
  power.textContent = running ? t('stop') : t('start');
  power.classList.toggle('primary', !running);
  power.classList.toggle('danger', running);
}

function bindPower() {
  const button = $('power');
  let last = 0;
  const fire = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (event.type === 'click' && now - last < 300) {
      return;
    }
    last = now;
    void post(state.status?.running ? '/stop' : '/start');
  };
  button.addEventListener('pointerdown', fire);
  button.addEventListener('click', fire);
}

function maybeRefreshLab(status) {
  const key = `${status.brand ?? ''}:${status.phase}:${status.running}:${status.labReady ? 1 : 0}:${status.hid ?? ''}`;
  if (key === state.labKey && state.lab) {
    renderLab();
    return;
  }
  state.labKey = key;
  void fetchLabCatalog();
}

function labBrandQuery() {
  return state.status?.brand || state.labBrand || 'ledger';
}

async function fetchLabCatalog() {
  try {
    const response = await fetch(`/lab/catalog?brand=${encodeURIComponent(labBrandQuery())}`);
    if (!response.ok) {
      return;
    }
    state.lab = await response.json();
  } catch {
    return;
  }
  if (state.lab?.brand) {
    state.labBrand = state.lab.brand;
  }
  const sections = state.lab?.sections ?? [];
  if (!sections.some((section) => section.id === state.labSection)) {
    state.labSection = sections[0]?.id ?? '';
  }
  renderLab();
}

function renderLab() {
  const catalog = state.lab;
  const ready = Boolean(catalog?.ready);
  const locked = Boolean(catalog?.connectedBrand);
  const status = $('lab-status');
  status.className = state.labBusy ? 'status busy' : ready ? 'status' : 'status error';
  const waitCopy = state.status?.running ? 'labWaitPhone' : 'labNeedGatt';
  const statusCopy = state.labBusy ? 'labRunning' : ready ? 'labReady' : waitCopy;
  status.innerHTML = `<strong>${t(statusCopy)}</strong>`;
  const brands = $('lab-brands');
  brands.replaceChildren();
  for (const brand of ['ledger', 'onekey', 'trezor']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = `lab-brand-${brand}`;
    button.textContent = BRAND_LABEL[brand];
    button.classList.toggle('on', (catalog?.brand ?? state.labBrand) === brand);
    button.disabled = locked && catalog?.connectedBrand !== brand;
    button.addEventListener('click', () => {
      if (locked) {
        return;
      }
      state.labBrand = brand;
      state.labSection = '';
      void fetchLabCatalog();
    });
    brands.append(button);
  }
  const sections = catalog?.sections ?? [];
  const nav = $('lab-sections');
  nav.replaceChildren();
  for (const section of sections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = `lab-section-${section.id}`;
    button.textContent = t(section.id) || section.id;
    button.classList.toggle('on', section.id === state.labSection);
    button.addEventListener('click', () => {
      state.labSection = section.id;
      renderLab();
    });
    nav.append(button);
  }
  const current = sections.find((section) => section.id === state.labSection) ?? sections[0];
  $('lab-section-title').textContent = current ? t(current.id) || current.id : '';
  const faucet = $('lab-net');
  const showFaucet = current?.id === 'near' && Boolean(catalog?.nearFaucet);
  faucet.classList.toggle('hidden', !showFaucet);
  if (showFaucet) {
    $('lab-faucet').href = catalog.nearFaucet;
  }
  const grid = $('lab-grid');
  grid.replaceChildren();
  for (const action of current?.actions ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.id;
    button.dataset.testid = `lab-action-${action.id}`;
    button.textContent = labActionTitle(action);
    button.disabled = !ready || state.labBusy;
    button.addEventListener('click', () => {
      if (action.editor) {
        openLabEditor(action);
        return;
      }
      void runLabAction(action.id);
    });
    grid.append(button);
  }
  const result = $('lab-result');
  if (state.labResult) {
    result.classList.toggle('hidden', false);
    result.classList.toggle('error', state.labError);
    result.textContent = state.labResult;
  } else {
    result.classList.add('hidden');
  }
  renderLabEditor();
}

function openLabEditor(action) {
  state.labEditor = {
    id: action.id,
    title: labActionTitle(action),
    editor: action.editor,
  };
  $('lab-input-path').value = action.editor.path ?? '';
  $('lab-input-utf8').value = action.editor.utf8 ?? '';
  $('lab-input-hex').value = action.editor.hex ?? '';
  renderLabEditor();
}

function closeLabEditor() {
  state.labEditor = null;
  renderLabEditor();
}

function renderLabEditor() {
  const modal = $('lab-modal');
  const editor = state.labEditor;
  if (!editor) {
    modal.classList.add('hidden');
    modal.hidden = true;
    return;
  }
  modal.classList.remove('hidden');
  modal.hidden = false;
  $('lab-modal-title').textContent = editor.title;
  $('lab-field-path').classList.toggle('hidden', editor.editor.path === undefined);
  $('lab-field-utf8').classList.toggle('hidden', editor.editor.utf8 === undefined);
  $('lab-field-hex').classList.toggle('hidden', editor.editor.hex === undefined);
  const run = $('lab-run');
  run.textContent = state.labBusy ? t('labRunning') : t('labRun');
  run.disabled = state.labBusy;
  run.classList.toggle('busy', state.labBusy);
}

async function runLabAction(actionId, draft) {
  if (state.labBusy) {
    return;
  }
  state.labBusy = true;
  state.labError = false;
  state.labResult = '';
  closeLabEditor();
  renderLab();
  try {
    const body = await post('/lab/run', { actionId, draft });
    if (body && body.ok) {
      state.labResult = body.result ?? '';
      state.labError = false;
    } else {
      state.labResult = body?.error ?? 'lab failed';
      state.labError = true;
    }
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    try {
      const parsed = JSON.parse(message);
      if (parsed && parsed.error) {
        message = parsed.error;
      }
    } catch {
      // keep raw
    }
    state.labResult = message;
    state.labError = true;
  } finally {
    state.labBusy = false;
    renderLab();
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

if (new URLSearchParams(location.search).get('native') === '1') {
  document.documentElement.classList.add('native-shell');
}

bindPower();
$('tab-lab').addEventListener('click', () => setTab('lab'));
$('lab-run').addEventListener('click', () => {
  if (state.labEditor) {
    void runLabAction(state.labEditor.id, {
      path: $('lab-input-path').value,
      utf8: $('lab-input-utf8').value,
      hex: $('lab-input-hex').value,
    });
  }
});
$('lab-close').addEventListener('click', closeLabEditor);
$('lab-modal').addEventListener('click', (event) => {
  if (event.target === $('lab-modal')) {
    closeLabEditor();
  }
});
$('pair').addEventListener('click', () => {
  void post('/pairing', { code: $('code').value });
});
$('code').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void post('/pairing', { code: $('code').value });
  }
});
$('lang-select')?.addEventListener('change', (event) => {
  const next = event.target.value;
  if (!isProxyLang(next)) {
    return;
  }
  state.lang = next;
  localStorage.setItem(LANG_KEY, next);
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
