/** Clean URL routing, with browser dependencies injected for automated tests. */
(function (root) {
  function createRouter({ routes, history, location, events, authenticated, allowed, render, denied, home }) {
    let pendingPath = null;
    let started = false;
    const normalize = path => path.length > 1 ? path.replace(/\/+$/, '') : path;
    const resolve = path => routes.find(route => route.path === normalize(path)) || null;
    function resolveInternal(target) {
      if (typeof target !== 'string' || !target.startsWith('/') || /[\\\s]/.test(target) || target.startsWith('//')) return null;
      try {
        const url = new URL(target, location.origin || 'http://localhost');
        return url.origin === (location.origin || 'http://localhost') ? resolve(url.pathname) : null;
      } catch { return null; }
    }
    function dispatch() {
      const route = resolve(location.pathname);
      if (location.pathname === '/') {
        const query = new URLSearchParams(location.search);
        const target = query.has('token') || query.has('reset_token') ? '/reset-password' : (authenticated() ? home() : '/login');
        return navigate(target + location.search, { replace: true });
      }
      if (!route) { denied(404, null); return; }
      if (route.auth && !authenticated()) {
        pendingPath = location.pathname + location.search;
        return navigate('/login', { replace: true });
      }
      if (route.path === '/login' && authenticated()) {
        const target = pendingPath || home(); pendingPath = null;
        return navigate(target, { replace: true });
      }
      if (route.auth && !allowed(route)) { denied(403, route); return; }
      render(route);
    }
    function navigate(target, { replace = false } = {}) {
      const url = new URL(target, location.origin || 'http://localhost');
      if (url.origin !== (location.origin || 'http://localhost') || !resolve(url.pathname)) return false;
      const path = normalize(url.pathname) + url.search;
      if (location.pathname + location.search !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
      dispatch();
      return true;
    }
    function start() { if (started) return; started = true; events.addEventListener('popstate', dispatch); dispatch(); }
    function stop() { if (!started) return; started = false; events.removeEventListener('popstate', dispatch); }
    return { resolve, resolveInternal, navigate, start, stop, refresh: dispatch };
  }
  root.ATS_ROUTING = { createRouter };
})(typeof window === 'undefined' ? globalThis : window);
