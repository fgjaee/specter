import { exec } from './bridge.js';

export type CleveresMethod = 'GET' | 'POST';
export type CleveresParameters = Record<string, string | string[]>;

export interface CleveresEnvelope {
  version: number;
  status: number;
  statusText: string;
  mimeType: string;
  size: number;
  body?: string;
  downloadId?: string;
}

export interface CleveresConfig {
  global_mode?: boolean;
  auto_keybox_check?: boolean;
  drm_passthrough?: boolean;
  spoof_enabled?: boolean;
  spoof_build_identity?: boolean;
  random_on_boot?: boolean;
  spoof_region_cn?: boolean;
  telephony?: boolean;
  keybox_count?: number;
  app_config_size?: number;
  keystore_interceptor_running?: boolean;
  telephony_interceptor_running?: boolean;
  native_runtime?: { state?: string; alive?: boolean };
  [key: string]: unknown;
}

export interface CleveresPolicyState {
  version?: number;
  features?: {
    buildIdentity?: boolean;
    attestationIdentity?: boolean;
    telephonyIdentity?: boolean;
    regionIdentity?: boolean;
    identityRefresh?: boolean;
    securityPatch?: boolean;
  };
  securityPatch?: Record<string, unknown>;
  profiles?: unknown[];
  activeProfile?: string | null;
  [key: string]: unknown;
}

const BRIDGE_PATHS = [
  '/data/adb/modules/cleverestricky/webui_bridge',
  '/data/adb/ksu/modules/cleverestricky/webui_bridge',
  '/data/adb/ap/modules/cleverestricky/webui_bridge',
] as const;

const MAX_BODY_BYTES = 20 * 1024 * 1024;

function bytesToBinary(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return binary;
}

export function encodeCleveresText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(bytesToBinary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeCleveresText(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid CleveresTricky payload');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildCleveresRequest(
  path: string,
  method: CleveresMethod = 'GET',
  parameters: CleveresParameters = {},
): string {
  if (!/^\/api\/[A-Za-z0-9_./-]+$/.test(path)) throw new Error('Unsupported CleveresTricky API path');
  const normalized: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(parameters)) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key)) throw new Error('Invalid CleveresTricky parameter');
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length > 32) throw new Error('Too many CleveresTricky parameter values');
    normalized[key] = values.map(value => {
      const text = String(value);
      if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('CleveresTricky parameter is too large');
      return text;
    });
  }
  return JSON.stringify({
    version: 1,
    method,
    path,
    parameters: normalized,
    uploadId: null,
    uploadField: null,
  });
}

function bridgeShellCommand(encodedRequest: string, timeoutMs: number): string {
  const paths = BRIDGE_PATHS.map(path => `'${path}'`).join(' ');
  return `CT_BRIDGE=''; for CT_PATH in ${paths}; do [ -x "$CT_PATH" ] && { CT_BRIDGE="$CT_PATH"; break; }; done; `
    + `[ -n "$CT_BRIDGE" ] || { echo 'CleveresTricky native bridge is unavailable' >&2; exit 127; }; `
    + `exec "$CT_BRIDGE" call '${encodedRequest}' '${timeoutMs}'`;
}

export async function cleveresAvailable(): Promise<boolean> {
  const tests = BRIDGE_PATHS.map(path => `[ -x '${path}' ]`).join(' || ');
  try {
    const result = await exec(`${tests}`);
    return !result.code || result.code === 0;
  } catch {
    return false;
  }
}

export async function cleveresRequestText(
  path: string,
  method: CleveresMethod = 'GET',
  parameters: CleveresParameters = {},
  timeoutMs = 60000,
): Promise<string> {
  const boundedTimeout = Math.min(Math.max(Math.trunc(timeoutMs), 1000), 120000);
  const request = buildCleveresRequest(path, method, parameters);
  const result = await exec(bridgeShellCommand(encodeCleveresText(request), boundedTimeout));
  if (typeof result.code === 'number' && result.code !== 0) {
    throw new Error((result.stderr || result.stdout || 'CleveresTricky request failed').trim());
  }

  let envelope: CleveresEnvelope;
  try {
    envelope = JSON.parse((result.stdout || '').trim()) as CleveresEnvelope;
  } catch {
    throw new Error('Invalid response from CleveresTricky');
  }
  if (envelope.version !== 1 || !Number.isInteger(envelope.status) || envelope.status < 100 || envelope.status > 599) {
    throw new Error('Invalid CleveresTricky response envelope');
  }
  if (!Number.isSafeInteger(envelope.size) || envelope.size < 0 || envelope.size > MAX_BODY_BYTES) {
    throw new Error('Invalid CleveresTricky response size');
  }
  if (typeof envelope.body !== 'string') {
    throw new Error(envelope.downloadId ? 'CleveresTricky returned a downloadable response' : 'CleveresTricky response body is missing');
  }
  const body = decodeCleveresText(envelope.body);
  if (new TextEncoder().encode(body).length !== envelope.size) throw new Error('Incomplete CleveresTricky response');
  if (envelope.status < 200 || envelope.status >= 300) throw new Error(body || envelope.statusText || `CleveresTricky returned ${envelope.status}`);
  return body;
}

export async function cleveresRequestJson<T>(
  path: string,
  method: CleveresMethod = 'GET',
  parameters: CleveresParameters = {},
  timeoutMs = 60000,
): Promise<T> {
  const body = await cleveresRequestText(path, method, parameters, timeoutMs);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('CleveresTricky returned invalid JSON');
  }
}

export const getCleveresConfig = () => cleveresRequestJson<CleveresConfig>('/api/config');
export const getCleveresPolicy = () => cleveresRequestJson<CleveresPolicyState>('/api/policy_state');
export const saveCleveresPolicy = (policy: CleveresPolicyState) =>
  cleveresRequestJson<CleveresPolicyState>('/api/policy_state', 'POST', { data: JSON.stringify(policy) });
export const getCleveresFile = (filename: string) => cleveresRequestText('/api/file', 'GET', { filename });
export const saveCleveresFile = (filename: string, content: string) =>
  cleveresRequestText('/api/save', 'POST', { filename, content });
export const reloadCleveres = () => cleveresRequestText('/api/reload', 'POST');
export const applyCleveresProfile = (profile: 'default' | 'daily' | 'minimal' | 'maximum') =>
  cleveresRequestText('/api/apply_profile', 'POST', { profile });
export const toggleCleveres = (setting: string, enabled: boolean) =>
  cleveresRequestText('/api/toggle', 'POST', { setting, value: String(enabled) });
