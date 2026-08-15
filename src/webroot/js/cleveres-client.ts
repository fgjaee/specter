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

export interface CleveresExecResult {
  errno: number;
  stdout: string;
  stderr: string;
}

const BRIDGE_PATHS = [
  '/data/adb/modules/cleverestricky/webui_bridge',
  '/data/adb/ksu/modules/cleverestricky/webui_bridge',
  '/data/adb/ap/modules/cleverestricky/webui_bridge',
] as const;

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_ENVELOPE_CHARS = 1024 * 1024;

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

function looksLikeEnvelope(value: unknown): value is CleveresEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Partial<CleveresEnvelope>;
  if (e.version !== 1 || !Number.isInteger(e.status) || (e.status as number) < 100 || (e.status as number) > 599) return false;
  if (typeof e.statusText !== 'string' || typeof e.mimeType !== 'string') return false;
  if (!Number.isSafeInteger(e.size) || (e.size as number) < 0 || (e.size as number) > MAX_BODY_BYTES) return false;
  const hasBody = typeof e.body === 'string';
  const hasDownload = typeof e.downloadId === 'string';
  if (hasBody === hasDownload) return false;
  if (hasBody && !/^[A-Za-z0-9_-]*$/.test(e.body!)) return false;
  if (hasDownload && !/^[0-9a-f]{32}$/.test(e.downloadId!)) return false;
  return true;
}

/**
 * KernelSU/APatch WebUI bridges do not all use the callback arguments the same
 * way. CleveresTricky's own WebUI therefore scans stdout, errno, and stderr for
 * a valid native response envelope before interpreting an exit code. Specter
 * must do the same or a perfectly valid HTTP-200 envelope can be mistaken for
 * a shell error and displayed to the user verbatim.
 */
export function extractCleveresEnvelope(value: unknown, depth = 0): string | null {
  if (value === null || value === undefined || depth > 4) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw || raw.length > MAX_ENVELOPE_CHARS) return null;
    try {
      return extractCleveresEnvelope(JSON.parse(raw), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (looksLikeEnvelope(value)) return JSON.stringify(value);
  const wrapper = value as Record<string, unknown>;
  for (const key of ['stdout', 'out', 'stderr', 'err', 'message', 'result', 'data', 'output']) {
    if (!(key in wrapper)) continue;
    const envelope = extractCleveresEnvelope(wrapper[key], depth + 1);
    if (envelope) return envelope;
  }
  return null;
}

export function normalizeCleveresExecValues(values: unknown[]): CleveresExecResult {
  // Match CleveresTricky's own WebUI: a valid response envelope wins regardless
  // of which callback slot the host put it in.
  for (const value of [values[1], values[0], values[2]]) {
    const envelope = extractCleveresEnvelope(value);
    if (envelope) return { errno: 0, stdout: envelope, stderr: '' };
  }

  let errno: unknown = values[0];
  let stdout: unknown = values[1];
  let stderr: unknown = values[2];

  if (values.length === 1 && errno && typeof errno === 'object' && !Array.isArray(errno)) {
    const result = errno as Record<string, unknown>;
    if ('errno' in result || 'stdout' in result || 'stderr' in result || 'code' in result || 'out' in result || 'err' in result) {
      errno = result.errno ?? result.code ?? 0;
      stdout = result.stdout ?? result.out ?? '';
      stderr = result.stderr ?? result.err ?? '';
    } else {
      errno = -1;
      stdout = '';
      stderr = 'Unsupported native exec result';
    }
  } else if (values.length === 1 && typeof errno === 'string') {
    const raw = errno.trim();
    let parsed: Record<string, unknown> | null = null;
    try {
      const candidate = JSON.parse(raw) as unknown;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) parsed = candidate as Record<string, unknown>;
    } catch {}
    if (parsed && ('errno' in parsed || 'stdout' in parsed || 'stderr' in parsed || 'code' in parsed)) {
      errno = parsed.errno ?? parsed.code ?? 0;
      stdout = parsed.stdout ?? parsed.out ?? '';
      stderr = parsed.stderr ?? parsed.err ?? '';
    } else {
      errno = 0;
      stdout = raw;
      stderr = '';
    }
  }

  const numericErrno = Number(errno);
  return {
    errno: Number.isFinite(numericErrno) ? numericErrno : -1,
    stdout: String(stdout ?? '').trim(),
    stderr: String(stderr ?? '').trim(),
  };
}

function execCleveresNative(command: string, timeoutMs: number): Promise<string> {
  const nativeApi = window.ksu;
  if (!nativeApi?.exec) return Promise.reject(new Error('KernelSU/APatch WebUI bridge is unavailable'));
  const boundedTimeout = Math.min(Math.max(Math.trunc(timeoutMs), 1000), 120000);

  return new Promise((resolve, reject) => {
    const callbackName = `__sp_ct_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    const cleanup = () => { delete (globalThis as Record<string, unknown>)[callbackName]; };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('CleveresTricky native bridge timed out'));
    }, boundedTimeout + 5000);

    (globalThis as Record<string, unknown>)[callbackName] = (...values: unknown[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const result = normalizeCleveresExecValues(values);
      if (result.errno === 0) resolve(result.stdout);
      else reject(new Error(result.stderr || result.stdout || `CleveresTricky native bridge failed with code ${result.errno}`));
    };

    try {
      nativeApi.exec(command, '{}', callbackName);
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    }
  });
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
  const raw = await execCleveresNative(bridgeShellCommand(encodeCleveresText(request), boundedTimeout), boundedTimeout);

  let envelope: CleveresEnvelope;
  try {
    envelope = JSON.parse(raw.trim()) as CleveresEnvelope;
  } catch {
    throw new Error('Invalid response from CleveresTricky');
  }
  if (!looksLikeEnvelope(envelope)) throw new Error('Invalid CleveresTricky response envelope');
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
