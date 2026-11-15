import { isIPv6 } from 'node:net';

export function parseHostPort(host: string, defaultPort: number): { host: string; port: number } {
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    if (closeIdx !== -1) {
      const addr = host.slice(0, closeIdx + 1);
      const rest = host.slice(closeIdx + 1);
      if (rest.startsWith(':')) {
        const parsed = Number.parseInt(rest.slice(1), 10);
        if (!Number.isNaN(parsed)) {
          return { host: addr, port: parsed };
        }
      }
      return { host: addr, port: defaultPort };
    }
  }
  if (isIPv6(host)) {
    return { host: `[${host}]`, port: defaultPort };
  }
  const colonIdx = host.indexOf(':');
  if (colonIdx !== -1 && host.indexOf(':', colonIdx + 1) === -1) {
    const h = host.slice(0, colonIdx);
    const parsed = Number.parseInt(host.slice(colonIdx + 1), 10);
    return {
      host: h,
      port: Number.isNaN(parsed) ? defaultPort : parsed,
    };
  }
  return { host, port: defaultPort };
}
