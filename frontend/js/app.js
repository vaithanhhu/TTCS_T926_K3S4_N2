/** Application bootstrap; page markup and behavior live in pages/ and components/. */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('/routes.json');
    if (!response.ok) throw new Error('Không thể tải cấu hình trang.');
    const manifest = await response.json();
    // Mount once to retain unsaved forms and the existing modal behavior.
    await Promise.all([...document.querySelectorAll('template[data-fragment]')].map(async slot => {
      const result = await fetch(slot.dataset.fragment);
      if (!result.ok) throw new Error('Không thể tải trang ' + slot.dataset.fragment);
      const template = document.createElement('template');
      template.innerHTML = await result.text();
      slot.replaceWith(template.content);
    }));
    // Bind modules once after their DOM exists. Navigation never reloads modules.
    for (const source of manifest.scripts) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = source; script.onload = resolve;
        script.onerror = () => reject(new Error('Không thể tải module ' + source));
        document.body.appendChild(script);
      });
    }
    window.ATS_ROUTE_MANIFEST = manifest;
    window.ATS_ROUTER = window.ATS_ROUTING.createRouter({
      routes: manifest.routes, history: window.history, location: window.location, events: window,
      authenticated: () => !!currentAuthenticatedUser && !!sessionStorage.getItem('ats_token'),
      allowed: route => {
        if (route.menu) return currentAllowedPaths.has(route.menuPath || route.path);
        if (route.view === 'reports') return !currentAuthenticatedUser.roles.includes('CANDIDATE');
        return true;
      },
      home: getAuthenticatedHome,
      render: activateRoute,
      denied: (statusCode, route) => {
        leaveActivePage();
        loginView.classList.add('hidden'); appShell.classList.remove('hidden');
        showErrorView({ statusCode, code: statusCode === 403 ? 'FORBIDDEN_PERMISSION_DENIED' : 'NOT_FOUND', requiredPermission: route?.permission });
      }
    });
    window.ATS_ROUTER.start();
    await checkExistingSession();
    loadPublicCareerPage();
    document.documentElement.dataset.appReady = 'true';
  } catch (error) {
    console.error('[ATS Bootstrap]', error);
    document.body.textContent = 'Không thể tải ứng dụng. Vui lòng tải lại trang.';
  }
});
