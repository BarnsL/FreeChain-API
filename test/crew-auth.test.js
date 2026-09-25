import test from 'node:test';
import assert from 'node:assert/strict';
import { signRequest, verifyRequest } from '../crew-app/backend/auth.mjs';

test('Crew signatures bind method, query, body and expire', () => {
  const request = { secret: 'test-secret', method: 'POST', target: '/api/admin/keys?q=one%20two', body: Buffer.from('{"slot":"local"}'), now: 100000 };
  const header = signRequest(request);
  assert.equal(verifyRequest({ ...request, header }), true);
  assert.equal(verifyRequest({ ...request, header: `0${header}` }), false);
  for (const change of [{ method: 'GET' }, { target: '/api/admin/keys?q=other' }, { body: Buffer.from('{}') }, { secret: 'wrong' }, { now: 162000 }, { header: '100:bad' }, { secret: '' }]) {
    assert.equal(verifyRequest({ ...request, header, ...change }), false);
  }
});
