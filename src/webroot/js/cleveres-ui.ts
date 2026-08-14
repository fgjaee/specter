import { exec, getDataDir } from './bridge.js';
import { shellEscape } from './utils.js';
import { showToast } from './toast.js';
import {
  cleveresAvailable,
  getCleveresConfig,
  getCleveresPolicy,
  getCleveresFile,
  saveCleveresFile,
  saveCleveresPolicy,
  reloadCleveres,
  applyCleveresProfile,
  toggleCleveres,
  type CleveresConfig,
  type CleveresPolicyState,
} from './cleveres-client.js';

type FeatureKey = 'buildIdentity' | 'attestationIdentity' | 'telephonyIdentity' | 'regionIdentity' | 'identityRefresh';

const OPTIONAL_IDENTITIES: Array<[FeatureKey, string, string]> = [
  ['buildIdentity', 'Build identity', 'Changes app-visible device/build identity when configured.'],
  ['attestationIdentity', 'Attestation identity', 'Allows configured attestation identity values for selected apps.'],
  ['telephonyIdentity', 'Telephony identity', 'Allows configured IMEI/IMSI/ICCID/phone presentation.'],
  ['regionIdentity', 'Region identity', 'Allows configured country/hardware-region presentation.'],
  ['identityRefresh', 'Identity refresh', 'Prepares a new configured identity snapshot for a later boot.'],
];

const RCS_GENUINE_PATH_TARGETS = [
  'android',
  'com.android.vending',
  'com.google.android.gsf',
  'com.google.android.gms',
  'com.google.android.contactkeys',
  'com.google.android.safetycore',
  'com.google.android.apps.walletnfcrel',
] as const;

const RCS_APPS = ['com.google.android.apps.messaging', 'com.google.android.ims'] as const;

function dataDir(): string {
  return getDataDir() || '/data/adb/specter';
}

function backupDir(): string {
  return `${dataDir()}/backup/cleveres_rcs`;
}

function boolWord(value: boolean | undefined): string {
  return value ? 'On' : 'Off';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]!);
}

function targetPackages(text: string): Set<string> {
  const result = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    result.add(trimmed.replace(/[!?]$/, ''));
  }
  return result;
}

function activeIdentityFeatures(policy: CleveresPolicyState): FeatureKey[] {
  const features = policy.features || {};
  return OPTIONAL_IDENTITIES.map(([key]) => key).filter(key => Boolean(features[key]));
}

function statusRow(label: string, value: string, detail = '', tone: 'good' | 'warn' | 'plain' = 'plain'): string {
  return `<div class="ct-simple-row">
    <div class="ct-simple-copy"><strong>${escapeHtml(label)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>
    <span class="ct-simple-pill ct-simple-${tone}">${escapeHtml(value)}</span>
  </div>`;
}

async function backupExists(): Promise<boolean> {
  const marker = `${backupDir()}/active`;
  const result = await exec(`[ -f ${shellEscape(marker)} ]`);
  return typeof result.code !== 'number' || result.code === 0;
}

async function createRcsBackup(): Promise<void> {
  if (await backupExists()) return;
  const dir = backupDir();
  const cmd = `mkdir -p ${shellEscape(dir)} && `
    + `if [ -f /data/adb/cleverestricky/target.txt ]; then cp /data/adb/cleverestricky/target.txt ${shellEscape(`${dir}/target.txt`)}; else : > ${shellEscape(`${dir}/target.txt`)}; fi && `
    + `if [ -f /data/adb/cleverestricky/global_mode ]; then printf '1\n' > ${shellEscape(`${dir}/global_mode`)}; else printf '0\n' > ${shellEscape(`${dir}/global_mode`)}; fi && `
    + `: > ${shellEscape(`${dir}/active`)}`;
  const result = await exec(cmd);
  if (typeof result.code === 'number' && result.code !== 0) throw new Error(result.stderr || 'Could not create RCS backup');
}

async function applyRcsIsolation(): Promise<void> {
  await createRcsBackup();
  await toggleCleveres('global_mode', false);
  const focused = `${RCS_GENUINE_PATH_TARGETS.join('\n')}\n`;
  await saveCleveresFile('target.txt', focused);
  await reloadCleveres();
}

async function restoreRcsIsolation(): Promise<void> {
  if (!(await backupExists())) throw new Error('No RCS isolation backup is available');
  const dir = backupDir();
  const targetResult = await exec(`cat ${shellEscape(`${dir}/target.txt`)} 2>/dev/null`);
  if (typeof targetResult.code === 'number' && targetResult.code !== 0) throw new Error('Could not read the saved CleveresTricky target list');
  const globalResult = await exec(`cat ${shellEscape(`${dir}/global_mode`)} 2>/dev/null`);
  if (typeof globalResult.code === 'number' && globalResult.code !== 0) throw new Error('Could not read the saved CleveresTricky scope mode');

  await toggleCleveres('global_mode', false);
  await saveCleveresFile('target.txt', targetResult.stdout || '');
  await reloadCleveres();
  if ((globalResult.stdout || '').trim() === '1') await toggleCleveres('global_mode', true);
  await reloadCleveres();

  const cleanup = await exec(`rm -rf ${shellEscape(dir)}`);
  if (typeof cleanup.code === 'number' && cleanup.code !== 0) throw new Error('Settings restored, but the RCS backup marker could not be removed');
}

async function restartRcsApps(): Promise<void> {
  const commands = RCS_APPS.map(pkg => `am force-stop ${shellEscape(pkg)} 2>/dev/null || true`).join('; ');
  await exec(commands);
}

async function disableOptionalIdentity(policy: CleveresPolicyState): Promise<void> {
  const features = { ...(policy.features || {}) };
  for (const [key] of OPTIONAL_IDENTITIES) features[key] = false;
  const next: CleveresPolicyState = { ...policy, features };
  await saveCleveresPolicy(next);
  await reloadCleveres();
}

function addStyles(): void {
  if (document.getElementById('specter-cleveres-simple-style')) return;
  const style = document.createElement('style');
  style.id = 'specter-cleveres-simple-style';
  style.textContent = `
    .ct-simple-dialog{--md-dialog-container-max-width:760px}
    .ct-simple-wrap{display:flex;flex-direction:column;gap:14px;min-width:0}
    .ct-simple-hero{padding:14px;border-radius:18px;background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);line-height:1.45}
    .ct-simple-section{border:1px solid var(--md-sys-color-outline-variant);border-radius:18px;overflow:hidden}
    .ct-simple-section-title{padding:12px 14px 8px;font-weight:700}
    .ct-simple-row{display:flex;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid var(--md-sys-color-outline-variant)}
    .ct-simple-row:first-of-type{border-top:0}
    .ct-simple-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
    .ct-simple-copy span{font-size:.84rem;color:var(--md-sys-color-on-surface-variant);line-height:1.35}
    .ct-simple-pill{font-size:.78rem;font-weight:700;border-radius:999px;padding:5px 9px;white-space:nowrap;background:var(--md-sys-color-surface-container-highest)}
    .ct-simple-good{background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)}
    .ct-simple-warn{background:var(--md-sys-color-error-container);color:var(--md-sys-color-on-error-container)}
    .ct-simple-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:12px 14px 14px}
    .ct-simple-actions md-filled-button,.ct-simple-actions md-filled-tonal-button,.ct-simple-actions md-outlined-button{width:100%}
    .ct-simple-note{padding:0 14px 14px;color:var(--md-sys-color-on-surface-variant);font-size:.84rem;line-height:1.45}
    .ct-simple-identity-list{padding:0 14px 10px;display:grid;gap:7px}
    .ct-simple-identity-item{display:grid;grid-template-columns:auto 1fr;gap:8px;font-size:.84rem;color:var(--md-sys-color-on-surface-variant)}
    .ct-simple-identity-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;background:var(--md-sys-color-outline)}
    .ct-simple-identity-dot.on{background:var(--md-sys-color-error)}
    .ct-simple-loading{padding:30px;display:flex;justify-content:center}
    @media(max-width:560px){.ct-simple-actions{grid-template-columns:1fr}.ct-simple-row{align-items:flex-start}.ct-simple-pill{margin-top:1px}}
  `;
  document.head.appendChild(style);
}

async function openCleveresSimple(): Promise<void> {
  addStyles();
  const dialog = document.createElement('md-dialog') as any;
  dialog.classList.add('ct-simple-dialog');
  dialog.innerHTML = `
    <div slot="headline">CleveresTricky — Simple Control</div>
    <div slot="content" id="ct-simple-content"><div class="ct-simple-loading"><md-circular-progress indeterminate></md-circular-progress></div></div>
    <div slot="actions"><md-text-button id="ct-simple-close">Close</md-text-button></div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('#ct-simple-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.show();

  const content = dialog.querySelector('#ct-simple-content') as HTMLElement;

  async function refresh(): Promise<void> {
    content.innerHTML = '<div class="ct-simple-loading"><md-circular-progress indeterminate></md-circular-progress></div>';
    try {
      const [config, policy, target, bootMode, rcsBackup] = await Promise.all([
        getCleveresConfig(),
        getCleveresPolicy(),
        getCleveresFile('target.txt').catch(() => ''),
        getCleveresFile('boot_props_mode').catch(() => 'unknown'),
        backupExists().catch(() => false),
      ]);
      render(config, policy, target, bootMode.trim() || 'unknown', rcsBackup);
    } catch (error) {
      content.innerHTML = `<div class="ct-simple-hero">Could not read CleveresTricky: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    }
  }

  function render(config: CleveresConfig, policy: CleveresPolicyState, target: string, bootMode: string, rcsBackup: boolean): void {
    const identities = activeIdentityFeatures(policy);
    const pkgs = targetPackages(target);
    const targeted = !Boolean(config.global_mode);
    const messagesHandled = Boolean(config.global_mode) || pkgs.has('com.google.android.apps.messaging');
    const imsHandled = Boolean(config.global_mode) || pkgs.has('com.google.android.ims');
    const runtimeGood = Boolean(config.keystore_interceptor_running) || Boolean(config.native_runtime?.alive) || config.native_runtime?.state === 'active';
    const keyboxCount = Number(config.keybox_count || 0);
    const securityPatch = Boolean(policy.features?.securityPatch);
    const rcsIsolated = targeted && !messagesHandled && !imsHandled && RCS_GENUINE_PATH_TARGETS.every(pkg => pkgs.has(pkg));

    const identityDetails = OPTIONAL_IDENTITIES.map(([key, name, desc]) => {
      const on = Boolean(policy.features?.[key]);
      return `<div class="ct-simple-identity-item"><span class="ct-simple-identity-dot ${on ? 'on' : ''}"></span><span><strong>${escapeHtml(name)}: ${on ? 'ON' : 'off'}</strong> — ${escapeHtml(desc)}</span></div>`;
    }).join('');

    content.innerHTML = `<div class="ct-simple-wrap">
      <div class="ct-simple-hero"><strong>What matters:</strong> CleveresTricky can handle Keystore/attestation without turning on every identity-spoofing option. RKP protection is automatic in current CleveresTricky and is intentionally not exposed as a switch here.</div>

      <div class="ct-simple-section">
        <div class="ct-simple-section-title">Current state</div>
        ${statusRow('Keystore runtime', runtimeGood ? 'Running' : 'Check', runtimeGood ? 'Core CleveresTricky interception appears active.' : 'The runtime did not report an active Keystore interceptor.', runtimeGood ? 'good' : 'warn')}
        ${statusRow('Verified keyboxes', String(keyboxCount), 'CleveresTricky verified key material currently available.', keyboxCount > 0 ? 'good' : 'warn')}
        ${statusRow('Application scope', config.global_mode ? 'Global' : 'Targeted', config.global_mode ? 'Most normal app UIDs are eligible for CleveresTricky handling.' : 'Only explicitly targeted apps are eligible.')}
        ${statusRow('Optional identity', identities.length ? `${identities.length} on` : 'All off', identities.length ? 'Some optional identity substitution features are enabled.' : 'Cleanest setting when you only need the core compatibility path.', identities.length ? 'warn' : 'good')}
        ${statusRow('Security Patch override', boolWord(securityPatch), securityPatch ? 'CleveresTricky may replace configured attestation patch fields.' : 'Captured/genuine patch values are kept by the v2 policy.')}
        ${statusRow('Boot property mode', bootMode, bootMode === 'auto' ? 'Recommended: lets another fingerprint provider such as PIF own build properties.' : 'Auto is normally safer when Play Integrity Fix is also installed.', bootMode === 'auto' ? 'good' : 'warn')}
        ${statusRow('Auto keybox check', boolWord(config.auto_keybox_check), 'Periodically validates/maintains the configured keybox pool.')}
        ${statusRow('DRM passthrough', boolWord(config.drm_passthrough), 'Mostly unrelated to RCS; it keeps configured media apps on genuine Keystore certificates.')}
        ${statusRow('RKP protection', 'Always on', 'Current CleveresTricky protects Android/Google Remote Key Provisioning infrastructure automatically.', 'good')}
      </div>

      <div class="ct-simple-section">
        <div class="ct-simple-section-title">Optional identity — plain English</div>
        <div class="ct-simple-identity-list">${identityDetails}</div>
        <div class="ct-simple-actions">
          <md-filled-tonal-button id="ct-disable-identities">Turn optional identity off</md-filled-tonal-button>
          <md-outlined-button id="ct-default-profile">Restore conservative defaults</md-outlined-button>
        </div>
        <div class="ct-simple-note">Neither button deletes keyboxes. “Turn optional identity off” preserves your current scope, profiles and Security Patch setting; it only disables the five optional identity features shown above.</div>
      </div>

      <div class="ct-simple-section">
        <div class="ct-simple-section-title">RCS isolation test</div>
        ${statusRow('RCS apps in Cleveres scope', `${messagesHandled || imsHandled ? 'Yes' : 'No'}`, config.global_mode ? 'Global Mode currently includes Messages and Google IMS.' : `Messages: ${messagesHandled ? 'included' : 'genuine path'} · Google IMS: ${imsHandled ? 'included' : 'genuine path'}`, rcsIsolated ? 'good' : 'plain')}
        ${statusRow('Isolation preset', rcsBackup ? (rcsIsolated ? 'Active' : 'Backup saved') : 'Not active', 'The test keeps Google Play integrity services in CleveresTricky but leaves Messages and Google IMS on the genuine Keystore path.', rcsIsolated ? 'good' : 'plain')}
        <div class="ct-simple-actions">
          <md-filled-button id="ct-rcs-isolate">Apply RCS isolation test</md-filled-button>
          <md-outlined-button id="ct-rcs-restore" ${rcsBackup ? '' : 'disabled'}>Restore previous scope</md-outlined-button>
          <md-outlined-button id="ct-rcs-restart">Restart RCS apps</md-outlined-button>
          <md-outlined-button id="ct-refresh">Refresh status</md-outlined-button>
        </div>
        <div class="ct-simple-note"><strong>This is reversible and does not clear Messages, Carrier Services, GMS, or Play Store data.</strong> It keeps GMS/Play Store/SafetyCore targeted so your Play Integrity setup remains in CleveresTricky scope, while removing Messages and <code>com.google.android.ims</code> from CleveresTricky. It is an isolation experiment for RCS security/eligibility failures, not a promise that RCS will connect.</div>
      </div>
    </div>`;

    const busy = async (buttonId: string, task: () => Promise<void>, success: string) => {
      const button = content.querySelector(buttonId) as any;
      if (!button) return;
      button.disabled = true;
      try {
        await task();
        showToast(success, { icon: 'check_circle', type: 'success', autoCloseDelay: 3200 });
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), { icon: 'error', type: 'error', autoCloseDelay: 5000 });
        button.disabled = false;
      }
    };

    content.querySelector('#ct-disable-identities')?.addEventListener('click', () =>
      busy('#ct-disable-identities', () => disableOptionalIdentity(policy), 'Optional CleveresTricky identity features are off'));
    content.querySelector('#ct-default-profile')?.addEventListener('click', () =>
      busy('#ct-default-profile', async () => { await applyCleveresProfile('default'); await reloadCleveres(); }, 'CleveresTricky conservative defaults applied'));
    content.querySelector('#ct-rcs-isolate')?.addEventListener('click', () =>
      busy('#ct-rcs-isolate', applyRcsIsolation, 'RCS isolation scope applied; restart RCS apps before retesting'));
    content.querySelector('#ct-rcs-restore')?.addEventListener('click', () =>
      busy('#ct-rcs-restore', restoreRcsIsolation, 'Previous CleveresTricky scope restored'));
    content.querySelector('#ct-rcs-restart')?.addEventListener('click', () =>
      busy('#ct-rcs-restart', restartRcsApps, 'Messages and Google IMS force-stopped; reopen Messages to retest'));
    content.querySelector('#ct-refresh')?.addEventListener('click', () => refresh());
  }

  await refresh();
}

export async function wireCleveresTricky(): Promise<void> {
  if (!(await cleveresAvailable())) return;
  if (document.getElementById('cleveres-simple-btn')) return;
  const targetButton = document.getElementById('target-apps-btn');
  const container = targetButton?.parentElement;
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'list-item';
  row.id = 'cleveres-simple-btn';
  row.innerHTML = `
    <div class="li-icon"><md-icon aria-hidden="true">shield</md-icon></div>
    <div class="list-item-content">
      <div class="toggle-text">CleveresTricky — Simple Control</div>
      <span class="supporting-text">Explains active features, conservative defaults, and a reversible RCS isolation test</span>
    </div>
    <div class="spacer"></div>
    <md-ripple></md-ripple>`;
  row.addEventListener('click', () => { openCleveresSimple().catch(error => showToast(String(error), { icon: 'error', type: 'error', autoCloseDelay: 4000 })); });
  container.insertBefore(row, targetButton);
}
