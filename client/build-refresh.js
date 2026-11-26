export const BUILD_REFRESH_MS = 2000;
export const usesBevyRenderer = (pathname, search) => ['/', '/experimental/', '/experimental/index.html'].includes(pathname) && new URLSearchParams(search).get('renderer') !== 'classic';
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

const serviceStages = new Map([
  ['checking-assets', 'Checking asset cache…'],
  ['fetching-wasm', 'Downloading WASM release…'],
  ['unpacking-wasm', 'Unpacking WASM release…'],
  ['checking-wasm-release', 'Checking published WASM release…'],
  ['preparing-wasm', 'Checking WASM toolchain…'],
  ['waiting-wasm', 'Waiting for WASM build lock…'],
  ['compiling-wasm', 'Compiling 3D WASM…'],
  ['packaging-wasm', 'Packaging WASM bindings…'],
  ['packing-graphics', 'Building graphics pack…'],
  ['packing-sounds', 'Building sound pack…'],
  ['checking-server', 'Checking server build…'],
  ['waiting-server', 'Waiting for server build lock…'],
  ['compiling-server', 'Compiling game server…'],
  ['starting-server', 'Starting game server…'],
]);

export function serviceBuildNotice(state, observed) {
  if (state === 'failed') return 'Server update failed';
  if (state === 'ready' && observed) return 'Game server ready';
  return serviceStages.get(state) ?? '';
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (usesBevyRenderer(location.pathname, location.search)) {
    document.documentElement.classList.add('bevy-beta');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#111017');
  }
  const updateLabel = text => {
    const label = document.getElementById('build-version');
    if (label) label.textContent = text;
  };
  let readyHideTimer = null;
  const syncBuildBadge = info => {
    const cta = document.querySelector('.experimental-button');
    if (!cta) return;
    let badge = document.getElementById('wasm-build-badge');
    const state = info?.wasmBuild?.state;
    const active = serviceStages.has(state);
    const observed = sessionStorage.getItem('ww_wasm_compiling') === '1';
    const label = serviceBuildNotice(state, observed);
    if (!label) {
      if (state === 'ready' && badge?.classList.contains('failed')) badge.remove();
      return;
    }
    clearTimeout(readyHideTimer);
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'wasm-build-badge';
      badge.setAttribute('role', 'status');
      cta.after(badge);
    }
    const ready = state === 'ready';
    if (badge.textContent !== label) badge.textContent = label;
    badge.className = 'wasm-build-badge ' + (active ? 'compiling' : ready ? 'ready' : 'failed');
    if (active) sessionStorage.setItem('ww_wasm_compiling', '1');
    else sessionStorage.removeItem('ww_wasm_compiling');
    if (ready) readyHideTimer = setTimeout(() => badge.remove(), 12000);
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
      syncBuildBadge(info);
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
