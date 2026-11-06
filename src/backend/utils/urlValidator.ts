import { URL } from 'url';

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  canonicalUrl?: string;
}

const DISALLOWED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
]);

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
]);

function isPrivateIpV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

export function validateAndCanonicalizeUrl(inputUrl: string): UrlValidationResult {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = inputUrl.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Malformed URL' };
  }

  // 1. Only http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol: "${parsed.protocol}". Only HTTP and HTTPS are allowed.` };
  }

  // 2. Reject embedded credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded credentials are not permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Reject forbidden hostnames
  if (DISALLOWED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    return { valid: false, error: `Access to local/internal host "${hostname}" is prohibited.` };
  }

  // 4. Reject private IPv4 ranges
  if (isPrivateIpV4(hostname)) {
    return { valid: false, error: `Access to private IP range "${hostname}" is prohibited.` };
  }

  // 5. Build Canonical URL
  const canonical = new URL(parsed.toString());
  canonical.hostname = hostname;
  canonical.hash = ''; // Drop fragments

  // Remove standard ports
  if ((canonical.protocol === 'http:' && canonical.port === '80') || (canonical.protocol === 'https:' && canonical.port === '443')) {
    canonical.port = '';
  }

  // Strip tracking parameters and sort query parameters deterministically
  const filteredParams = new URLSearchParams();
  const sortedKeys = Array.from(canonical.searchParams.keys())
    .filter((k) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort();

  for (const key of sortedKeys) {
    for (const val of canonical.searchParams.getAll(key)) {
      filteredParams.append(key, val);
    }
  }

  canonical.search = filteredParams.toString() ? `?${filteredParams.toString()}` : '';

  // Normalize pathname: ensure leading slash, strip trailing slash if not root
  if (canonical.pathname.length > 1 && canonical.pathname.endsWith('/')) {
    canonical.pathname = canonical.pathname.slice(0, -1);
  }

  return { valid: true, canonicalUrl: canonical.toString() };
}
