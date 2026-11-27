// Guarded server-side fetch of a user-supplied URL (Phase 1B-1 recipe import).
//
// - http and https only; at most 3 redirects, each one checked again.
// - Private, loopback, link-local and other non-public addresses are refused.
//   The check runs inside the socket's DNS lookup, so the address that is
//   actually connected to is the one checked (no DNS-rebinding gap); IP
//   literals in the URL are checked before connecting.
// - Short timeout, response size cap, no cookies or credentials sent, and the
//   response's cookies are ignored.
// Test hook: RECIPE_IMPORT_TEST_ALLOW_ORIGINS (comma list of exact origins,
// e.g. http://127.0.0.1:4599) lets local test pages through, and is ignored
// when NODE_ENV is 'production'.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96],
  ['2001:db8::', 32], ['100::', 64], ['2001::', 23]]) blocked.addSubnet(a, p, 'ipv6');

function isBlockedAddress(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, 'ipv4');
  if (fam === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    if (/^::ffff:/i.test(ip)) return true;   // hex-form mapped addresses: refuse
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

class FetchRefused extends Error {
  constructor(message, code = 'refused') { super(message); this.code = code; this.statusCode = 400; }
}

function testAllowed(url) {
  if (process.env.NODE_ENV === 'production') return false;
  const allow = (process.env.RECIPE_IMPORT_TEST_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return allow.includes(url.origin);
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const bad = list.find(a => isBlockedAddress(a.address));
    if (bad || !list.length) return callback(new FetchRefused('That address is not allowed (private or local network)'));
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function requestOnce(url, { timeoutMs, maxBytes, allowLocal }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'RipFit recipe import', Accept: 'text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.5' },
      ...(allowLocal ? {} : { lookup: guardedLookup }),
      agent: false,
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        return resolve({ redirect: res.headers.location || null, status });
      }
      if (status < 200 || status >= 300) { res.resume(); return reject(new FetchRefused(`The page answered ${status}`, 'http_error')); }
      const len = Number(res.headers['content-length']);
      if (Number.isFinite(len) && len > maxBytes) { res.destroy(); return reject(new FetchRefused(`The page is larger than ${Math.round(maxBytes / 1024)} KB`, 'too_large')); }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); reject(new FetchRefused(`The page is larger than ${Math.round(maxBytes / 1024)} KB`, 'too_large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchRefused('The page took too long to answer', 'timeout')));
    req.on('error', (e) => reject(e instanceof FetchRefused ? e : new FetchRefused(e.code === 'ENOTFOUND' ? 'That address could not be found' : 'The page could not be fetched', 'network')));
    req.end();
  });
}

async function safeFetch(rawUrl, { timeoutMs = 5000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3 } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch (_) { throw new FetchRefused('url must be a full link (https://...)'); }
  const started = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchRefused('Only http and https links can be imported');
    if (url.username || url.password) throw new FetchRefused('Links with a user name or password are not allowed');
    const allowLocal = testAllowed(url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowLocal && net.isIP(host) && isBlockedAddress(host)) throw new FetchRefused('That address is not allowed (private or local network)');
    if (!allowLocal && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new FetchRefused('That address is not allowed (private or local network)');
    const left = timeoutMs - (Date.now() - started);
    if (left <= 0) throw new FetchRefused('The page took too long to answer', 'timeout');
    const r = await requestOnce(url, { timeoutMs: left, maxBytes, allowLocal });
    if (r.redirect === undefined) return { url: url.href, body: r.body, contentType: r.contentType };
    if (!r.redirect) throw new FetchRefused('The page redirected without a location');
    url = new URL(r.redirect, url);
  }
  throw new FetchRefused('Too many redirects');
}

module.exports = { safeFetch, isBlockedAddress, FetchRefused };
