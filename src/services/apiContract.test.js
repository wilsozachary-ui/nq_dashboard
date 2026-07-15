import { ApiContractError, unwrapApiBody, validateEnvelope } from './apiContract';

describe('API response contracts', () => {
  test('unwraps a valid successful envelope', () => {
    expect(unwrapApiBody({ ok: true, data: { armed: true }, error: null }, 'GET /testbot/live'))
      .toEqual({ armed: true });
  });

  test('turns an envelope business failure into a rejected operation', () => {
    expect(() => unwrapApiBody({ ok: false, data: null, error: { message: 'stale revision' } }))
      .toThrow('stale revision');
  });

  test.each([
    [{ data: {} }, 'boolean ok'],
    [{ ok: true }, 'data field'],
    [{ ok: true, data: {}, error: 'bad' }, 'error field'],
  ])('rejects malformed envelopes', (body, expected) => {
    expect(() => validateEnvelope(body)).toThrow(expected);
  });

  test('rejects primitive raw payloads but permits legacy structured JSON', () => {
    expect(unwrapApiBody({ status: 'connected' })).toEqual({ status: 'connected' });
    expect(unwrapApiBody([])).toEqual([]);
    expect(() => unwrapApiBody('connected')).toThrow(ApiContractError);
  });
});
