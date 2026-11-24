export const BUILD_REFRESH_MS = 2000;
export const isBevyBetaPath = pathname => pathname === '/experimental/' || pathname === '/experimental/index.html';
const buildId = value => typeof value === 'string' && /^[A-F0-9]{10}$/.test(value);

export function watchServerBuild({ served = '', load, reload, onBuild, onError, every = BUILD_REFRESH_MS, hidden = () => false, schedule = setInterval, cancel = clearInterval, listen, unlisten } = {}) {
  let current = buildId(served) ? served : '';
  let checking = false;
  let stopped = false;
  const stop = () => { stopped = true; cancel(timer); unlisten?.('visibilitychange', onShow); };
  const check = async () => {
    if (stopped || checking || hidden()) return;
    checking = true;
    try {
      const build = await load();
      if (stopped || !buildId(build)) return;
      onBuild?.(build);
      if (!current) { current = build; return; }
      if (build !== current) { stop(); reload(); }
    } catch {
      if (!stopped && !current) onError?.();
    } finally { checking = false; }
  };
  const timer = schedule(() => { check().catch(() => {}); }, every);
  const onShow = () => { if (!hidden()) check().catch(() => {}); };
  listen?.('visibilitychange', onShow);
  const ready = check();
  return Object.assign(ready, { stop });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (isBevyBetaPath(location.pathname)) {
    document.documentElement.classList.add('bevy-beta');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#111017');
  }
  const updateLabel = text => {
    const label = document.getElementById('build-version');
    if (label) label.textContent = text;
  };
  let readyHideTimer = null;
  const syncWasmBuildBadge = info => {
    const cta = document.querySelector('.experimental-button');
    if (!cta) return;
    let badge = document.getElementById('wasm-build-badge');
    const state = info?.wasmBuild?.state ?? '';
    const isCompiling = state === 'compiling-wasm' || state === 'compiling-server';
    const wasCompiling = sessionStorage.getItem('ww_wasm_compiling') === '1';
    if (isCompiling) {
      sessionStorage.setItem('ww_wasm_compiling', '1');
      clearTimeout(readyHideTimer);
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'wasm-build-badge';
        badge.setAttribute('role', 'status');
        cta.after(badge);
      }
      badge.className = 'wasm-build-badge compiling';
      badge.textContent = state === 'compiling-wasm' ? '⏳ COMPILING 3D WASM…' : '⏳ FINALIZING SERVER…';
      return;
    }
    if (wasCompiling && (state === 'ready' || info?.wasmReady)) {
      sessionStorage.removeItem('ww_wasm_compiling');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'wasm-build-badge';
        badge.setAttribute('role', 'status');
        cta.after(badge);
      }
      badge.className = 'wasm-build-badge ready';
      badge.textContent = '✓ 3D WASM READY!';
      clearTimeout(readyHideTimer);
      readyHideTimer = setTimeout(() => badge?.remove(), 12000);
      return;
    }
    if (state === 'failed' && wasCompiling) {
      sessionStorage.removeItem('ww_wasm_compiling');
      badge?.remove();
    }
  };
  const served = document.body?.dataset.build ?? '';
  if (buildId(served)) updateLabel(`BUILD ${served}`);
  let latest = buildId(served) ? served : '';
  let failed = false;
  globalThis.__syncBuildLabel = () => {
    if (latest) updateLabel(`BUILD ${latest}`);
    else if (failed) updateLabel('BUILD UNAVAILABLE');
  };
  watchServerBuild({
    served,
    load: async () => {
      const response = await fetch('/build.json', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const info = await response.json();
      syncWasmBuildBadge(info);
      return info.build;
    },
    reload: () => location.reload(),
    onBuild: build => { latest = build; failed = false; updateLabel(`BUILD ${build}`); },
    onError: () => { failed = true; updateLabel('BUILD UNAVAILABLE'); },
    hidden: () => document.hidden,
    listen: document.addEventListener.bind(document),
    unlisten: document.removeEventListener.bind(document),
  });
}
