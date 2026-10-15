  // ==============================================================================
  // 13. ROLES & PERMISSIONS MATRIX (REAL BACKEND API)
  // ==============================================================================

  async function loadRolesMatrix() {
    const token = sessionStorage.getItem('ats_token');
    if (!token) return;

    try {
      const res = await window.ATS_API.getRolesMatrixApi(token);
      if (res.ok && res.data && res.data.success) {
        const { roles, permissions, matrix } = res.data.data;

        // Render Role Cards
        const cardsContainer = document.getElementById('roles-cards-container');
        if (cardsContainer) {
          cardsContainer.innerHTML = roles.map(r => `
            <div class="panel-card" style="padding: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <strong style="color: var(--color-primary); font-size: 1rem;">${ROLE_LABELS[r.name] || r.name}</strong>
                <span class="badge badge-primary font-mono">${r.name}</span>
              </div>
              <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 12px; line-height: 1.4;">
                ${r.description || 'Vai trò người dùng trong hệ thống'}
              </p>
              <div style="font-size: 0.775rem; color: var(--color-text-muted);">
                Số quyền sở hữu: <strong style="color: var(--color-text);">${matrix[r.name] ? matrix[r.name].length : 0} quyền</strong>
              </div>
            </div>
          `).join('');
        }

        // Render Matrix Table
        const matrixContainer = document.getElementById('rbac-matrix-table-container');
        if (matrixContainer) {
          matrixContainer.innerHTML = `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="min-width: 220px;">Quyền hạn hệ thống</th>
                  <th style="min-width: 140px;">Phân hệ</th>
                  ${roles.map(r => `<th style="text-align: center; font-size: 0.725rem;">${r.name}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${permissions.map(p => {
                  const roleChecks = roles.map(r => {
                    const hasPerm = matrix[r.name] && matrix[r.name].includes(p.name);
                    return `
                      <td style="text-align: center;">
                        ${hasPerm
                          ? `<span style="color: var(--color-success); font-weight: 700; font-size: 1.1rem;">✓</span>`
                          : `<span style="color: var(--color-text-muted); opacity: 0.3;">—</span>`}
                      </td>
                    `;
                  }).join('');

                  return `
                    <tr>
                      <td>
                        <div style="font-weight: 600; color: var(--color-text);">${p.description || p.name}</div>
                        <code class="font-mono" style="font-size: 0.75rem; color: var(--color-text-muted);">${p.name}</code>
                      </td>
                      <td><span class="badge badge-neutral" style="font-size: 0.725rem;">${p.module || 'Hệ thống'}</span></td>
                      ${roleChecks}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `;
        }
      }
    } catch (e) {
      console.error('Failed to load roles matrix:', e);
    }
  }
