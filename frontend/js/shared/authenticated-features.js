/** Retained scripts may load at login; their private effects start only after session validation. */
(function () {
  let suspended = false;
  function canUse(permission) {
    const user = typeof currentAuthenticatedUser === 'undefined' ? null : currentAuthenticatedUser;
    const token = sessionStorage.getItem('ats_token');
    const expiresAt = sessionStorage.getItem('ats_expires_at');
    return Boolean(!suspended && user && token && !user.mustChangePassword &&
      (!expiresAt || Date.parse(expiresAt) > Date.now()) &&
      (!permission || user.roles?.includes('ADMIN') || user.permissions?.includes(permission)) &&
      !document.getElementById('app-shell')?.classList.contains('hidden'));
  }

  function reportError(feature, reason) {
    const error = reason instanceof Error ? reason : new Error(reason?.message || 'Không thể hoàn tất thao tác. Vui lòng thử lại.');
    console.error('[ATS ' + feature + ']', error);
    if (typeof showToast === 'function') showToast('danger', feature, error.message);
  }

  function acceptResponse(token, response) {
    if (token !== sessionStorage.getItem('ats_token')) return false;
    if (response.status === 401) { handleSessionExpired(); return false; }
    return true;
  }

  function refresh() {
    suspended = false;
    if (canUse('candidate.read') && currentAuthenticatedUser.roles?.some(role => ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role))) {
      Promise.resolve(window.CandidateSlaModule?.init()).catch(error => reportError('SLA', error));
    } else window.CandidateSlaModule?.leave();
    if (['candidates', 'requisitions'].includes(currentActiveView)) {
      if (canUse('candidate.update') || canUse('requisition.read')) window.CandidateScreening?.init();
      if (currentActiveView === 'candidates' && canUse('candidate.create')) window.CandidateManualEntry?.init();
    }
    if (currentActiveView === 'candidates' && canUse('candidate.merge.undo')) {
      loadCandidateMergeUndoList();
    }
  }

  function leave({ keepSla = false } = {}) {
    if (!keepSla) suspended = true;
    window.CandidateManualEntry?.leave();
    window.CandidateScreening?.leave();
    if (!keepSla) window.CandidateSlaModule?.leave();
    window.ATS_CANDIDATE_MERGE?.leave();
  }

  window.ATS_AUTHENTICATED_FEATURES = { canUse, refresh, leave, reportError, acceptResponse };
})();
