/** One body-level action menu for retained pages and organization nodes. */
window.ATS_ACTION_MENU = (() => {
  const menu = document.getElementById('users-action-menu');
  let active = null;
  function close(restoreFocus = false, owner = null) {
    if (owner && active?.owner !== owner) return;
    const trigger = active?.trigger;
    trigger?.setAttribute('aria-expanded', 'false');
    menu?.classList.add('hidden');
    if (menu) menu.textContent = '';
    active = null;
    if (restoreFocus) trigger?.focus();
  }
  function position(trigger) {
    const gap = 6, edge = 8, rect = trigger.getBoundingClientRect();
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
    const above = Math.max(0, rect.top - gap - edge);
    menu.style.maxHeight = Math.max(0, window.innerHeight - edge * 2) + 'px';
    const bounds = menu.getBoundingClientRect();
    const openAbove = bounds.height > below && above > below;
    const available = openAbove ? above : below;
    menu.style.maxHeight = available + 'px';
    const height = Math.min(bounds.height, available);
    menu.style.left = Math.max(edge, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - edge)) + 'px';
    menu.style.top = Math.max(edge, openAbove ? rect.top - gap - height : rect.bottom + gap) + 'px';
  }
  function toggle(options) {
    if (options.trigger === active?.trigger) { close(true); return; }
    close();
    if (!menu || options.trigger.disabled || !options.items.length || !options.valid()) return;
    active = options;
    menu.setAttribute('aria-label', options.label);
    options.trigger.setAttribute('aria-expanded', 'true');
    options.items.forEach(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-menu-item' + (action.tone ? ' action-menu-' + action.tone : '');
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-action-menu-item', action.code);
      if (options.itemAttribute) button.setAttribute(options.itemAttribute, action.code);
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = action.icon;
      button.appendChild(icon);
      const label = document.createElement('span');
      label.textContent = action.label;
      button.appendChild(label);
      menu.appendChild(button);
    });
    menu.classList.remove('hidden');
    position(options.trigger);
    menu.querySelector('[role="menuitem"]')?.focus();
  }
  // Portal outside table/tree overflow and transform stacking contexts.
  if (menu) document.body.appendChild(menu);
  menu?.addEventListener('click', event => {
    const item = event.target.closest('[data-action-menu-item]');
    if (!item || !menu.contains(item) || !active) return;
    const selected = active, code = item.getAttribute('data-action-menu-item');
    if (!selected.valid() || !selected.items.some(action => action.code === code)) { close(); return; }
    close(true);
    return selected.onSelect(code);
  });
  menu?.addEventListener('keydown', event => {
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[nextIndex]?.focus();
    } else if (event.key === 'Tab') close(true);
  });
  document.addEventListener('click', event => {
    if (active && !active.trigger.contains(event.target) && !menu.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.preventDefault(); close(true); }
  });
  document.addEventListener('scroll', event => {
    if (active && !menu.contains(event.target)) close();
  }, true);
  window.addEventListener('resize', () => close());
  return { toggle, close };
})();
