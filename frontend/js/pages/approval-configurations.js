(function () {
  const byId = id => document.getElementById(id);
  const form = byId('s301-form'), list = byId('s301-configurations'), levels = byId('s301-levels');
  const department = byId('s301-department'), versionSelect = byId('s301-version');
  const save = byId('s301-save'), publish = byId('s301-publish');
  if (!form || !list || !levels) return;
  let options = { departments: [], approvers: [] }, selected = null, busy = false, revision = 0, ready = false;
  function message(text) { byId('s301-message').textContent = text || ''; byId('s301-alert').classList.toggle('hidden', !text); }
  function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function fill(select, items, placeholder, value = '') {
    select.textContent = '';
    const empty = element('option', placeholder); empty.value = ''; select.appendChild(empty);
    for (const item of items) { const option = element('option', item.name); option.value = item.id; select.appendChild(option); }
    select.value = value;
  }
  function controls() {
    save.disabled = busy || !ready; publish.disabled = busy || !ready || !selected || selected.versions[0].state !== 'DRAFT' || versionSelect.value !== selected.versions[0].id;
    department.disabled = busy || !ready || !!selected;
    byId('s301-add-level').disabled = busy || !ready;
    byId('s301-new').disabled = busy || !ready;
  }
  function addLevel(value = {}) {
    const row = element('div'); row.className = 's301-level form-group'; row.style.padding = '12px'; row.style.border = '1px solid var(--color-border)'; row.style.borderRadius = 'var(--radius-sm)';
    const title = element('strong', 'Cấp ' + (levels.children.length + 1)); title.className = 's301-level-title'; row.appendChild(title);
    const salaryLabel = element('label', 'Hạn mức VND'); salaryLabel.className = 'form-label';
    const salary = element('input'); salary.className = 's301-limit form-input'; salary.type = 'number'; salary.min = '0'; salary.step = 'any'; salary.required = true; salary.value = value.salaryLimit ?? ''; salary.setAttribute('aria-label', 'Hạn mức lương VND'); salaryLabel.appendChild(salary); row.appendChild(salaryLabel);
    const userLabel = element('label', 'Người duyệt'); userLabel.className = 'form-label';
    const user = element('select'); user.className = 's301-approver form-select'; user.required = true; user.setAttribute('aria-label', 'Người duyệt');
    const choices = [...options.approvers]; if (value.approverUserId && !choices.some(item => item.id === value.approverUserId)) choices.push({ id: value.approverUserId, name: (value.approverName || value.approverUserId) + ' — cần kiểm tra quyền' });
    fill(user, choices, 'Chọn người duyệt', value.approverUserId); userLabel.appendChild(user); row.appendChild(userLabel);
    const remove = element('button', 'Xóa cấp', 'btn btn-outline btn-sm'); remove.type = 'button'; remove.className = 's301-remove btn btn-outline btn-sm'; row.appendChild(remove);
    levels.appendChild(row);
  }
  function showVersion() {
    const version = selected?.versions.find(item => item.id === versionSelect.value);
    levels.textContent = '';
    if (version) for (const level of version.levels) addLevel(level); else addLevel();
    byId('s301-version-status').textContent = version ? `Phiên bản ${version.version}: ${version.state === 'PUBLISHED' ? 'Đã công bố' : 'Nháp'}. Thay đổi sẽ tạo phiên bản mới.` : 'Thay đổi luôn được lưu thành phiên bản mới.';
    controls();
  }
  function edit(configuration) {
    selected = configuration;
    department.value = configuration?.departmentId || '';
    fill(versionSelect, configuration ? configuration.versions.map(item => ({ id: item.id, name: 'Phiên bản ' + item.version + ' — ' + item.state })) : [], 'Chọn phiên bản', configuration?.versions[0].id || '');
    showVersion();
  }
  function renderList(items) {
    list.textContent = '';
    if (!items.length) { const row = element('tr'); const cell = element('td', 'Chưa có cấu hình phê duyệt.'); cell.colSpan = 4; row.appendChild(cell); list.appendChild(row); }
    for (const item of items) {
      const row = element('tr'); for (const text of [item.departmentName, item.publishedVersion ?? 'Chưa công bố', item.latestVersion]) row.appendChild(element('td', text));
      const cell = element('td'), button = element('button', 'Xem / Tạo phiên bản', 'btn btn-outline btn-sm'); button.type = 'button'; button.setAttribute('data-configuration-id', item.id); cell.appendChild(button); row.appendChild(cell); list.appendChild(row);
    }
  }
  async function load() {
    if (busy) return;
    const current = ++revision, token = sessionStorage.getItem('ats_token');
    ready = false; selected = null; list.textContent = ''; levels.textContent = ''; controls(); message('');
    const [settings, configurations] = await Promise.all([window.ATS_APPROVAL_CONFIGURATION_API.request('/options'), window.ATS_APPROVAL_CONFIGURATION_API.request()]);
    if (current !== revision || token !== sessionStorage.getItem('ats_token')) return;
    if (!settings.ok || !configurations.ok) { message((!settings.ok ? settings : configurations).data.message); list.textContent = ''; levels.textContent = ''; selected = null; controls(); return; }
    options = settings.data.data; fill(department, options.departments, 'Chọn phòng ban'); ready = true;
    renderList(configurations.data.data); edit(null); controls();
  }
  async function mutate(action) {
    if (busy || !ready) return;
    busy = true; controls(); message('');
    const token = sessionStorage.getItem('ats_token');
    const current = revision;
    try {
      const result = await action();
      if (current !== revision || token !== sessionStorage.getItem('ats_token')) return;
      if (!result.ok) { message(result.data.message); return; }
      edit(result.data.data);
      const items = await window.ATS_APPROVAL_CONFIGURATION_API.request();
      if (current !== revision || token !== sessionStorage.getItem('ats_token')) return;
      if (items.ok) renderList(items.data.data); else message('Đã lưu cấu hình, nhưng chưa tải lại được danh sách.');
      showToast('success', 'Cấu hình phê duyệt', 'Đã cập nhật phiên bản cấu hình.');
    } finally { busy = false; controls(); if (current !== revision && currentActiveView === 'approval-configurations') load(); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = Array.from(levels.children).map((row, index) => ({ order: index + 1, salaryLimit: row.querySelector('.s301-limit').value, approverUserId: row.querySelector('.s301-approver').value }));
    if (new Set(values.map(level => level.approverUserId)).size !== values.length) { message('Mỗi người chỉ được xuất hiện một lần trong chuỗi phê duyệt.'); return; }
    return mutate(() => selected
      ? window.ATS_APPROVAL_CONFIGURATION_API.request('/' + selected.id + '/versions', 'POST', { levels: values, expectedVersion: selected.versions[0].version })
      : window.ATS_APPROVAL_CONFIGURATION_API.request('', 'POST', { departmentId: department.value, levels: values }));
  });
  publish.addEventListener('click', () => mutate(() => window.ATS_APPROVAL_CONFIGURATION_API.request('/' + selected.id + '/versions/' + selected.versions[0].id + '/publish', 'POST', {})));
  byId('s301-add-level').addEventListener('click', () => { if (!busy && ready) addLevel(); });
  levels.addEventListener('click', event => {
    const button = event.target.closest('.s301-remove'); if (!button || busy) return;
    button.parentNode.remove(); Array.from(levels.children).forEach((row, index) => { row.querySelector('.s301-level-title').textContent = 'Cấp ' + (index + 1); });
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-configuration-id]'); if (!button || busy || !ready) return;
    const current = ++revision, token = sessionStorage.getItem('ats_token');
    const result = await window.ATS_APPROVAL_CONFIGURATION_API.request('/' + button.getAttribute('data-configuration-id'));
    if (current !== revision || token !== sessionStorage.getItem('ats_token')) return;
    if (result.ok) edit(result.data.data); else message(result.data.message);
  });
  versionSelect.addEventListener('change', showVersion);
  byId('s301-new').addEventListener('click', () => { if (!busy && ready) { edit(null); message(''); } });
  byId('s301-refresh').addEventListener('click', load);
  function leave() { revision++; ready = false; selected = null; options = { departments: [], approvers: [] }; list.textContent = ''; levels.textContent = ''; department.textContent = ''; versionSelect.textContent = ''; message(''); controls(); }
  window.ATS_APPROVAL_CONFIGURATION_PAGE = { load, leave };
})();
