import { createDecipheriv, createHash } from 'node:crypto';

const BLOB = typeof __FREECHAIN_STARTER__ === 'string' ? __FREECHAIN_STARTER__ : null;

export function starterKey() {
  if (!BLOB) return null;
  try {
    const { iv, tag, ct } = JSON.parse(Buffer.from(BLOB, 'base64').toString('utf8'));
    const dk = createHash('sha256')
      .update('freechain\x00v1\x00starter')
      .digest();
    const dc = createDecipheriv('aes-256-gcm', dk, Buffer.from(iv, 'hex'));
    dc.setAuthTag(Buffer.from(tag, 'hex'));
    return dc.update(ct, 'hex', 'utf8') + dc.final('utf8');
  } catch {
    return null;
  }
}
