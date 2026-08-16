// Shared icon helpers for the App Targeting overlay.

const ANDROID_PATH = 'M40-240q9-107 65.5-197T256-580l-74-128q-6-9-3-19t13-15q8-5 18-2t16 12l74 128q86-36 180-36t180 36l74-128q6-9 16-12t18 2q10 5 13 15t-3 19l-74 128q94 53 150.5 143T920-240H40Zm275.5-124.5Q330-379 330-400t-14.5-35.5Q301-450 280-450t-35.5 14.5Q230-421 230-400t14.5 35.5Q259-350 280-350t35.5-14.5Zm400 0Q730-379 730-400t-14.5-35.5Q701-450 680-450t-35.5 14.5Q630-421 630-400t14.5 35.5Q659-350 680-350t35.5-14.5Z';

export function themedFallbackIcon(): string {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const bg = cs.getPropertyValue('--md-sys-color-surface-container-highest').trim() || '#e6e0e9';
  const fg = cs.getPropertyValue('--md-sys-color-on-surface-variant').trim() || '#49454f';
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960">`
    + `<circle cx="480" cy="-480" r="460" fill="${bg}"/>`
    + `<g transform="matrix(0.7 0 0 0.7 144 -144)"><path fill="${fg}" d="${ANDROID_PATH}"/></g></svg>`
  );
}

export function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function ksuGlobal(): any {
  return (globalThis as any).ksu;
}

export class AppIconManager {
  private observer: IntersectionObserver | null = null;

  watchAll(): void {
    if (!this.observer) {
      this.observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          const img = el.querySelector('.sp-icn') as HTMLImageElement | null;
          const spin = el.querySelector('.sp-icn-spin') as HTMLElement | null;
          const pkg = img?.dataset.package;
          if (pkg && img && spin) {
            this.fetch(pkg, img, spin);
            this.observer?.unobserve(el);
          }
        }
      }, { rootMargin: '100px', threshold: 0.1 });
    }
    document.querySelectorAll('.sp-icn-w').forEach(el => this.observer!.observe(el));
    const ksu = ksuGlobal();
    if (typeof ksu?.listPackages === 'function') {
      document.querySelectorAll('.sp-icn-w').forEach(el => {
        (el as HTMLElement).style.display = 'flex';
      });
    }
  }

  createElements(pkg: string): { wrap: HTMLDivElement; img: HTMLImageElement; spin: HTMLDivElement } {
    const wrap = document.createElement('div');
    wrap.className = 'sp-icn-w';
    const spin = document.createElement('div');
    spin.className = 'sp-icn-spin';
    spin.dataset.package = pkg;
    const img = document.createElement('img');
    img.className = 'sp-icn';
    img.dataset.package = pkg;
    img.alt = '';
    img.loading = 'lazy';
    wrap.appendChild(spin);
    wrap.appendChild(img);
    return { wrap, img, spin };
  }

  private fetch(pkg: string, img: HTMLImageElement, spin: HTMLElement): void {
    const done = () => { spin.style.display = 'none'; img.style.opacity = '1'; };
    const fail = () => { img.src = themedFallbackIcon(); done(); };
    img.onload = done;
    img.onerror = fail;

    const pm = (globalThis as any).$packageManager;
    if (typeof pm?.getApplicationIcon === 'function') {
      try {
        const uri = pm.getApplicationIcon(pkg, 0, 0) as string;
        if (uri) {
          fetch(uri).then(r => r.arrayBuffer()).then(b => {
            img.src = 'data:image/png;base64,' + bufToB64(b);
          }).catch(fail);
          return;
        }
      } catch {}
    }
    if (typeof ksuGlobal()?.getPackagesInfo === 'function') {
      img.src = 'ksu://icon/' + pkg;
      return;
    }
    fail();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

