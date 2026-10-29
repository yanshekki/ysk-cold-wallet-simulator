import { slugLedgerApp, stableVersionList } from '@cws/contracts';

const READ_ERROR = 'Manager app versions could not be read';

function skipWs(text: string, i: number): number {
  const n = text.length;
  while (i < n && text.charCodeAt(i) <= 32) {
    i += 1;
  }
  return i;
}

function fail(): never {
  throw new Error(READ_ERROR);
}

function skipString(text: string, i: number): number {
  if (text.charCodeAt(i) !== 34) {
    fail();
  }
  const n = text.length;
  i += 1;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === 92) {
      i += 2;
      continue;
    }
    if (code === 34) {
      return i + 1;
    }
    i += 1;
  }
  fail();
}

function readString(text: string, i: number): { value: string; i: number } {
  const end = skipString(text, i);
  return { value: JSON.parse(text.slice(i, end)) as string, i: end };
}

function skipContainer(text: string, i: number): number {
  const open = text.charCodeAt(i);
  const close = open === 123 ? 125 : 93;
  if (open !== 123 && open !== 91) {
    fail();
  }
  let depth = 0;
  const n = text.length;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === 34) {
      i = skipString(text, i);
      continue;
    }
    if (code === open) {
      depth += 1;
    } else if (code === close) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
    i += 1;
  }
  fail();
}

function skipValue(text: string, i: number): number {
  i = skipWs(text, i);
  const code = text.charCodeAt(i);
  if (code === 34) {
    return skipString(text, i);
  }
  if (code === 123 || code === 91) {
    return skipContainer(text, i);
  }
  if (text.startsWith('true', i)) {
    return i + 4;
  }
  if (text.startsWith('false', i)) {
    return i + 5;
  }
  if (text.startsWith('null', i)) {
    return i + 4;
  }
  if (code === 45 || (code >= 48 && code <= 57)) {
    let j = i + 1;
    while (j < text.length) {
      const next = text.charCodeAt(j);
      const digit = next >= 48 && next <= 57;
      const mark = next === 43 || next === 45 || next === 46 || next === 69 || next === 101;
      if (!digit && !mark) {
        break;
      }
      j += 1;
    }
    return j;
  }
  fail();
}

function readIntArray(text: string, i: number): { value: number[] | null; i: number } {
  i = skipWs(text, i);
  if (text[i] !== '[') {
    return { value: null, i: skipValue(text, i) };
  }
  i += 1;
  const value: number[] = [];
  while (true) {
    i = skipWs(text, i);
    if (text[i] === ']') {
      return { value, i: i + 1 };
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    const start = i;
    if (text[i] === '-') {
      i += 1;
    }
    const digits = i;
    while (i < text.length && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) {
      i += 1;
    }
    if (i === digits) {
      fail();
    }
    value.push(Number.parseInt(text.slice(start, i), 10));
    i = skipWs(text, i);
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    if (text[i] === ']') {
      return { value, i: i + 1 };
    }
    fail();
  }
}

function readVersionObject(
  text: string,
  i: number,
  deviceVersionId: number,
  provider: number,
): { version: string | undefined; i: number } {
  if (text[i] !== '{') {
    fail();
  }
  i += 1;
  let version = '';
  let devices: number[] | null = null;
  let providers: number[] | null = null;
  while (true) {
    i = skipWs(text, i);
    if (text[i] === '}') {
      const keep =
        version.length > 0 &&
        (devices?.includes(deviceVersionId) ?? false) &&
        (providers?.includes(provider) ?? false);
      return { version: keep ? version : undefined, i: i + 1 };
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    const key = readString(text, i);
    i = skipWs(text, key.i);
    if (text[i] !== ':') {
      fail();
    }
    i = skipWs(text, i + 1);
    if (key.value === 'version') {
      const parsed = readString(text, i);
      version = parsed.value.trim();
      i = parsed.i;
    } else if (key.value === 'device_versions') {
      const parsed = readIntArray(text, i);
      devices = parsed.value;
      i = parsed.i;
    } else if (key.value === 'providers') {
      const parsed = readIntArray(text, i);
      providers = parsed.value;
      i = parsed.i;
    } else {
      i = skipValue(text, i);
    }
  }
}

function readVersionArray(
  text: string,
  i: number,
  deviceVersionId: number,
  provider: number,
): { versions: string[]; i: number } {
  i = skipWs(text, i);
  if (text[i] !== '[') {
    return { versions: [], i: skipValue(text, i) };
  }
  i += 1;
  const versions: string[] = [];
  while (true) {
    i = skipWs(text, i);
    if (text[i] === ']') {
      return { versions, i: i + 1 };
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    const row = readVersionObject(text, i, deviceVersionId, provider);
    i = row.i;
    if (row.version) {
      versions.push(row.version);
    }
  }
}

function readApp(
  text: string,
  i: number,
  deviceVersionId: number,
  provider: number,
): { name: string; versions: string[]; i: number } {
  if (text[i] !== '{') {
    fail();
  }
  i += 1;
  let name = '';
  let versions: string[] = [];
  while (true) {
    i = skipWs(text, i);
    if (text[i] === '}') {
      return { name, versions, i: i + 1 };
    }
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    const key = readString(text, i);
    i = skipWs(text, key.i);
    if (text[i] !== ':') {
      fail();
    }
    i = skipWs(text, i + 1);
    if (key.value === 'name') {
      const parsed = readString(text, i);
      name = parsed.value.trim();
      i = parsed.i;
    } else if (key.value === 'application_versions') {
      const parsed = readVersionArray(text, i, deviceVersionId, provider);
      versions = parsed.versions;
      i = parsed.i;
    } else {
      i = skipValue(text, i);
    }
  }
}

/**
 * Walk Ledger's `/api/applications` document without building the full object
 * graph. The payload is tens of megabytes; only name, version, device, and
 * provider are kept.
 */
export function scanApplicationVersions(
  text: string,
  deviceVersionId: number,
  provider = 1,
): Record<string, string[]> {
  if (!Number.isInteger(deviceVersionId) || deviceVersionId <= 0) {
    throw new Error('Manager device version was empty');
  }
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }
  let i = skipWs(body, 0);
  if (body[i] !== '[') {
    fail();
  }
  i += 1;
  const buckets = new Map<string, string[]>();
  while (true) {
    i = skipWs(body, i);
    if (body[i] === ']') {
      break;
    }
    if (body[i] === ',') {
      i += 1;
      continue;
    }
    const app = readApp(body, i, deviceVersionId, provider);
    i = app.i;
    if (!app.name || app.versions.length === 0) {
      continue;
    }
    const id = slugLedgerApp(app.name);
    const prev = buckets.get(id) ?? [];
    buckets.set(id, stableVersionList([...prev, ...app.versions]));
  }
  return Object.fromEntries(buckets);
}
