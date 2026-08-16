import { describe, expect, it } from 'vitest';
import {
  buildCleveresRequest,
  decodeCleveresText,
  encodeCleveresText,
  extractCleveresEnvelope,
  normalizeCleveresExecValues,
} from './cleveres-client.js';

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

  it('recognizes a valid CleveresTricky response envelope', () => {
    const body = '{"ok":true}';
    const envelope = JSON.stringify({
      version: 1,
      status: 200,
      statusText: '200 OK',
      mimeType: 'application/json',
      size: new TextEncoder().encode(body).length,
      body: encodeCleveresText(body),
    });
    expect(extractCleveresEnvelope(envelope)).toBe(envelope);
  });

  it('treats an HTTP-200 envelope in stderr as success', () => {
    const body = '{"ok":true}';
    const envelope = JSON.stringify({
      version: 1,
      status: 200,
      statusText: '200 OK',
      mimeType: 'application/json',
      size: new TextEncoder().encode(body).length,
      body: encodeCleveresText(body),
    });
    expect(normalizeCleveresExecValues([1, '', envelope])).toEqual({
      errno: 0,
      stdout: envelope,
      stderr: '',
    });
  });

  it('treats an HTTP-200 envelope in the callback code slot as success', () => {
    const body = '{"ok":true}';
    const envelope = JSON.stringify({
      version: 1,
      status: 200,
      statusText: '200 OK',
      mimeType: 'application/json',
      size: new TextEncoder().encode(body).length,
      body: encodeCleveresText(body),
    });
    expect(normalizeCleveresExecValues([envelope])).toEqual({
      errno: 0,
      stdout: envelope,
      stderr: '',
    });
  });

  it('extracts an envelope nested in a host result object', () => {
    const body = 'ready';
    const envelope = {
      version: 1,
      status: 200,
      statusText: '200 OK',
      mimeType: 'text/plain',
      size: new TextEncoder().encode(body).length,
      body: encodeCleveresText(body),
    };
    expect(normalizeCleveresExecValues([{ code: 1, stderr: JSON.stringify(envelope) }])).toEqual({
      errno: 0,
      stdout: JSON.stringify(envelope),
      stderr: '',
    });
  });

  it('rejects paths outside CleveresTricky API routes', () => {
    expect(() => buildCleveresRequest('/etc/passwd')).toThrow('Unsupported CleveresTricky API path');
  });

  it('rejects invalid parameter names', () => {
    expect(() => buildCleveresRequest('/api/config', 'POST', { 'bad key': 'value' })).toThrow('Invalid CleveresTricky parameter');
  });
});
