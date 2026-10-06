/** Navigation activates retained pages without rebinding their listeners. */
function leaveActivePage() {
  window.ATS_MOBILE_NAVIGATION.close();
  window.ATS_ACTION_MENU.close();
  closeCreateUserResultDialog();
  document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.add('hidden'));
  if (resendCooldownTimer) { clearInterval(resendCooldownTimer); resendCooldownTimer = null; }
  if (currentActiveView === 'careerPage') clearCareerPagePreviewObjectUrls();
  if (typeof auditDebounceTimer !== 'undefined') clearTimeout(auditDebounceTimer);
}

function activateRoute(route) {
  leaveActivePage();
  Object.values(views).forEach(view => view?.classList.add('hidden'));
  const publicPage = !route.auth;
  loginView.classList.toggle('hidden', !publicPage);
  appShell.classList.toggle('hidden', publicPage);
  window.ATS_MOBILE_NAVIGATION.updateActions();
  if (publicPage) {
    currentActiveView = route.view;
    if (route.view === 'forgot-password') {
      forgotModal.classList.remove('hidden');
      if (otpForm && !otpForm.classList.contains('hidden')) resumeResendCooldown();
    } else if (route.view === 'reset-password') {
      resetModal.classList.remove('hidden');
      const query = new URLSearchParams(window.location.search);
      const token = query.get('token') || query.get('reset_token');
      if (token) {
        resetTokenInput.value = token;
        window.history.replaceState({}, '', '/reset-password');
      }
    }
    return;
  }
  activateView(route.view);
}
