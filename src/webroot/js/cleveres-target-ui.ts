import { exec, getDataDir } from './bridge.js';
import { showToast } from './toast.js';
import {
  cleveresAvailable,
  getCleveresConfig,
  getCleveresFile,
  saveCleveresFile,
  reloadCleveres,
} from './cleveres-client.js';

const RCS_SAFE_REQUIRED = [
  'android',
  'com.android.vending',
  'com.google.android.gsf',
  'com.google.android.gms',
  'com.google.android.contactkeys',
  'com.google.android.safetycore',
  'com.google.android.apps.walletnfcrel',
  'io.github.vvb2060.keyattestation',
] as const;

const RCS_PROTECTED = new Set([
  'com.google.android.apps.messaging',
  'com.google.android.ims',
]);

interface AppRow {
  packageName: string;
  appName: string;
  system: boolean;
  required: boolean;
  protected: boolean;
}

type FilterMode = 'all' | 'selected' | 'unselected';

const dataDir = () => getDataDir() || '/data/adb/specter';
const safeMarker = () => `${dataDir()}/rcs_safe_mode`;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]!);
}

function packageSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    set.add(line.replace(/[!?]$/, ''));
  }
  return set;
}

async function readPackages(system: boolean): Promise<string[]> {
  const ksu = (globalThis as any).ksu;
  try {
    if (!system && typeof ksu?.listUserPackages === 'function') {
      const parsed = JSON.parse(ksu.listUserPackages()) as string[];
      if (Array.isArray(parsed) && parsed.length) return [...new Set(parsed)].sort();
    }
    if (typeof ksu?.listPackages === 'function') {
      const parsed = JSON.parse(ksu.listPackages(system ? 'system' : 'user')) as string[];
      if (Array.isArray(parsed) && parsed.length) return [...new Set(parsed)].sort();
    }
  } catch {}

  const command = system
    ? "pm list packages -s 2>/dev/null | cut -d: -f2 | sort -u"
    : "pm list packages -3 2>/dev/null | cut -d: -f2 | sort -u";
  const result = await exec(command);
  return (result.stdout || '').split('\n').map(v => v.trim()).filter(Boolean);
}

async function resolveLabels(
  packages: string[],
  onBatch: (labels: Map<string, string>) => void,
): Promise<void> {
  const ksu = (globalThis as any).ksu;
  if (typeof ksu?.getPackagesInfo !== 'function') return;

  // The legacy picker requested metadata/icons for the entire package set at
  // once. On a large install set that can monopolize the KSU WebUI thread.
  // Resolve small chunks and yield between them instead.
  const CHUNK = 40;
  for (let start = 0; start < packages.length; start += CHUNK) {
    const chunk = packages.slice(start, start + CHUNK);
    try {
      const list = JSON.parse(ksu.getPackagesInfo(JSON.stringify(chunk))) as Array<{ appLabel?: string }>;
      const changed = new Map<string, string>();
      for (let i = 0; i < chunk.length; i++) {
        const pkg = chunk[i]!;
        const label = list[i]?.appLabel;
        changed.set(pkg, label && label !== pkg ? label : pkg);
      }
      onBatch(changed);
    } catch {}
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

function addStyles(): void {
  if (document.getElementById('ct-fast-target-style')) return;
  const style = document.createElement('style');
  style.id = 'ct-fast-target-style';
  style.textContent = `
    .ctft-overlay{position:fixed;inset:0;z-index:10020;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);display:flex;flex-direction:column;opacity:0;transition:opacity .15s ease}
    .ctft-overlay.open{opacity:1}
    .ctft-head{display:flex;align-items:center;gap:10px;padding:max(12px,env(safe-area-inset-top)) 14px 10px;border-bottom:1px solid var(--md-sys-color-outline-variant)}
    .ctft-back{width:42px;height:42px;border:0;border-radius:50%;background:transparent;color:inherit;display:grid;place-items:center;font-size:26px}
    .ctft-title{font-size:1.2rem;font-weight:650;line-height:1.2;flex:1;min-width:0}
    .ctft-sub{font-size:.78rem;color:var(--md-sys-color-on-surface-variant);margin-top:2px}
    .ctft-state{font-size:.76rem;font-weight:700;border-radius:999px;padding:6px 10px;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);white-space:nowrap}
    .ctft-state.dirty{background:var(--md-sys-color-tertiary-container);color:var(--md-sys-color-on-tertiary-container)}
    .ctft-state.error{background:var(--md-sys-color-error-container);color:var(--md-sys-color-on-error-container)}
    .ctft-controls{padding:10px 14px;display:grid;gap:9px;border-bottom:1px solid var(--md-sys-color-outline-variant)}
    .ctft-search{width:100%;box-sizing:border-box;border:1px solid var(--md-sys-color-outline-variant);border-radius:18px;background:var(--md-sys-color-surface-container-high);color:inherit;padding:11px 14px;font:inherit;outline:none}
    .ctft-search:focus{border-color:var(--md-sys-color-primary)}
    .ctft-chips{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none}
    .ctft-chip{border:1px solid var(--md-sys-color-outline-variant);background:transparent;color:inherit;border-radius:999px;padding:7px 11px;font:inherit;font-size:.82rem;white-space:nowrap}
    .ctft-chip.active{background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);border-color:transparent}
    .ctft-summary{font-size:.8rem;color:var(--md-sys-color-on-surface-variant)}
    .ctft-list{flex:1;overflow:auto;padding:7px 8px calc(90px + env(safe-area-inset-bottom));overscroll-behavior:contain}
    .ctft-row{display:flex;align-items:center;gap:11px;min-height:58px;padding:6px 9px;border-radius:14px;content-visibility:auto;contain-intrinsic-size:70px}
    .ctft-row:hover{background:var(--md-sys-color-surface-container-high)}
    .ctft-check{appearance:none;width:24px;height:24px;min-width:24px;border:2px solid var(--md-sys-color-outline);border-radius:7px;display:grid;place-items:center;margin:0}
    .ctft-check:checked{background:var(--md-sys-color-primary);border-color:var(--md-sys-color-primary)}
    .ctft-check:checked:after{content:'✓';color:var(--md-sys-color-on-primary);font-size:17px;font-weight:800;line-height:1}
    .ctft-check:disabled{opacity:.86}
    .ctft-copy{min-width:0;flex:1}
    .ctft-name{font-size:.94rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ctft-pkg{font-size:.75rem;color:var(--md-sys-color-on-surface-variant);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ctft-tag{font-size:.7rem;font-weight:700;border-radius:999px;padding:4px 7px;background:var(--md-sys-color-surface-container-highest);color:var(--md-sys-color-on-surface-variant);white-space:nowrap}
    .ctft-tag.safe{background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)}
    .ctft-tag.lock{background:var(--md-sys-color-error-container);color:var(--md-sys-color-on-error-container)}
    .ctft-empty,.ctft-loading{padding:38px 18px;text-align:center;color:var(--md-sys-color-on-surface-variant);line-height:1.45}
    .ctft-save{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:10021;border:0;border-radius:18px;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);padding:13px 18px;font:inherit;font-weight:700;box-shadow:0 4px 14px #0004}
    .ctft-save:disabled{opacity:.55}
    @media(min-width:760px){.ctft-overlay{left:max(8%,80px);right:max(8%,80px);top:4%;bottom:4%;border-radius:24px;box-shadow:0 20px 70px #0008;overflow:hidden}.ctft-save{right:max(calc(8% + 18px),98px);bottom:calc(4% + 18px)}}
  `;
  document.head.appendChild(style);
}

function rowHtml(row: AppRow, checked: boolean): string {
  const tag = row.protected
    ? '<span class="ctft-tag lock">RCS protected</span>'
    : row.required
      ? '<span class="ctft-tag safe">Required</span>'
      : row.system
        ? '<span class="ctft-tag">System</span>'
        : '';
  return `<label class="ctft-row" data-pkg="${esc(row.packageName)}" data-name="${esc(row.appName.toLowerCase())}">
    <input class="ctft-check" type="checkbox" ${checked ? 'checked' : ''} ${row.required || row.protected ? 'disabled' : ''}>
    <div class="ctft-copy"><div class="ctft-name">${esc(row.appName)}</div><div class="ctft-pkg">${esc(row.packageName)}</div></div>
    ${tag}
  </label>`;
}

async function openFastTargeting(): Promise<void> {
  addStyles();
  if (document.querySelector('.ctft-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'ctft-overlay';
  overlay.innerHTML = `
    <div class="ctft-head">
      <button class="ctft-back" aria-label="Back">‹</button>
      <div class="ctft-title">Cleveres App Targeting<div class="ctft-sub">RCS-safe · fast autosave</div></div>
      <span class="ctft-state" id="ctft-state">Loading</span>
    </div>
    <div class="ctft-controls">
      <input class="ctft-search" id="ctft-search" type="search" placeholder="Search app or package">
      <div class="ctft-chips">
        <button class="ctft-chip active" data-filter="all">All</button>
        <button class="ctft-chip" data-filter="selected">Selected</button>
        <button class="ctft-chip" data-filter="unselected">Not selected</button>
        <button class="ctft-chip" id="ctft-system">Show system apps</button>
      </div>
      <div class="ctft-summary" id="ctft-summary">Loading apps…</div>
    </div>
    <div class="ctft-list" id="ctft-list"><div class="ctft-loading">Reading CleveresTricky and installed apps…</div></div>
    <button class="ctft-save" id="ctft-save" disabled>Saved</button>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const oldOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  const list = overlay.querySelector('#ctft-list') as HTMLElement;
  const search = overlay.querySelector('#ctft-search') as HTMLInputElement;
  const stateEl = overlay.querySelector('#ctft-state') as HTMLElement;
  const summary = overlay.querySelector('#ctft-summary') as HTMLElement;
  const saveBtn = overlay.querySelector('#ctft-save') as HTMLButtonElement;
  const systemBtn = overlay.querySelector('#ctft-system') as HTMLButtonElement;

  let filter: FilterMode = 'all';
  let showSystem = false;
  let systemLoaded = false;
  let closed = false;
  let selected = new Set<string>();
  const rows = new Map<string, AppRow>();
  const required = new Set<string>(RCS_SAFE_REQUIRED);

  let dirtyGeneration = 0;
  let savedGeneration = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;
  let lastSaveError = '';

  function enforceSafety(source: Set<string>): Set<string> {
    const safe = new Set(source);
    for (const pkg of RCS_SAFE_REQUIRED) safe.add(pkg);
    for (const pkg of RCS_PROTECTED) safe.delete(pkg);
    return safe;
  }

  function setSaveState(text: string, tone: 'good' | 'dirty' | 'error' = 'good'): void {
    stateEl.textContent = text;
    stateEl.classList.toggle('dirty', tone === 'dirty');
    stateEl.classList.toggle('error', tone === 'error');
    saveBtn.textContent = tone === 'dirty' ? 'Save now' : tone === 'error' ? 'Retry save' : 'Saved';
    saveBtn.disabled = tone === 'good';
  }

  function updateSummary(): void {
    const effective = enforceSafety(selected);
    const extra = [...effective].filter(pkg => !required.has(pkg)).length;
    summary.textContent = `${effective.size} targeted · ${extra} additional · Messages + Google IMS protected`;
  }

  function applyFilter(): void {
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    list.querySelectorAll<HTMLElement>('.ctft-row').forEach(el => {
      const pkg = el.dataset.pkg || '';
      const row = rows.get(pkg);
      if (!row) return;
      const isSelected = selected.has(pkg) || row.required;
      const filterOk = filter === 'all' || (filter === 'selected' ? isSelected : !isSelected);
      const searchOk = !q || pkg.toLowerCase().includes(q) || (el.dataset.name || '').includes(q);
      const systemOk = showSystem || !row.system || row.required || isSelected || row.protected;
      const visibleRow = filterOk && searchOk && systemOk;
      el.hidden = !visibleRow;
      if (visibleRow) visible++;
    });

    let empty = list.querySelector('.ctft-empty') as HTMLElement | null;
    if (visible === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'ctft-empty';
        empty.textContent = 'No apps match this view.';
        list.appendChild(empty);
      }
      empty.hidden = false;
    } else if (empty) {
      empty.hidden = true;
    }
  }

  function patchLabels(changed: Map<string, string>): void {
    for (const [pkg, label] of changed) {
      const row = rows.get(pkg);
      if (!row || row.appName === label) continue;
      row.appName = label;
      const el = list.querySelector<HTMLElement>(`.ctft-row[data-pkg="${CSS.escape(pkg)}"]`);
      if (!el) continue;
      const name = el.querySelector('.ctft-name');
      if (name) name.textContent = label;
      el.dataset.name = label.toLowerCase();
    }
    applyFilter();
  }

  function addRows(additions: AppRow[]): void {
    const fragment = document.createDocumentFragment();
    for (const row of additions) {
      const existing = rows.get(row.packageName);
      if (existing) {
        existing.system = existing.system || row.system;
        continue;
      }

      rows.set(row.packageName, row);
      const holder = document.createElement('div');
      holder.innerHTML = rowHtml(row, selected.has(row.packageName) || row.required);
      const element = holder.firstElementChild as HTMLElement;
      const checkbox = element.querySelector('.ctft-check') as HTMLInputElement;

      if (!row.required && !row.protected) {
        element.addEventListener('click', event => {
          if (event.target === checkbox) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        });
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(row.packageName);
          else selected.delete(row.packageName);
          markDirty();
          applyFilter();
        });
      }
      fragment.appendChild(element);
    }
    list.appendChild(fragment);
    applyFilter();
  }

  async function verifySaved(expected: Set<string>): Promise<void> {
    const actual = packageSet(await getCleveresFile('target.txt'));
    for (const pkg of expected) {
      if (!actual.has(pkg)) throw new Error(`CleveresTricky did not retain ${pkg}`);
    }
    for (const pkg of RCS_PROTECTED) {
      if (actual.has(pkg)) throw new Error(`RCS protected package was unexpectedly targeted: ${pkg}`);
    }
  }

  async function flushSave(): Promise<void> {
    if (saving || savedGeneration >= dirtyGeneration) return;
    saving = true;
    lastSaveError = '';
    try {
      while (savedGeneration < dirtyGeneration) {
        const generation = dirtyGeneration;
        const expected = enforceSafety(selected);
        setSaveState('Saving…', 'dirty');
        await saveCleveresFile('target.txt', [...expected].sort().join('\n') + '\n');
        await reloadCleveres();
        await verifySaved(expected);
        await exec(`mkdir -p '${dataDir().replace(/'/g, "'\\''")}' && : > '${safeMarker().replace(/'/g, "'\\''")}'`);
        selected = expected;
        savedGeneration = generation;
      }
      setSaveState('Saved', 'good');
      updateSummary();
    } catch (error) {
      lastSaveError = error instanceof Error ? error.message : String(error);
      setSaveState('Save failed', 'error');
      showToast(lastSaveError, { icon: 'error', type: 'error', autoCloseDelay: 5000 });
    } finally {
      saving = false;
      if (savedGeneration < dirtyGeneration && !lastSaveError) void flushSave();
    }
  }

  function markDirty(delay = 600): void {
    dirtyGeneration++;
    setSaveState('Unsaved', 'dirty');
    updateSummary();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushSave();
    }, delay);
  }

  async function close(): Promise<void> {
    if (closed) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (savedGeneration < dirtyGeneration) await flushSave();
    if (lastSaveError) return;
    closed = true;
    overlay.classList.remove('open');
    document.documentElement.style.overflow = oldOverflow;
    setTimeout(() => overlay.remove(), 150);
  }

  overlay.querySelector('.ctft-back')?.addEventListener('click', () => { void close(); });
  saveBtn.addEventListener('click', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void flushSave();
  });
  search.addEventListener('input', applyFilter);

  overlay.querySelectorAll<HTMLButtonElement>('.ctft-chip[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      overlay.querySelectorAll('.ctft-chip[data-filter]').forEach(chip => chip.classList.remove('active'));
      button.classList.add('active');
      filter = (button.dataset.filter || 'all') as FilterMode;
      applyFilter();
    });
  });

  systemBtn.addEventListener('click', async () => {
    showSystem = !showSystem;
    systemBtn.classList.toggle('active', showSystem);
    systemBtn.textContent = showSystem ? 'Hide system apps' : 'Show system apps';

    if (showSystem && !systemLoaded) {
      systemBtn.disabled = true;
      try {
        const packages = await readPackages(true);
        addRows(packages.map(pkg => ({
          packageName: pkg,
          appName: pkg,
          system: true,
          required: required.has(pkg),
          protected: RCS_PROTECTED.has(pkg),
        })));
        systemLoaded = true;
        void resolveLabels(packages, patchLabels);
      } finally {
        systemBtn.disabled = false;
      }
    }
    applyFilter();
  });

  try {
    const [config, targetText, userPackages] = await Promise.all([
      getCleveresConfig(),
      getCleveresFile('target.txt').catch(() => ''),
      readPackages(false),
    ]);

    if (config.global_mode) {
      list.innerHTML = '<div class="ctft-empty"><strong>CleveresTricky Global Mode is active.</strong><br><br>App targeting is inactive in Global Mode. Keep the working RCS Targeted Mode enabled before editing apps.</div>';
      setSaveState('Global mode', 'error');
      summary.textContent = 'No changes were made.';
      search.disabled = true;
      systemBtn.disabled = true;
      return;
    }

    const original = packageSet(targetText);
    selected = enforceSafety(original);
    const userSet = new Set(userPackages);
    const initialPackages = [...new Set([
      ...RCS_SAFE_REQUIRED,
      ...selected,
      ...userPackages,
      ...RCS_PROTECTED,
    ])];

    list.innerHTML = '';
    addRows(initialPackages.map(pkg => ({
      packageName: pkg,
      appName: pkg,
      system: !userSet.has(pkg),
      required: required.has(pkg),
      protected: RCS_PROTECTED.has(pkg),
    })));
    updateSummary();
    setSaveState('Saved', 'good');

    // Upgrade the proven seven-app RCS preset to include Key Attestation, and
    // normalize away Messages/IMS if an older Specter action ever re-added them.
    const normalized = enforceSafety(original);
    const alreadyNormalized = normalized.size === original.size
      && [...normalized].every(pkg => original.has(pkg));
    if (!alreadyNormalized || !original.has('io.github.vvb2060.keyattestation')) {
      markDirty(250);
    } else {
      await exec(`mkdir -p '${dataDir().replace(/'/g, "'\\''")}' && : > '${safeMarker().replace(/'/g, "'\\''")}'`);
    }

    void resolveLabels(initialPackages, patchLabels);
  } catch (error) {
    list.innerHTML = `<div class="ctft-empty">Could not open Cleveres app targeting:<br><br>${esc(error instanceof Error ? error.message : String(error))}</div>`;
    setSaveState('Error', 'error');
    summary.textContent = 'No changes were made.';
  }
}

export async function wireCleveresFastTargeting(): Promise<void> {
  if (!(await cleveresAvailable())) return;

  // Capture the App Targeting tap before the legacy heavyweight picker. Other
  // keystore backends still use the upstream UI unchanged.
  document.addEventListener('click', event => {
    const target = event.target as Element | null;
    if (!target?.closest('#target-apps-btn')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void openFastTargeting();
  }, true);
}
