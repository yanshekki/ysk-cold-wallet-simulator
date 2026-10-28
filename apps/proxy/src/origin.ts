const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function hostnameOfHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 1 ? value.slice(1, end) : '';
  }
  return value.split(':')[0] ?? '';
}

export function loopbackHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  return LOOPBACK.has(hostnameOfHost(host));
}

export function loopbackOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  try {
    return LOOPBACK.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Browser-set site. Absent means a non-browser client on the machine. */
export function browserSiteAllowed(site: string | undefined): boolean {
  if (!site) {
    return true;
  }
  return site === 'same-origin' || site === 'none';
}

export function mutationAllowed(headers: {
  host?: string;
  origin?: string;
  'sec-fetch-site'?: string;
  'x-cws-proxy'?: string;
}): boolean {
  return (
    loopbackHost(headers.host) &&
    loopbackOrigin(headers.origin) &&
    browserSiteAllowed(headers['sec-fetch-site']) &&
    headers['x-cws-proxy'] === '1'
  );
}
