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
    waiting: 'Waiting for log lines',
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
    waiting: '等待紀錄',
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

function $(id) {
  return document.getElementById(id);
}

function pad(value) {
  return String(value).padStart(2, '0');
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
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function loadLang() {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'zh-HK' ? 'zh-HK' : 'en';
}

const state = {
  lang: loadLang(),
  status: null,
  startedAt: 0,
};

function t(key) {
  return COPY[state.lang][key];
}

function renderCopy() {
  $('kicker').textContent = t('kicker');
  $('title').textContent = t('title');
  $('subtitle').textContent = t('subtitle');
  $('start').textContent = t('start');
  $('stop').textContent = t('stop');
  $('pair').textContent = t('pairingSubmit');
  $('pairing-label').textContent = t('pairing');
  $('logs-label').textContent = t('logs');
  $('label-phone').textContent = t('phone');
  $('label-uuid').textContent = t('uuid');
  $('label-vid').textContent = t('vid');
  $('label-mtu').textContent = t('mtu');
  $('label-hid').textContent = t('hidLabel');
  $('label-trezord').textContent = t('trezord');
  $('lang-en').classList.toggle('on', state.lang === 'en');
  $('lang-zh').classList.toggle('on', state.lang === 'zh-HK');
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
  $('start').disabled = status.running;
  $('stop').disabled = !status.running;
  const logs = $('logs');
  logs.replaceChildren();
  if (!status.logs.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = t('waiting');
    logs.append(empty);
    return;
  }
  for (const line of status.logs) {
    const item = document.createElement('li');
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = formatTime(line.at);
    item.append(ts, document.createTextNode(line.line));
    logs.append(item);
  }
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
  source.onerror = () => {
    $('clock').textContent = 'IDLE';
  };
}

$('start').addEventListener('click', () => {
  void post('/start');
});
$('stop').addEventListener('click', () => {
  void post('/stop');
});
$('pair').addEventListener('click', () => {
  void post('/pairing', { code: $('code').value });
});
$('code').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    void post('/pairing', { code: $('code').value });
  }
});
$('lang-en').addEventListener('click', () => {
  state.lang = 'en';
  localStorage.setItem(LANG_KEY, 'en');
  renderCopy();
});
$('lang-zh').addEventListener('click', () => {
  state.lang = 'zh-HK';
  localStorage.setItem(LANG_KEY, 'zh-HK');
  renderCopy();
});

setInterval(() => {
  if (state.status) {
    $('clock').textContent = formatClock(state.status.running, state.startedAt, Date.now());
  }
}, 1000);

renderCopy();
connect();
