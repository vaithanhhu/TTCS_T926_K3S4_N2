(function () {
  if (typeof MutationObserver === 'undefined') return;
  const managed = new Set(['create-user-modal', 'bulk-import-user-modal', 'create-candidate-modal', 'schedule-interview-modal', 'bulk-interview-modal', 'create-offer-modal', 'question-bank-modal']);
  const openers = new Map();
  const visible = modal => !modal.classList.contains('hidden') && modal.getClientRects().length;
  const controls = modal => [...modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(node => !node.disabled && node.getAttribute('tabindex') !== '-1' && node.getClientRects().length);
  const topModal = () => [...document.querySelectorAll('.modal-overlay')].filter(visible).sort((a,b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex)).at(-1);
  const update = changes => {
    for (const {target:modal} of changes) {
      if (!managed.has(modal.id)) continue;
      if (visible(modal) && !openers.has(modal)) {
        openers.set(modal, document.activeElement);
        if (topModal() === modal) (modal.querySelector('.modal-close') || controls(modal)[0])?.focus();
      } else if (!visible(modal) && openers.has(modal)) {
        const opener = openers.get(modal); openers.delete(modal);
        if (!topModal() && opener?.isConnected && opener.getClientRects().length) opener.focus();
      }
    }
  };
  new MutationObserver(update).observe(document.body, {subtree:true,attributes:true,attributeFilter:['class']});
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
