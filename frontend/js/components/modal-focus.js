(function () {
  if (typeof MutationObserver === 'undefined') return;
  const managed = new Set(['create-user-modal', 'bulk-import-user-modal', 'create-candidate-modal', 'schedule-interview-modal', 'bulk-interview-modal', 'create-offer-modal', 'offer-preview-modal', 'question-bank-modal']);
  const management = new Set(['recruitment-catalog-modal', 'department-modal', 'competency-framework-modal', 'job-title-modal']);
  management.forEach(id => managed.add(id));
  const openers = new Map();
  const visible = modal => !modal.classList.contains('hidden') && modal.getClientRects().length;
  const controls = modal => [...modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(node => !node.disabled && node.getAttribute('tabindex') !== '-1' && node.getClientRects().length);
  const topModal = () => [...document.querySelectorAll('.modal-overlay')].filter(visible).sort((a,b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex)).at(-1);
  const update = changes => {
    for (const {target:modal} of changes) {
      if (modal.classList.contains('hidden')) modal.querySelectorAll('.management-modal:not(.hidden)').forEach(child => child.classList.add('hidden'));
      if (!managed.has(modal.id)) continue;
      if (visible(modal) && !openers.has(modal)) {
        const explicitOpener = {
          'recruitment-catalog-modal': 'recruitment-catalog-new-btn',
          'department-modal': 'department-new-btn',
          'competency-framework-modal': 'competency-framework-new-btn',
          'job-title-modal': 'job-title-new-btn'
        }[modal.id];
        const opener = explicitOpener
          ? document.getElementById(explicitOpener)
          : document.activeElement;
        openers.set(modal, opener);
        if (topModal() === modal) (modal.querySelector('.modal-close') || controls(modal)[0])?.focus();
      } else if (!visible(modal) && openers.has(modal)) {
        const opener = openers.get(modal); openers.delete(modal);
        if (!topModal() && opener?.isConnected && opener.getClientRects().length) opener.focus();
      }
    }
  };
  new MutationObserver(update).observe(document.body, {subtree:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('click', event => {
    const trigger = event.target.closest?.('[data-close-management-modal]');
    const id = trigger?.getAttribute('data-close-management-modal') || event.target.id;
    if (!management.has(id)) return;
    const modal = document.getElementById(id);
    if (modal?.getAttribute('aria-busy') !== 'true') modal?.classList.add('hidden');
  });
  document.addEventListener('keydown', event => {
    const modal = topModal();
    if (!modal || !managed.has(modal.id)) return;
    if (event.key === 'Escape') { event.preventDefault(); modal.querySelector('.modal-close')?.click(); }
    if (event.key === 'Tab') {
      const nodes = controls(modal), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });
})();
