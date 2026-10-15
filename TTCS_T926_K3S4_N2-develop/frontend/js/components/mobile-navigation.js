/** Responsive presentation of the existing authenticated sidebar; no second route list. */
window.ATS_MOBILE_NAVIGATION = (() => {
  const drawer = document.getElementById('app-sidebar');
  const toggle = document.getElementById('sidebar-toggle-btn');
  const dismiss = document.getElementById('sidebar-close-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  const content = document.getElementById('app-content-wrapper');
  const title = document.getElementById('mobile-page-title');
  const create = document.getElementById('topbar-create-req-btn');
  let opened = false, locked = null;
  const mobile = () => window.innerWidth <= 768;
  const authenticated = () => !!currentAuthenticatedUser && !!sessionStorage.getItem('ats_token') && !appShell.classList.contains('hidden');
  const canCreate = () => authenticated() && Array.isArray(currentAuthenticatedUser.permissions) && currentAuthenticatedUser.permissions.includes('requisition.create');
  function updateActions() { create?.classList.toggle('hidden', !canCreate()); }
  function updateTitle(value) { if (title) { title.textContent = value; title.setAttribute('title', value); } }
  function focusableItems() {
    return Array.from(drawer.querySelectorAll('button, [tabindex="0"], a[href]')).filter(item =>
      !item.disabled && !item.hidden && !item.closest('.hidden') && item.style.display !== 'none');
  }
  function close(restoreFocus = false) {
    const wasOpen = opened;
    const drawerHadFocus = drawer?.contains(document.activeElement);
    opened = false;
    drawer?.classList.remove('show-mobile');
    backdrop?.classList.add('hidden');
    appShell.classList.remove('mobile-navigation-open');
    toggle?.setAttribute('aria-expanded', 'false');
    if (drawer) {
      drawer.inert = mobile();
      if (mobile()) drawer.setAttribute('aria-hidden', 'true');
      else drawer.removeAttribute('aria-hidden');
      drawer.removeAttribute('role');
      drawer.removeAttribute('aria-modal');
    }
    if (locked) {
      document.body.style.overflow = locked.bodyOverflow;
      document.documentElement.style.overflow = locked.rootOverflow;
      if (content) content.inert = locked.contentInert;
      locked = null;
    }
    if (wasOpen && (restoreFocus || drawerHadFocus) && authenticated() && mobile()) toggle?.focus();
  }
  function open() {
    if (!mobile() || !authenticated() || !drawer || !backdrop || opened) return;
    window.ATS_ACTION_MENU.close();
    userMenuPopover?.classList.remove('show');
    userMenuBtn?.setAttribute('aria-expanded', 'false');
    opened = true;
    locked = { bodyOverflow: document.body.style.overflow, rootOverflow: document.documentElement.style.overflow, contentInert: content?.inert || false };
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (content) content.inert = true;
    drawer.inert = false;
    drawer.removeAttribute('aria-hidden');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.classList.add('show-mobile');
    backdrop.classList.remove('hidden');
    appShell.classList.add('mobile-navigation-open');
    toggle?.setAttribute('aria-expanded', 'true');
    (focusableItems()[0] || drawer).focus();
  }
  const onToggle = () => opened ? close(true) : open();
  const onDismiss = () => close(true);
  const onResize = () => { if (!mobile() || !opened) close(); };
  function onKey(event) {
    if (!opened) {
      if (event.key === 'Escape' && userMenuPopover?.classList.contains('show')) {
        userMenuPopover.classList.remove('show');
        userMenuBtn?.setAttribute('aria-expanded', 'false');
        userMenuBtn?.focus();
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') {
      const items = focusableItems(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); drawer.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }
  toggle?.addEventListener('click', onToggle);
  dismiss?.addEventListener('click', onDismiss);
  backdrop?.addEventListener('click', onDismiss);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.addEventListener('pagehide', onDismiss);
  close();
  updateActions();
  return {
    open, close, canCreate, updateActions, updateTitle,
    destroy() {
      close();
      toggle?.removeEventListener('click', onToggle);
      dismiss?.removeEventListener('click', onDismiss);
      backdrop?.removeEventListener('click', onDismiss);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onDismiss);
    }
  };
})();
