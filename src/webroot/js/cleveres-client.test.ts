import { describe, expect, it } from 'vitest';
import { buildCleveresRequest, decodeCleveresText, encodeCleveresText } from './cleveres-client.js';

describe('CleveresTricky bridge helpers', () => {
  it('round-trips UTF-8 through base64url', () => {
    const source = 'Pixel 10 Pro Fold — RCS ✓';
    const encoded = encodeCleveresText(source);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCleveresText(encoded)).toBe(source);
  });

  it('builds the same bounded request shape as the native WebUI bridge', () => {
    const request = JSON.parse(buildCleveresRequest('/api/toggle', 'POST', {
      setting: 'global_mode',
      value: 'false',
      item: ['one', 'two'],
    }));
    expect(request).toEqual({
      version: 1,
      method: 'POST',
      path: '/api/toggle',
      parameters: {
        setting: ['global_mode'],
        value: ['false'],
        item: ['one', 'two'],
      },
      uploadId: null,
      uploadField: null,
    });
  });

  it('rejects paths outside CleveresTricky API routes', () => {
    expect(() => buildCleveresRequest('/etc/passwd')).toThrow('Unsupported CleveresTricky API path');
  });

  it('rejects invalid parameter names', () => {
    expect(() => buildCleveresRequest('/api/config', 'POST', { 'bad key': 'value' })).toThrow('Invalid CleveresTricky parameter');
  });
});
