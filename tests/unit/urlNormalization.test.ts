import { describe, it, expect } from 'vitest';
import { validateAndCanonicalizeUrl } from '../../src/backend/utils/urlValidator.js';

describe('URL Normalization and Security Validation', () => {
  it('normalizes valid public URLs', () => {
    const res = validateAndCanonicalizeUrl('HTTPS://Example.COM:443/pricing/?b=2&a=1&utm_source=twitter');
    expect(res.valid).toBe(true);
    expect(res.canonicalUrl).toBe('https://example.com/pricing?a=1&b=2');
  });

  it('strips standard tracking parameters and preserves other query params', () => {
    const res = validateAndCanonicalizeUrl('https://example.com/item?id=123&fbclid=abc&utm_medium=cpc&gclid=xyz');
    expect(res.valid).toBe(true);
    expect(res.canonicalUrl).toBe('https://example.com/item?id=123');
  });

  it('rejects unsupported protocols', () => {
    expect(validateAndCanonicalizeUrl('ftp://ftp.example.com').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('javascript:alert(1)').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('data:text/plain;base64,SGVsbG8=').valid).toBe(false);
  });

  it('rejects embedded credentials to prevent credential leaks and SSRF bypass', () => {
    const res = validateAndCanonicalizeUrl('http://admin:secret@example.com/dash');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('embedded credentials');
  });

  it('blocks loopback and localhost addresses', () => {
    expect(validateAndCanonicalizeUrl('http://localhost:8080').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://127.0.0.1:3000').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://[::1]/secret').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://app.local').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://service.internal').valid).toBe(false);
  });

  it('blocks private IPv4 ranges (RFC1918)', () => {
    // 10.0.0.0/8
    expect(validateAndCanonicalizeUrl('http://10.0.0.1/admin').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://10.255.255.255/admin').valid).toBe(false);

    // 192.168.0.0/16
    expect(validateAndCanonicalizeUrl('http://192.168.1.1').valid).toBe(false);

    // 172.16.0.0/12
    expect(validateAndCanonicalizeUrl('http://172.16.0.1').valid).toBe(false);
    expect(validateAndCanonicalizeUrl('http://172.31.255.254').valid).toBe(false);

    // 169.254.0.0/16 Link-local
    expect(validateAndCanonicalizeUrl('http://169.254.169.254/latest/meta-data').valid).toBe(false);
  });
});
