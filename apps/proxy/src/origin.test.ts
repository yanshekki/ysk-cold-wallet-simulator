import { describe, expect, it } from 'vitest';
import { browserSiteAllowed, loopbackHost, loopbackOrigin, mutationAllowed } from './origin';

describe('proxy control-plane origin', () => {
  it('accepts loopback hosts only', () => {
    expect(loopbackHost('127.0.0.1:8788')).toBe(true);
    expect(loopbackHost('localhost:8788')).toBe(true);
    expect(loopbackHost('[::1]:8788')).toBe(true);
    expect(loopbackHost('evil.example:8788')).toBe(false);
    expect(loopbackHost(undefined)).toBe(false);
  });

  it('treats a missing origin as local and rejects a public origin', () => {
    expect(loopbackOrigin(undefined)).toBe(true);
    expect(loopbackOrigin('http://127.0.0.1:8788')).toBe(true);
    expect(loopbackOrigin('https://rabby.io')).toBe(false);
  });

  it('blocks cross-site and same-site browser posts', () => {
    expect(browserSiteAllowed(undefined)).toBe(true);
    expect(browserSiteAllowed('same-origin')).toBe(true);
    expect(browserSiteAllowed('none')).toBe(true);
    expect(browserSiteAllowed('cross-site')).toBe(false);
    expect(browserSiteAllowed('same-site')).toBe(false);
  });

  it('requires the proxy header on loopback same-origin mutations', () => {
    const ok = {
      host: '127.0.0.1:8788',
      origin: 'http://127.0.0.1:8788',
      'sec-fetch-site': 'same-origin',
      'x-cws-proxy': '1',
    };
    expect(mutationAllowed(ok)).toBe(true);
    expect(mutationAllowed({ ...ok, 'x-cws-proxy': undefined })).toBe(false);
    expect(mutationAllowed({ ...ok, 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(mutationAllowed({ ...ok, host: 'evil.example:8788' })).toBe(false);
    expect(mutationAllowed({ ...ok, origin: 'chrome-extension://rabby' })).toBe(false);
  });
});
