import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function signRequest({ secret, method, target, body = Buffer.alloc(0), now = Date.now() }) {
  const timestamp = Math.floor(now / 1000);
  const hash = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', secret).update(`${timestamp}:${method.toUpperCase()}:${target}:${hash}`).digest('hex');
  return `${timestamp}:${signature}`;
}

export function verifyRequest({ header, secret, now = Date.now(), ...request }) {
  if (!secret || typeof header !== 'string' || !/^\d{1,13}:[a-f0-9]{64}$/.test(header)) return false;
  const timestamp = Number(header.split(':')[0]) * 1000;
  if (Math.abs(now - timestamp) > 60000) return false;
  const expected = signRequest({ ...request, secret, now: timestamp });
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
