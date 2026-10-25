import './styles.css';
import type { Brand } from '@cws/contracts';
import { formatError } from './ble';
import { LAB_ACTIONS, type LabAction, type LabDraft } from './cases';
import { looksLikeBrave } from './gatt';
import { LabHost } from './host';
import { t, type CopyKey, type LabLang } from './i18n';
import { NEAR_FAUCET } from './rpc';

const LANG_KEY = 'cws-lab-lang';
const BRAND_KEY = 'cws-lab-brand';
const SECTION_KEY = 'cws-lab-section';

const BRANDS: Brand[] = ['ledger', 'onekey', 'trezor'];
const SECTIONS: Record<Brand, CopyKey[]> = {
  ledger: ['dashboard', 'ethereum', 'solana', 'near', 'bitcoin', 'avalanche', 'family'],
  onekey: ['onekey', 'ethereum', 'bitcoin', 'solana', 'near', 'family'],
  trezor: ['trezor', 'ethereum', 'bitcoin', 'solana', 'family'],
};

const logs: Array<{ dir: 'in' | 'out' | 'err'; line: string }> = [];
let lang: LabLang = loadLang();
let selectedBrand: Brand = loadBrand();
let selectedSection: CopyKey = loadSection(selectedBrand);
let busy = false;
let lastStatus = { text: '', error: false };
let editor: { action: LabAction; draft: LabDraft } | null = null;
let pairing: { code: string; resolve: (value: string) => void } | null = null;

const host = new LabHost(
  (dir, note, hex) => {
    const line = hex ? `${note}  ${hex}` : note;
    logs.push({ dir, line });
    renderLog();
  },
  () =>
    new Promise<string>((resolve) => {
      pairing = { code: '', resolve };
      render();
    }),
);

function loadLang(): LabLang {
  return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh-HK';
}

function loadBrand(): Brand {
  const value = localStorage.getItem(BRAND_KEY);
  return value === 'onekey' || value === 'trezor' || value === 'ledger' ? value : 'ledger';
}

function loadSection(brand: Brand): CopyKey {
  const stored = localStorage.getItem(SECTION_KEY) as CopyKey | null;
  const sections = SECTIONS[brand];
  return stored && sections.includes(stored) ? stored : sections[0];
}

function setLang(next: LabLang): void {
  lang = next;
  localStorage.setItem(LANG_KEY, next);
  render();
}

function setBrand(brand: Brand): void {
  if (host.connected) {
    return;
  }
  selectedBrand = brand;
  localStorage.setItem(BRAND_KEY, brand);
  selectedSection = loadSection(brand);
  render();
}

function setSection(section: CopyKey): void {
  selectedSection = section;
  localStorage.setItem(SECTION_KEY, section);
  render();
}

function renderLog(): void {
  const node = document.getElementById('log');
  if (!node) {
    return;
  }
  node.textContent = '';
  for (const entry of logs.slice(-200)) {
    const row = document.createElement('div');
    row.className = entry.dir === 'err' ? 'log-err' : entry.dir === 'out' ? 'log-out' : 'log-in';
    row.textContent = entry.line;
    node.append(row);
  }
  node.scrollTop = node.scrollHeight;
}

function setStatus(text: string, isError = false): void {
  lastStatus = { text, error: isError };
  const node = document.getElementById('status');
  if (!node) {
    return;
  }
  node.className = isError ? 'status error' : 'status';
  node.replaceChildren();
  const label = document.createElement('strong');
  label.textContent = text;
  node.append(label);
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.replaceChildren();
  if (host.connected && host.brand) {
    selectedBrand = host.brand;
  }

  const shell = document.createElement('div');
  shell.className = 'shell';

  const top = document.createElement('div');
  top.className = 'top';
  const titles = document.createElement('div');
  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  kicker.textContent = t(lang, 'kicker');
  const heading = document.createElement('h1');
  heading.textContent = t(lang, 'title');
  titles.append(kicker, heading);
  const langRow = document.createElement('div');
  langRow.className = 'row';
  langRow.append(
    button(t(lang, 'langEn'), () => setLang('en'), lang === 'en' ? 'primary' : undefined),
    button(t(lang, 'langZh'), () => setLang('zh-HK'), lang === 'zh-HK' ? 'primary' : undefined),
  );
  top.append(titles, langRow);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = t(lang, 'hint');

  const brands = document.createElement('div');
  brands.className = 'brand-bar';
  for (const brand of BRANDS) {
    const label =
      brand === 'ledger' ? t(lang, 'connectLedger') : brand === 'onekey' ? t(lang, 'connectOneKey') : t(lang, 'connectTrezor');
    const btn = button(label, () => setBrand(brand), brand === selectedBrand ? 'primary' : undefined);
    btn.disabled = busy || host.connected;
    brands.append(btn);
  }

  const actions = document.createElement('div');
  actions.className = 'row';
  const connectBtn = button(t(lang, 'connect'), () => void onConnect(selectedBrand), 'primary');
  connectBtn.disabled = busy || host.connected;
  const scanAllBtn = button(t(lang, 'connectAny'), () => void onConnect(selectedBrand, true));
  scanAllBtn.disabled = busy || host.connected;
  const disconnectBtn = button(t(lang, 'disconnect'), () => onDisconnect(), 'danger');
  disconnectBtn.disabled = busy || !host.connected;
  actions.append(connectBtn, scanAllBtn, disconnectBtn);

  const status = document.createElement('p');
  status.id = 'status';
  const fallback = host.connected
    ? `${t(lang, 'connected')} · ${host.brand ?? ''} · ${host.deviceName}`
    : t(lang, 'idle');
  const statusText = lastStatus.text || fallback;
  status.className = lastStatus.error ? 'status error' : 'status';
  const statusLabel = document.createElement('strong');
  statusLabel.textContent = statusText;
  status.append(statusLabel);

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const sections = SECTIONS[selectedBrand];
  if (!sections.includes(selectedSection)) {
    selectedSection = sections[0];
  }
  for (const section of sections) {
    const tab = button(t(lang, section), () => setSection(section), section === selectedSection ? 'primary' : undefined);
    tabs.append(tab);
  }

  const catalog = document.createElement('section');
  catalog.className = 'catalog';
  const heading2 = document.createElement('h2');
  heading2.textContent = t(lang, selectedSection);
  const net = document.createElement('div');
  net.className = 'net';
  if (selectedSection === 'near') {
    const link = document.createElement('a');
    link.href = NEAR_FAUCET;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = t(lang, 'faucet');
    net.append(link);
  }
  const grid = document.createElement('div');
  grid.className = 'action-grid';
  for (const action of LAB_ACTIONS.filter((item) => item.brand === selectedBrand && item.section === selectedSection)) {
    grid.append(actionRow(action));
  }
  catalog.append(heading2);
  if (net.childNodes.length) {
    catalog.append(net);
  }
  catalog.append(grid);

  const logDock = document.createElement('div');
  logDock.className = 'log-dock';
  const logHead = document.createElement('div');
  logHead.className = 'log-head';
  const logTitle = document.createElement('h2');
  logTitle.className = 'kicker';
  logTitle.textContent = t(lang, 'logs');
  logHead.append(
    logTitle,
    button(t(lang, 'clear'), () => {
      logs.length = 0;
      renderLog();
    }),
  );
  const log = document.createElement('div');
  log.id = 'log';
  logDock.append(logHead, log);

  shell.append(top, hint, brands, actions, status, tabs, catalog);
  app.append(shell, logDock);
  renderLog();

  if (editor) {
    app.append(editorModal(editor.action, editor.draft));
  }
  if (pairing) {
    app.append(pairingModal());
  }
}

function actionRow(action: LabAction): HTMLElement {
  const row = document.createElement('div');
  row.className = 'action';
  const btn = button(lang === 'zh-HK' ? action.zh : action.en, () => void onAction(action.id));
  btn.disabled = busy || !host.connected;
  row.append(btn);
  const note = lang === 'zh-HK' ? action.noteZh : action.noteEn;
  if (note) {
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = note;
    row.append(meta);
  }
  return row;
}

function editorModal(action: LabAction, draft: LabDraft): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const card = document.createElement('div');
  card.className = 'modal-card';
  const title = document.createElement('h2');
  title.textContent = t(lang, 'editor');
  card.append(title);
  const fields = action.editor ?? {};
  if (fields.path !== undefined) {
    card.append(field(t(lang, 'path'), draft.path, (value) => {
      draft.path = value;
    }));
  }
  if (fields.utf8 !== undefined) {
    card.append(field(t(lang, 'utf8'), draft.utf8, (value) => {
      draft.utf8 = value;
    }, true));
  }
  if (fields.hex !== undefined) {
    card.append(field(t(lang, 'hex'), draft.hex, (value) => {
      draft.hex = value;
    }, true));
  }
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    button(t(lang, 'run'), () => void runAction(action, draft), 'primary'),
    button(lang === 'zh-HK' ? '關閉' : 'Close', () => {
      editor = null;
      render();
    }),
  );
  card.append(row);
  overlay.append(card);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      editor = null;
      render();
    }
  });
  return overlay;
}

function pairingModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const card = document.createElement('div');
  card.className = 'modal-card';
  const title = document.createElement('h2');
  title.textContent = t(lang, 'pairing');
  const input = document.createElement('input');
  input.value = pairing?.code ?? '';
  input.inputMode = 'numeric';
  input.maxLength = 6;
  input.autocomplete = 'one-time-code';
  input.addEventListener('input', () => {
    if (pairing) {
      pairing.code = input.value;
    }
  });
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    button(t(lang, 'pairingSubmit'), () => {
      if (!pairing) {
        return;
      }
      const resolve = pairing.resolve;
      const code = pairing.code;
      pairing = null;
      resolve(code);
      render();
    }, 'primary'),
  );
  card.append(title, input, row);
  overlay.append(card);
  return overlay;
}

function field(label: string, value: string, onChange: (value: string) => void, area = false): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const name = document.createElement('span');
  name.textContent = label;
  wrap.append(name);
  if (area) {
    const input = document.createElement('textarea');
    input.value = value;
    input.rows = 4;
    input.addEventListener('input', () => onChange(input.value));
    wrap.append(input);
  } else {
    const input = document.createElement('input');
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    wrap.append(input);
  }
  return wrap;
}

function button(label: string, onClick: () => void, variant?: 'primary' | 'danger'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (variant) {
    btn.className = variant;
  }
  btn.addEventListener('click', onClick);
  return btn;
}

async function onConnect(brand: Brand, acceptAll = false): Promise<void> {
  if (busy || host.connected) {
    return;
  }
  busy = true;
  try {
    await host.connect(brand, acceptAll || looksLikeBrave());
    selectedBrand = brand;
    localStorage.setItem(BRAND_KEY, brand);
    setStatus(`${t(lang, 'connected')} · ${host.deviceName}`);
  } catch (error) {
    const message = friendlyError(error);
    logs.push({ dir: 'err', line: message });
    setStatus(message, true);
  } finally {
    busy = false;
    render();
  }
}

function onDisconnect(): void {
  host.disconnect();
  render();
}

async function onAction(id: string): Promise<void> {
  const action = LAB_ACTIONS.find((item) => item.id === id);
  if (!action || !host.connected) {
    return;
  }
  if (action.editor) {
    editor = {
      action,
      draft: {
        path: action.editor.path ?? '',
        utf8: action.editor.utf8 ?? '',
        hex: action.editor.hex ?? '',
      },
    };
    render();
    return;
  }
  await runAction(action, { path: '', utf8: '', hex: '' });
}

async function runAction(action: LabAction, draft: LabDraft): Promise<void> {
  editor = null;
  busy = true;
  render();
  setStatus(t(lang, 'busy'));
  try {
    const result = await action.run(host, draft);
    logs.push({ dir: 'out', line: result });
    setStatus(result);
  } catch (error) {
    const message = friendlyError(error);
    logs.push({ dir: 'err', line: message });
    setStatus(message, true);
  } finally {
    busy = false;
    render();
  }
}

function friendlyError(error: unknown): string {
  const message = formatError(error);
  if (/timeout/i.test(message)) {
    return t(lang, 'timeout');
  }
  if (/Insecure origin/i.test(message)) {
    return t(lang, 'insecure');
  }
  if (/Brave Web Bluetooth disabled/i.test(message)) {
    return t(lang, 'braveBluetooth');
  }
  if (/Web Bluetooth is not available/i.test(message)) {
    return looksLikeBrave() ? t(lang, 'braveBluetooth') : t(lang, 'bluetoothMissing');
  }
  if (/GATT|No matching GATT|NetworkError/i.test(message)) {
    return t(lang, 'gattBusy');
  }
  if (/user gesture/i.test(message)) {
    return t(lang, 'userGesture');
  }
  return message;
}

render();
