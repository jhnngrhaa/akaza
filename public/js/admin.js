/**
 * Akaza Blast - Admin Console Controller
 * Full management of Target Database, Spintax Messages, Blast Engine, Devices, & Withdrawals
 */

const API = '';
let currentAdminTab = 'blast';
let adminEventSource = null;
let activeBlastCampaign = null;

// ─── Admin Authentication Guard ────────────────────────────────────
async function checkAdminAuth() {
  const token = localStorage.getItem('akaza_admin_token');
  if (!token) {
    window.location.href = '/admin/login';
    return false;
  }

  try {
    const res = await fetch(`${API}/api/admin/check-session`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      localStorage.removeItem('akaza_admin_token');
      localStorage.removeItem('akaza_admin_username');
      window.location.href = '/admin/login';
      return false;
    }
    const data = await res.json();
    const userDisplay = document.getElementById('admin-user-display');
    if (userDisplay && data.username) userDisplay.textContent = `@${data.username}`;
    return true;
  } catch (err) {
    return true;
  }
}

async function handleAdminLogout() {
  if (!confirm('Yakin ingin keluar dari Console Admin?')) return;
  const token = localStorage.getItem('akaza_admin_token');
  try {
    await fetch(`${API}/api/admin/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (_) {}
  localStorage.removeItem('akaza_admin_token');
  localStorage.removeItem('akaza_admin_username');
  window.location.href = '/admin/login';
}

// ─── Telegram-style Resizable & Collapsible Sidebar ────────────────
let isSidebarDragging = false;
let startX = 0;
let lastExpandedWidth = 260;

function initSidebarResizer() {
  const sidebar = document.getElementById('admin-sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (!sidebar || !resizer) return;

  // Restore saved width & state
  const savedWidth = localStorage.getItem('admin_sidebar_width');
  const isCollapsed = localStorage.getItem('admin_sidebar_collapsed') === 'true';

  if (savedWidth && !isNaN(parseInt(savedWidth))) {
    const w = parseInt(savedWidth);
    if (w >= 250 && w <= 460) {
      lastExpandedWidth = w;
      sidebar.style.width = w + 'px';
    } else {
      lastExpandedWidth = 260;
      sidebar.style.width = '260px';
    }
  }

  if (isCollapsed) {
    sidebar.classList.add('collapsed');
    sidebar.style.width = '70px';
  }

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (window.innerWidth <= 900) return;

    isSidebarDragging = true;
    startX = e.clientX || (e.touches && e.touches[0].clientX);
    document.body.classList.add('is-resizing');

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isSidebarDragging) return;
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX);
    if (clientX === undefined) return;

    const sidebarLeft = sidebar.getBoundingClientRect().left;
    let newWidth = clientX - sidebarLeft;

    // Telegram Desktop snap threshold:
    // If dragged smaller than 215px, snap into clean collapsed icon column (70px).
    // NEVER allow the awkward squished intermediate state where text is truncated!
    if (newWidth < 215) {
      if (!sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
      }
      sidebar.style.width = '70px';
    } else {
      // Expanded mode: minimum 250px so all texts fit comfortably without "..." truncation
      if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
      }
      if (newWidth < 250) newWidth = 250;
      if (newWidth > 460) newWidth = 460;
      sidebar.style.width = newWidth + 'px';
      lastExpandedWidth = newWidth;
    }
  };

  const onPointerUp = () => {
    if (!isSidebarDragging) return;
    isSidebarDragging = false;
    document.body.classList.remove('is-resizing');

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);

    const isCollapsedNow = sidebar.classList.contains('collapsed');
    localStorage.setItem('admin_sidebar_collapsed', isCollapsedNow ? 'true' : 'false');
    if (!isCollapsedNow) {
      localStorage.setItem('admin_sidebar_width', lastExpandedWidth.toString());
    }
  };

  resizer.addEventListener('pointerdown', onPointerDown);

  // Double click to toggle collapse/expand
  resizer.addEventListener('dblclick', () => {
    toggleSidebarCollapse();
  });
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('admin-sidebar');
  if (!sidebar) return;

  if (sidebar.classList.contains('collapsed')) {
    sidebar.classList.remove('collapsed');
    const targetW = (lastExpandedWidth && lastExpandedWidth >= 250) ? lastExpandedWidth : 260;
    sidebar.style.width = targetW + 'px';
    localStorage.setItem('admin_sidebar_collapsed', 'false');
    localStorage.setItem('admin_sidebar_width', targetW.toString());
  } else {
    const curW = sidebar.getBoundingClientRect().width;
    if (curW >= 250) lastExpandedWidth = curW;
    sidebar.classList.add('collapsed');
    sidebar.style.width = '70px';
    localStorage.setItem('admin_sidebar_collapsed', 'true');
  }
}

// ─── Initialize ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const isAuthed = await checkAdminAuth();
  if (!isAuthed) return;

  initSidebarResizer();
  connectAdminSSE();
  setupLivePreview();
  await refreshMetrics();
  await loadDraftSetup();
  await loadAdminUsers();
  await loadAdminDevices();
  await loadAdminWithdrawals();
  await loadAdminLogs();

  // Close modals on backdrop click
  ['reject-wd-modal', 'approve-wd-modal', 'create-user-modal', 'edit-saldo-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) el.style.display = 'none';
      });
    }
  });

  // Periodically refresh metrics every 5s & auto-check withdrawals every 4s
  setInterval(refreshMetrics, 5000);
  setInterval(loadAdminWithdrawals, 4000);
});

// ─── Tab Switching ─────────────────────────────────────────────────
function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  ['blast', 'users', 'devices', 'withdrawals', 'logs'].forEach(t => {
    const view = document.getElementById(`admin-view-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (view) view.style.display = t === tabName ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tabName);
  });

  if (tabName === 'users') loadAdminUsers();
  if (tabName === 'devices') loadAdminDevices();
  if (tabName === 'withdrawals') loadAdminWithdrawals();
  if (tabName === 'logs') loadAdminLogs();
}

// ─── SSE Real-time Updates ─────────────────────────────────────────
function connectAdminSSE() {
  const dot = document.getElementById('sse-dot');
  const label = document.getElementById('sse-label');

  if (adminEventSource) adminEventSource.close();
  adminEventSource = new EventSource(`${API}/api/events`);

  adminEventSource.onopen = () => {
    if (dot) dot.style.background = '#10B981';
    if (label) label.textContent = 'Live';
  };

  adminEventSource.onerror = () => {
    if (dot) dot.style.background = '#ef4444';
    if (label) label.textContent = 'Offline';
  };

  adminEventSource.addEventListener('blast_progress', (e) => {
    try {
      const data = JSON.parse(e.data);
      updateBlastMonitor(data);
    } catch (_) {}
  });

  adminEventSource.addEventListener('device_update', () => {
    loadAdminDevices();
    refreshMetrics();
  });

  adminEventSource.addEventListener('message_log', (e) => {
    try {
      const log = JSON.parse(e.data);
      prependAdminLogRow(log);
      refreshMetrics();
    } catch (_) {}
  });

  adminEventSource.addEventListener('withdrawal_update', () => {
    loadAdminWithdrawals();
    refreshMetrics();
  });

  adminEventSource.addEventListener('user_update', () => {
    loadAdminUsers();
    refreshMetrics();
  });

  adminEventSource.addEventListener('contacts_update', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.removedPhone) {
        removeContactFromTextarea(data.removedPhone);
      }
      const metric = document.getElementById('metric-target-count');
      const indicator = document.getElementById('target-count-indicator');
      if (metric && data.remainingCount !== undefined) metric.textContent = data.remainingCount;
      if (indicator && data.remainingCount !== undefined) indicator.textContent = data.remainingCount;
    } catch (_) {}
  });
}

// ─── Metrics Overview ──────────────────────────────────────────────
async function refreshMetrics() {
  try {
    const res = await fetch(`${API}/api/status`);
    if (!res.ok) return;
    const statusData = await res.json();

    const devOn = document.getElementById('metric-devices-online');
    const devTot = document.getElementById('metric-devices-total');
    const bStatus = document.getElementById('metric-blast-status');
    const bSub = document.getElementById('metric-blast-sub');

    if (devOn) devOn.textContent = statusData.activeDevices || 0;
    if (devTot) devTot.textContent = statusData.totalSessions || 0;

    const tabBadge = document.getElementById('tab-devices-badge');
    if (tabBadge) {
      const activeDevs = statusData.activeDevices || 0;
      tabBadge.textContent = activeDevs;
      tabBadge.setAttribute('data-empty', activeDevs === 0 ? 'true' : 'false');
    }

    if (statusData.blastActive) {
      if (bStatus) {
        bStatus.textContent = 'RUNNING';
        bStatus.style.color = '#10b981';
      }
      if (bSub) bSub.textContent = 'Sedang mengirim pesan';
    } else {
      if (bStatus) {
        bStatus.textContent = 'IDLE';
        bStatus.style.color = '#64748b';
      }
      if (bSub) bSub.textContent = 'Siap meluncurkan';
    }

    if (statusData.blastProgress) {
      updateBlastMonitor(statusData.blastProgress);
    }
  } catch (_) {}
}

// ─── Live Preview & Target Counter ─────────────────────────────────
function setupLivePreview() {
  const msgInput = document.getElementById('admin-message-input');
  const contactsInput = document.getElementById('admin-contacts-input');

  if (msgInput) {
    msgInput.addEventListener('input', updatePreviewBubble);
  }

  if (contactsInput) {
    contactsInput.addEventListener('input', updateTargetCount);
  }

  updatePreviewBubble();
  updateTargetCount();
}

function updateTargetCount() {
  const input = document.getElementById('admin-contacts-input');
  if (!input) return;
  const lines = input.value.split('\n').map(l => l.trim()).filter(Boolean);
  const indicator = document.getElementById('target-count-indicator');
  const metric = document.getElementById('metric-target-count');
  if (indicator) indicator.textContent = lines.length;
  if (metric) metric.textContent = lines.length;
}

function removeContactFromTextarea(phone) {
  const input = document.getElementById('admin-contacts-input');
  if (!input) return;
  const cleanTarget = (phone || '').toString().replace(/\D/g, '');
  if (!cleanTarget) return;

  const lines = input.value.split('\n');
  const filtered = lines.filter(line => {
    const cleanLine = line.trim().replace(/\D/g, '');
    if (!cleanLine) return false;
    return cleanLine !== cleanTarget && !cleanLine.endsWith(cleanTarget) && !cleanTarget.endsWith(cleanLine);
  });
  input.value = filtered.join('\n');
  updateTargetCount();
}

function updatePreviewBubble() {
  const msgInput = document.getElementById('admin-message-input');
  const bubble = document.getElementById('preview-bubble');
  const clock = document.getElementById('preview-clock');
  if (!msgInput || !bubble) return;

  const raw = msgInput.value || 'Halo! Selamat datang di promo kami.';
  // Parse simple spintax for preview
  const parsed = raw
    .replace(/\{([^{}]*)\}/g, (_, opts) => opts.split('|')[0])
    .replace(/\{nama\}/gi, '');

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (clock) clock.textContent = timeStr;

  const formattedHtml = escHtml(parsed).replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');
  bubble.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word;line-height:1.45;">${formattedHtml}</div><div class="preview-chat-time"><span>${timeStr}</span> <i class="fa-solid fa-check-double" style="color:#53bdeb;margin-left:3px;"></i></div>`;
}

// ─── Draft Setup (Contacts & Template) ─────────────────────────────
async function loadDraftSetup() {
  try {
    const res = await fetch(`${API}/api/blast/contacts`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.contacts && data.contacts.length) {
      // Just plain phone numbers! No name needed!
      const raw = data.contacts.map(c => c.phone || c).join('\n');
      document.getElementById('admin-contacts-input').value = raw;
      updateTargetCount();
    }
    if (data.message) {
      document.getElementById('admin-message-input').value = data.message;
      updatePreviewBubble();
    }
  } catch (_) {}
}

async function saveDraftSetup() {
  const contactsRaw = document.getElementById('admin-contacts-input').value;
  const message = document.getElementById('admin-message-input').value.trim();
  const title = 'Blast Campaign';

  const contacts = contactsRaw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!contacts.length) {
    showAdminToast('Masukkan minimal 1 nomor target!');
    return false;
  }
  if (!message) {
    showAdminToast('Masukkan isi template pesan!');
    return false;
  }

  try {
    const r = await fetch(`${API}/api/blast/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts, message, title })
    });
    if (r.ok) {
      showAdminToast('✅ Database disimpan! Auto-Blast aktif dan memproses pengiriman.');
      updateTargetCount();
      return true;
    }
  } catch (err) {
    showAdminToast('❌ Gagal menyimpan draft');
  }
  return false;
}

function loadSampleContacts() {
  const sample = [
    '081234567890',
    '085678901234',
    '087890123456',
    '082345678901',
    '089012345678',
    '083456789012',
    '086789012345',
    '084567890123',
    '081977665544',
    '088211335577'
  ].join('\n');

  document.getElementById('admin-contacts-input').value = sample;
  if (!document.getElementById('admin-message-input').value) {
    document.getElementById('admin-message-input').value = '{Halo|Hai|Selamat Siang}! Kami ada penawaran promo spesial diskon hingga 50% untuk kamu hari ini. Yuk cek katalog sekarang!';
  }
  updateTargetCount();
  updatePreviewBubble();
  showAdminToast('📋 10 nomor contoh berhasil dimuat! Klik "Simpan Database" untuk auto-blast.');
}

function clearContactsInput() {
  if (!confirm('Kosongkan database sasaran?')) return;
  document.getElementById('admin-contacts-input').value = '';
  updateTargetCount();
}

// ─── Execute Blast Engine ──────────────────────────────────────────
async function executeAdminBlast() {
  const statusRes = await fetch(`${API}/api/status`);
  const statusData = await statusRes.json();
  if (!statusData.activeDevices || statusData.activeDevices < 1) {
    alert('⚠️ Tidak ada WhatsApp mitra yang online saat ini!\n\nMitra harus menghubungkan WhatsApp di halaman Member terlebih dahulu agar blast bisa dikirim.');
    return;
  }

  const saved = await saveDraftSetup();
  if (!saved) return;

  const btn = document.getElementById('btn-admin-start-blast');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Meluncurkan...';
  }

  try {
    const res = await fetch(`${API}/api/blast/start`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      showAdminToast('🚀 Auto-Blast BERHASIL diaktifkan!');
      refreshMetrics();
    } else {
      showAdminToast(`❌ Gagal: ${d.error || 'Server error'}`);
    }
  } catch (err) {
    showAdminToast('❌ Gagal menghubungi server blast');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Luncurkan Blast Sekarang';
    }
  }
}

async function executeAdminStopBlast() {
  if (!confirm('Hentikan proses pengiriman blast sekarang?')) return;
  try {
    const res = await fetch(`${API}/api/blast/stop`, { method: 'POST' });
    const d = await res.json();
    if (d.success) {
      showAdminToast('🛑 Blast berhasil dihentikan!');
      refreshMetrics();
    }
  } catch (err) {
    showAdminToast('❌ Gagal menghentikan blast');
  }
}

function updateBlastMonitor(progress) {
  const card = document.getElementById('blast-monitor-card');
  if (!card) return;
  const title = document.getElementById('monitor-title');
  const badge = document.getElementById('monitor-badge');
  const statusText = document.getElementById('monitor-status-text');
  const bar = document.getElementById('monitor-bar');
  const percentEl = document.getElementById('monitor-percent');
  const sentEl = document.getElementById('monitor-sent');
  const totalEl = document.getElementById('monitor-total');
  const failedEl = document.getElementById('monitor-failed');

  const total = progress.total || 0;
  const sent = progress.sent || 0;
  const failed = progress.failed || 0;
  const pct = total > 0 ? Math.min(100, Math.round(((sent + failed) / total) * 100)) : 0;

  if (sentEl) sentEl.textContent = sent;
  if (totalEl) totalEl.textContent = total;
  if (failedEl) failedEl.textContent = failed;
  if (percentEl) percentEl.textContent = `${pct}%`;
  if (bar) bar.style.width = `${pct}%`;

  if (progress.status === 'running') {
    if (title) title.textContent = '🚀 Auto-Blast Aktif (Sedang Mengirim Otomatis...)';
    if (statusText) statusText.textContent = 'AUTO-BLAST AKTIF';
    if (badge) {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#10b981';
      badge.style.borderColor = '#a7f3d0';
      badge.querySelector('.dot').style.background = '#10b981';
    }
  } else if (progress.status === 'no_devices') {
    if (title) title.textContent = '⏳ Menunggu WhatsApp Mitra Terhubung / Online...';
    if (statusText) statusText.textContent = 'MENUNGGU MITRA';
    if (badge) {
      badge.style.background = '#fef3c7';
      badge.style.color = '#d97706';
      badge.style.borderColor = '#fcd34d';
      badge.querySelector('.dot').style.background = '#d97706';
    }
  } else if (progress.status === 'done') {
    if (title) title.textContent = '✅ Selesai! Semua nomor sasaran telah terkirim';
    if (statusText) statusText.textContent = 'SELESAI';
    if (badge) {
      badge.style.background = '#ecfdf5';
      badge.style.color = '#10b981';
      badge.style.borderColor = '#a7f3d0';
      badge.querySelector('.dot').style.background = '#10b981';
    }
  } else if (progress.status === 'stopped') {
    if (title) title.textContent = '🛑 Pengiriman Dihentikan Manual';
    if (statusText) statusText.textContent = 'STOPPED';
    if (badge) {
      badge.style.background = '#fef2f2';
      badge.style.color = '#ef4444';
      badge.style.borderColor = '#fca5a5';
      badge.querySelector('.dot').style.background = '#ef4444';
    }
  } else {
    if (title) title.textContent = 'Auto-Blast Standby (Otomatis Mengirim Saat Nomor Disimpan)';
    if (statusText) statusText.textContent = 'STANDBY';
    if (badge) {
      badge.style.background = '#ffffff';
      badge.style.color = 'var(--primary)';
      badge.style.borderColor = '#c7d2fe';
      badge.querySelector('.dot').style.background = 'var(--primary)';
    }
  }
}

// ─── Tab 2: Devices Monitor ────────────────────────────────────────
async function loadAdminDevices() {
  const container = document.getElementById('admin-devices-container');
  if (!container) return;

  try {
    const res = await fetch(`${API}/api/devices`);
    if (!res.ok) return;
    const devices = await res.json();

    const badge = document.getElementById('tab-devices-badge');
    const onlineCount = devices.filter(d => d.status === 'online').length;
    if (badge) {
      badge.textContent = onlineCount;
      badge.setAttribute('data-empty', onlineCount === 0 ? 'true' : 'false');
    }

    if (!devices.length) {
      container.innerHTML = `
        <div class="clean-panel" style="text-align:center;padding:36px;color:var(--text-muted);">
          <i class="fa-solid fa-mobile-screen-button" style="font-size:36px;opacity:0.3;margin-bottom:12px;display:block;"></i>
          <div style="font-weight:700;">Belum ada perangkat WhatsApp terhubung</div>
          <div style="font-size:12px;margin-top:4px;">Mitra dapat menambahkan nomor WhatsApp mereka di Portal Member.</div>
        </div>`;
      return;
    }

    container.innerHTML = devices.map(dev => {
      const isOnline = dev.status === 'online';
      const isConnecting = dev.status === 'connecting' || dev.status === 'qr_ready';
      const statusBadge = isOnline ? 'connected' : isConnecting ? 'connecting' : 'disconnected';
      const statusText = isOnline ? 'CONNECTED' : isConnecting ? 'CONNECTING' : 'OFFLINE';

      return `
      <div class="device-card-item" id="admin-dev-${dev.id}">
        <div class="device-card-header">
          <div class="device-id-title">
            <span class="device-label">DEVICE</span>
            <span class="device-id-text">${escHtml(dev.id)}</span>
          </div>
          <div class="device-status-pill ${statusBadge}">
            <span class="dot"></span>
            <span>${statusText}</span>
          </div>
        </div>

        <div class="device-phone-row">
          <span class="device-label">No. WA</span>
          <span class="device-phone-val">${dev.phone ? '+' + dev.phone.replace(/\D/g,'') : '-'}</span>
          <span style="margin-left:auto;font-size:12px;color:var(--text-muted);">
            Mode: <strong>${dev.mode || 'NORMAL (10s)'}</strong>
          </span>
        </div>

        <div class="device-stats-row">
          <div class="stat-pill pill-sent">
            <i class="fa-solid fa-paper-plane"></i> Sent Today: <strong>${dev.sentToday || 0}</strong>
          </div>
          <div class="stat-pill pill-delivered">
            <i class="fa-solid fa-check-double"></i> Delivered: <strong>${dev.deliveredCount || dev.sentToday || 0}</strong>
          </div>
          <div class="stat-pill pill-profit">
            <i class="fa-solid fa-coins"></i> Total Komisi: <strong>Rp ${(dev.profit || ((dev.sentToday || 0) * 900)).toLocaleString('id-ID')}</strong>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px;">
          ${isOnline ? `
            <button class="btn-secondary" style="font-size:12px;padding:6px 12px;color:#ef4444;" onclick="adminDisconnectDevice('${dev.id}')">
              <i class="fa-solid fa-arrow-right-from-bracket"></i> Putuskan WA
            </button>
          ` : ''}
          <button class="btn-danger" style="font-size:12px;padding:6px 12px;" onclick="adminDeleteDevice('${dev.id}')">
            <i class="fa-solid fa-trash-can"></i> Hapus
          </button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="clean-panel" style="color:#ef4444;">Gagal memuat perangkat</div>';
  }
}

async function adminDisconnectDevice(id) {
  if (!confirm(`Putuskan WhatsApp device ${id}?`)) return;
  await fetch(`${API}/api/devices/${id}/disconnect`, { method: 'POST' });
  loadAdminDevices();
  refreshMetrics();
  showAdminToast('WhatsApp diputuskan');
}

async function adminDeleteDevice(id) {
  if (!confirm(`Hapus device ${id} secara permanen?`)) return;
  await fetch(`${API}/api/devices/${id}`, { method: 'DELETE' });
  loadAdminDevices();
  refreshMetrics();
  showAdminToast('Device dihapus');
}

let lastPendingWithdrawalCount = -1;
let currentWithdrawalsList = [];

// ─── Tab 3: Withdrawals ────────────────────────────────────────────
async function loadAdminWithdrawals() {
  const tbody = document.getElementById('admin-withdrawals-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API}/api/withdrawals`);
    if (!res.ok) return;
    const list = await res.json();
    currentWithdrawalsList = list;

    const badge = document.getElementById('tab-withdraw-badge');
    const pendingCount = list.filter(w => w.status === 'pending').length;
    if (badge) {
      badge.textContent = pendingCount;
      badge.setAttribute('data-empty', pendingCount === 0 ? 'true' : 'false');
      if (pendingCount > 0) {
        badge.style.background = '#f59e0b';
        badge.style.color = '#fff';
        badge.style.fontWeight = '800';
      } else {
        badge.style.background = '';
        badge.style.color = '';
        badge.style.fontWeight = '';
      }
    }

    if (lastPendingWithdrawalCount !== -1 && pendingCount > lastPendingWithdrawalCount) {
      showAdminToast(`🔔 Ada ${pendingCount - lastPendingWithdrawalCount} permintaan penarikan saldo baru masuk!`);
    }
    lastPendingWithdrawalCount = pendingCount;

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">
            Belum ada permintaan penarikan saldo dari mitra.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = list.map(w => {
      const isPending = w.status === 'pending';
      const isRejected = w.status === 'rejected';
      const isApproved = w.status === 'approved' || w.status === 'paid';

      // Date & Time formatting
      let dateDisplay = '—';
      let timeDisplay = '';
      if (w.requestedAt) {
        const d = new Date(w.requestedAt);
        if (!isNaN(d.getTime())) {
          dateDisplay = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
          timeDisplay = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
        }
      }

      // Bank Badge
      const bankUpper = (w.bank || '').toUpperCase().trim();
      let bankBadge = `<span style="color:#94a3b8;font-weight:600;">—</span>`;
      if (bankUpper === 'DANA') {
        bankBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#eff6ff;color:#1d4ed8;letter-spacing:0.4px;"><i class="fa-solid fa-wallet" style="font-size:10px;"></i> DANA</span>`;
      } else if (bankUpper === 'GOPAY') {
        bankBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#ecfdf5;color:#047857;letter-spacing:0.4px;"><i class="fa-solid fa-wallet" style="font-size:10px;"></i> GOPAY</span>`;
      } else if (bankUpper === 'SEABANK') {
        bankBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#fff7ed;color:#c2410c;letter-spacing:0.4px;"><i class="fa-solid fa-building-columns" style="font-size:10px;"></i> SEABANK</span>`;
      } else if (bankUpper) {
        bankBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;letter-spacing:0.4px;">${escHtml(bankUpper)}</span>`;
      }

      // Action column - Icon only (Centang & Tanda Silang)
      let actionContent = '';
      if (isPending) {
        actionContent = `
          <div style="display:inline-flex;gap:6px;align-items:center;justify-content:center;">
            <button type="button" onclick="openApproveWithdrawalModal('${w.id}')" title="Setujui (Sudah Ditransfer Manual)" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;box-shadow:0 1px 2px rgba(16,185,129,0.2);transition:background 0.15s,transform 0.1s;" onmouseover="this.style.background='#059669';this.style.transform='scale(1.05)'" onmouseout="this.style.background='#10b981';this.style.transform='scale(1)'">
              <i class="fa-solid fa-check"></i>
            </button>
            <button type="button" onclick="openRejectWithdrawalModal('${w.id}')" title="Tolak Penarikan" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#ef4444;border:1px solid #fecaca;border-radius:8px;cursor:pointer;font-size:13px;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:background 0.15s,transform 0.1s;" onmouseover="this.style.background='#fee2e2';this.style.transform='scale(1.05)'" onmouseout="this.style.background='#fff';this.style.transform='scale(1)'">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        `;
      } else if (isApproved) {
        actionContent = `
          <div style="display:inline-flex;flex-direction:column;align-items:center;gap:3px;">
            <span title="Selesai Ditransfer Manual" style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#ecfdf5;color:#10b981;font-size:12px;border:1px solid #a7f3d0;">
              <i class="fa-solid fa-check"></i>
            </span>
            <span style="font-size:10px;color:#059669;font-weight:700;">Selesai</span>
          </div>
        `;
      } else {
        actionContent = `
          <div style="display:inline-flex;flex-direction:column;align-items:center;gap:3px;" title="Ditolak: ${escHtml(w.rejectReason || 'Ditolak oleh admin')}">
            <span style="width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:#fef2f2;color:#ef4444;font-size:12px;border:1px solid #fecaca;">
              <i class="fa-solid fa-xmark"></i>
            </span>
            <span style="font-size:10px;color:#dc2626;font-weight:700;">Ditolak</span>
          </div>
        `;
      }

      return `
        <tr>
          <td style="white-space:nowrap;">
            <div style="font-weight:600;font-size:12px;color:var(--text-main);">${dateDisplay}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${timeDisplay}</div>
          </td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700;color:var(--primary);font-size:13px;letter-spacing:-0.2px;">
              ${w.username ? `@${escHtml(w.username)}` : (w.userId ? `@${escHtml(w.userId.replace(/^usr_/, ''))}` : '—')}
            </div>
            ${w.userName && w.userName !== w.username ? `<div style="font-size:11px;color:var(--text-muted);font-weight:500;">${escHtml(w.userName)}</div>` : ''}
          </td>
          <td style="white-space:nowrap;">${bankBadge}</td>
          <td style="white-space:nowrap;">
            ${w.accountNumber ? `<span style="font-family:monospace;font-weight:700;font-size:12px;color:var(--text-main);letter-spacing:0.5px;">${escHtml(w.accountNumber)}</span>` : `<span style="color:#94a3b8;font-weight:600;">—</span>`}
          </td>
          <td style="white-space:nowrap;">
            ${w.accountName ? `<span style="font-weight:700;color:var(--text-main);font-size:12.5px;">${escHtml(w.accountName)}</span>` : `<span style="color:#94a3b8;font-weight:600;">—</span>`}
          </td>
          <td style="white-space:nowrap;">
            <span style="font-weight:800;font-size:13px;color:#059669;font-family:monospace;">
              Rp ${(w.amount || 0).toLocaleString('id-ID')}
            </span>
          </td>
          <td style="white-space:nowrap;text-align:center;">${actionContent}</td>
        </tr>`;
    }).join('');
  } catch (_) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat penarikan</td></tr>';
  }
}

// ─── Modal: Reject Withdrawal ─────────────────────────────────────
function openRejectWithdrawalModal(id) {
  const modal = document.getElementById('reject-wd-modal');
  if (!modal) return;
  const wd = currentWithdrawalsList.find(w => String(w.id) === String(id));

  const idEl = document.getElementById('reject-wd-id');
  if (idEl) idEl.value = id;

  const userEl = document.getElementById('reject-wd-user');
  const destEl = document.getElementById('reject-wd-destination');
  const amtEl = document.getElementById('reject-wd-amount');
  const reasonInput = document.getElementById('reject-wd-reason');

  if (userEl) userEl.textContent = wd ? `@${wd.username || wd.userId || '-'} (${wd.userName || 'Mitra'})` : '-';
  if (destEl) destEl.textContent = wd ? `${wd.bank || 'E-Wallet'} • ${wd.accountNumber || '-'} (${wd.accountName || '-'})` : '-';
  if (amtEl) amtEl.textContent = wd ? `Rp ${(wd.amount || 0).toLocaleString('id-ID')}` : '-';
  if (reasonInput) reasonInput.value = 'Nomor rekening/e-wallet tidak valid';

  modal.style.display = 'flex';
  modal.classList.add('active');
  if (reasonInput) setTimeout(() => { reasonInput.focus(); reasonInput.select(); }, 120);
}

function closeRejectWithdrawalModal() {
  const modal = document.getElementById('reject-wd-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

function setRejectReason(reason) {
  const input = document.getElementById('reject-wd-reason');
  if (input) {
    input.value = reason;
    input.focus();
  }
}

async function submitRejectWithdrawal() {
  const id = document.getElementById('reject-wd-id').value;
  const reasonInput = document.getElementById('reject-wd-reason');
  const reason = reasonInput ? reasonInput.value.trim() : '';

  if (!reason) {
    showAdminToast('⚠️ Silakan masukkan alasan penolakan');
    if (reasonInput) reasonInput.focus();
    return;
  }

  const btn = document.getElementById('btn-confirm-reject-wd');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menolak...';
  }

  try {
    const res = await fetch(`${API}/api/withdrawals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (res.ok) {
      showAdminToast('❌ Penarikan ditolak & saldo otomatis dikembalikan ke mitra');
      closeRejectWithdrawalModal();
      loadAdminWithdrawals();
    } else {
      const data = await res.json().catch(() => ({}));
      showAdminToast(`❌ Gagal: ${data.error || 'Gagal menolak penarikan'}`);
    }
  } catch (_) {
    showAdminToast('❌ Gagal memproses penolakan');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Tolak &amp; Kembalikan Saldo';
    }
  }
}

// ─── Modal: Approve Withdrawal ────────────────────────────────────
function openApproveWithdrawalModal(id) {
  const modal = document.getElementById('approve-wd-modal');
  if (!modal) return;
  const wd = currentWithdrawalsList.find(w => String(w.id) === String(id));

  const idEl = document.getElementById('approve-wd-id');
  if (idEl) idEl.value = id;

  const userEl = document.getElementById('approve-wd-user');
  const destEl = document.getElementById('approve-wd-destination');
  const amtEl = document.getElementById('approve-wd-amount');

  if (userEl) userEl.textContent = wd ? `@${wd.username || wd.userId || '-'} (${wd.userName || 'Mitra'})` : '-';
  if (destEl) destEl.textContent = wd ? `${wd.bank || 'E-Wallet'} • ${wd.accountNumber || '-'} (a.n ${wd.accountName || '-'})` : '-';
  if (amtEl) amtEl.textContent = wd ? `Rp ${(wd.amount || 0).toLocaleString('id-ID')}` : '-';

  modal.style.display = 'flex';
  modal.classList.add('active');
}

function closeApproveWithdrawalModal() {
  const modal = document.getElementById('approve-wd-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

async function submitApproveWithdrawal() {
  const id = document.getElementById('approve-wd-id').value;
  const btn = document.getElementById('btn-confirm-approve-wd');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  }

  try {
    const res = await fetch(`${API}/api/withdrawals/${id}/approve`, { method: 'POST' });
    if (res.ok) {
      showAdminToast('✅ Penarikan berhasil disetujui (Sudah Ditransfer Manual)!');
      closeApproveWithdrawalModal();
      loadAdminWithdrawals();
    } else {
      const data = await res.json().catch(() => ({}));
      showAdminToast(`❌ Gagal: ${data.error || 'Gagal menyetujui penarikan'}`);
    }
  } catch (_) {
    showAdminToast('❌ Gagal memproses persetujuan penarikan');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Ya, Sudah Ditransfer';
    }
  }
}

// Backward compatibility helpers
function approveWithdrawal(id) { openApproveWithdrawalModal(id); }
function rejectWithdrawal(id) { openRejectWithdrawalModal(id); }

// ─── Tab: Database User (Mitra) ────────────────────────────────────
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API}/api/admin/users`);
    if (!res.ok) return;
    const users = await res.json();

    const badge = document.getElementById('tab-users-badge');
    if (badge) {
      badge.textContent = users.length;
      badge.setAttribute('data-empty', users.length === 0 ? 'true' : 'false');
    }

    if (!users.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">
            Belum ada user mitra terdaftar.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td style="font-family:monospace;font-size:12px;color:var(--text-muted);">${escHtml(u.id)}</td>
        <td>
          <div style="font-weight:700;color:var(--text-main);">${escHtml(u.name)}</div>
          <div style="font-size:11.5px;color:var(--primary);font-weight:600;font-family:monospace;">@${escHtml(u.username || '-')}</div>
        </td>
        <td>
          <div style="font-weight:700;">+${escHtml(u.phone || '-')}</div>
          <div style="font-size:11px;color:var(--text-muted);">${escHtml(u.ewallet || 'DANA')}: <strong>${escHtml(u.ewalletNumber || u.phone || '-')}</strong> (${escHtml(u.ewalletName || u.name)})</div>
        </td>
        <td>
          <div style="font-weight:800;color:#10b981;">Rp ${(u.saldo || 0).toLocaleString('id-ID')}</div>
          <div style="font-size:11px;color:#f59e0b;font-weight:700;"><i class="fa-solid fa-gift"></i> ${(u.points || 0).toLocaleString('id-ID')} Perak</div>
        </td>
        <td style="text-align:center;">
          ${(u.activeDevicesCount || 0) > 0 ? `
            <span style="font-weight:700;font-size:11.5px;padding:3px 9px;background:#ecfdf5;color:#047857;border-radius:12px;display:inline-flex;align-items:center;gap:5px;border:1px solid #a7f3d0;" title="${u.activeDevicesCount} dari ${u.totalDevicesCount || u.activeDevicesCount} device sedang online">
              <span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;"></span>
              ${u.activeDevicesCount} Aktif
            </span>
          ` : `
            <span style="font-weight:600;font-size:11px;padding:3px 8px;background:#f8fafc;color:#94a3b8;border-radius:12px;border:1px solid #e2e8f0;" title="${u.totalDevicesCount || 0} device terdaftar, saat ini offline">
              0 Aktif
            </span>
          `}
        </td>
        <td>
          <code style="font-size:11.5px;background:#f8fafc;padding:2px 6px;border-radius:4px;border:1px solid #e2e8f0;font-weight:700;">${escHtml(u.referralCode || '-')}</code>
          <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">${u.totalInvited || 0} diundang</div>
        </td>
        <td style="white-space:nowrap;">
          <div style="display:flex;gap:6px;align-items:center;white-space:nowrap;">
            <button class="btn-secondary" style="font-size:11px;padding:4px 10px;white-space:nowrap;flex-shrink:0;" onclick="openEditSaldoModal('${u.id}', '${escHtml(u.name)}', ${u.saldo || 0})">
              <i class="fa-solid fa-pen-to-square"></i> Saldo
            </button>
            <button class="btn-danger" style="font-size:11px;padding:4px 8px;white-space:nowrap;flex-shrink:0;" onclick="deleteAdminUser('${u.id}', '${escHtml(u.name)}')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (_) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat database user</td></tr>';
  }
}

function openCreateUserModal() {
  document.getElementById('create-user-modal').style.display = 'flex';
}
function closeCreateUserModal() {
  document.getElementById('create-user-modal').style.display = 'none';
}
async function submitCreateUser() {
  const username = document.getElementById('new-user-username')?.value.trim();
  const name = document.getElementById('new-user-name')?.value.trim();
  const phone = document.getElementById('new-user-phone')?.value.trim();
  const password = document.getElementById('new-user-password')?.value.trim() || '123456';
  const ewallet = document.getElementById('new-user-ewallet')?.value || 'DANA';
  const ewalletName = document.getElementById('new-user-ewallet-name')?.value.trim() || name;
  const initialSaldo = document.getElementById('new-user-saldo')?.value || 0;

  if (!username) { alert('Masukkan username!'); return; }
  if (!name) { alert('Masukkan nama lengkap!'); return; }
  if (!phone) { alert('Masukkan nomor WhatsApp!'); return; }

  try {
    const res = await fetch(`${API}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, phone, password, ewallet, ewalletName, initialSaldo })
    });
    const d = await res.json();
    if (d.success) {
      showAdminToast(`✅ User @${d.user.username} berhasil dibuat!`);
      closeCreateUserModal();
      loadAdminUsers();
    } else {
      alert(`❌ ${d.error || 'Gagal membuat user'}`);
    }
  } catch (err) {
    alert('Gagal menghubungi server');
  }
}

function openEditSaldoModal(uid, name, currentSaldo) {
  document.getElementById('edit-saldo-uid').value = uid;
  document.getElementById('edit-saldo-user-display').textContent = `${name} (${uid})`;
  document.getElementById('edit-saldo-input').value = currentSaldo || 0;
  document.getElementById('edit-saldo-modal').style.display = 'flex';
}
function closeEditSaldoModal() {
  document.getElementById('edit-saldo-modal').style.display = 'none';
}
async function submitEditSaldo() {
  const uid = document.getElementById('edit-saldo-uid').value;
  const saldo = document.getElementById('edit-saldo-input').value;

  try {
    const res = await fetch(`${API}/api/admin/users/${uid}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saldo })
    });
    if (res.ok) {
      showAdminToast('✅ Saldo user berhasil diperbarui!');
      closeEditSaldoModal();
      loadAdminUsers();
    }
  } catch (err) {
    showAdminToast('❌ Gagal memperbarui saldo');
  }
}

async function deleteAdminUser(uid, name) {
  if (!confirm(`Hapus user "${name}" (${uid}) secara permanen?`)) return;
  try {
    const res = await fetch(`${API}/api/admin/users/${uid}`, { method: 'DELETE' });
    if (res.ok) {
      showAdminToast(`🗑️ User ${name} dihapus.`);
      loadAdminUsers();
    }
  } catch (err) {
    showAdminToast('❌ Gagal menghapus user');
  }
}

// ─── Tab 4: Laporan Blast (Excel & Logs) ───────────────────────────
let allBlastReports = [];
let filteredBlastReports = [];

async function loadAdminLogs() {
  const tbody = document.getElementById('admin-logs-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API}/api/admin/blast-reports?limit=1000`);
    if (!res.ok) {
      // Fallback ke /api/log jika endpoint baru belum tersedia
      const fallbackRes = await fetch(`${API}/api/log?limit=200`);
      if (fallbackRes.ok) {
        allBlastReports = await fallbackRes.json();
      }
    } else {
      const data = await res.json();
      allBlastReports = data.reports || [];
    }

    // Update Counter Metric Pesan Hari Ini
    const todayCount = allBlastReports.filter(l => {
      const d = new Date(l.timestamp);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;
    const sentTodayEl = document.getElementById('metric-sent-today');
    if (sentTodayEl) sentTodayEl.textContent = todayCount;

    // Update Badge Laporan di sidebar
    const badgeEl = document.getElementById('tab-logs-badge');
    if (badgeEl) badgeEl.textContent = allBlastReports.length;

    filterAdminLogs();
  } catch (err) {
    console.error('Error loading blast reports:', err);
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#ef4444;padding:24px;">Gagal memuat laporan blast</td></tr>';
  }
}

function filterAdminLogs() {
  const statusSelect = document.getElementById('log-filter-status');
  const searchInput = document.getElementById('log-search-input');
  const selectedStatus = statusSelect ? statusSelect.value : 'ALL';
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  filteredBlastReports = allBlastReports.filter((r, idx) => {
    // Enrich default field jika belum ada
    const idData = String(r.idData || (71936 + idx));
    const blastId = String(r.blastId || 'GSP001').toLowerCase();
    const userId = String(r.userId || '-').toLowerCase();
    const sender = String(r.sender || r.deviceId || '-').toLowerCase();
    const receiver = String(r.receiver || r.phone || '-').toLowerCase();
    const text = String(r.text || '').toLowerCase();
    const isSuccess = r.status === 'SUCCESS' || r.status === 'sent';
    const statusStr = isSuccess ? 'SUCCESS' : 'FAILED';

    if (selectedStatus !== 'ALL' && statusStr !== selectedStatus) {
      return false;
    }

    if (query) {
      const match = idData.includes(query) ||
        blastId.includes(query) ||
        userId.includes(query) ||
        sender.includes(query) ||
        receiver.includes(query) ||
        text.includes(query);
      if (!match) return false;
    }

    return true;
  });

  renderAdminLogsTable(filteredBlastReports);
}

function renderAdminLogsTable(reports) {
  const tbody = document.getElementById('admin-logs-tbody');
  const countIndicator = document.getElementById('log-count-indicator');
  if (!tbody) return;

  const totalSuccess = reports.filter(r => r.status === 'SUCCESS' || r.status === 'sent').length;
  const totalFailed = reports.filter(r => r.status === 'FAILED' || r.status === 'failed').length;

  if (countIndicator) {
    countIndicator.textContent = `${reports.length} Laporan (${totalSuccess} Sukses, ${totalFailed} Gagal)`;
  }

  if (!reports.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center;padding:32px;color:var(--text-muted);">
          <i class="fa-solid fa-file-excel" style="font-size:32px;opacity:0.3;display:block;margin-bottom:8px;"></i>
          Belum ada riwayat pengiriman pesan blast.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = reports.map((r, i) => {
    const isSuccess = r.status === 'SUCCESS' || r.status === 'sent';
    const statusLabel = isSuccess ? 'SUCCESS' : 'FAILED';
    const statusClass = isSuccess ? 'device-status-pill connected' : 'device-status-pill disconnected';
    const idData = r.idData || (71936 + i);
    const blastId = r.blastId || (r.campaignId ? 'GSP' + String(r.campaignId).slice(-3).toUpperCase() : 'GSP001');
    const userId = r.userId || '-';
    const sender = r.sender || r.deviceId || '-';
    const receiver = r.receiver || (r.phone ? (r.phone.startsWith('+') ? r.phone : '+' + r.phone) : '-');
    const textPreview = r.text || '-';
    const reason = isSuccess ? '-' : (r.reason || r.error || 'Gagal terkirim');
    const jamKirim = r.jamKirim || formatExcelTime(r.timestamp);

    // Styling baris selang-seling lembut (mirip spreadsheet Excel di gambar pengguna)
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f0fdf4';

    return `
      <tr style="background:${rowBg};transition:background 0.15s ease;" onmouseover="this.style.background='#e6f4ea'" onmouseout="this.style.background='${rowBg}'">
        <td style="text-align:center;font-weight:700;color:#64748b;font-size:11.5px;padding:10px 8px;">${i + 1}</td>
        <td style="font-family:monospace;font-weight:700;color:#1e3a8a;font-size:12px;padding:10px 8px;">${idData}</td>
        <td style="font-family:monospace;font-weight:700;color:#059669;font-size:12px;padding:10px 8px;">${escHtml(blastId)}</td>
        <td style="font-weight:600;color:#334155;font-size:12px;padding:10px 8px;white-space:nowrap;">${escHtml(userId)}</td>
        <td style="font-family:monospace;font-weight:600;color:#0f172a;font-size:12px;padding:10px 8px;white-space:nowrap;">${escHtml(sender)}</td>
        <td style="font-family:monospace;font-weight:700;color:#1e40af;font-size:12px;padding:10px 8px;white-space:nowrap;">${escHtml(receiver)}</td>
        <td style="font-size:12px;color:#1f2937;padding:10px 8px;line-height:1.4;max-width:320px;word-break:break-word;">
          <div style="max-height:48px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;" title="${escHtml(textPreview)}">
            ${escHtml(textPreview)}
          </div>
        </td>
        <td style="text-align:center;padding:10px 8px;white-space:nowrap;">
          <span class="${statusClass}" style="font-size:10px;font-weight:800;letter-spacing:0.5px;">
            ${statusLabel}
          </span>
        </td>
        <td style="font-size:11.5px;color:${isSuccess ? '#64748b' : '#dc2626'};padding:10px 8px;white-space:nowrap;">
          ${escHtml(reason)}
        </td>
        <td style="font-size:11.5px;font-family:monospace;color:#475569;padding:10px 8px;white-space:nowrap;">
          ${escHtml(jamKirim)}
        </td>
      </tr>`;
  }).join('');
}

function prependAdminLogRow(l) {
  // Tambahkan log real-time ke memori dan perbarui tampilan
  const enriched = {
    ...l,
    idData: l.idData || (71936 + allBlastReports.length),
    blastId: l.blastId || 'GSP001',
    userId: l.userId || '-',
    sender: l.sender || l.deviceId || '-',
    receiver: l.receiver || l.phone || '-',
    text: l.text || '-',
    status: (l.status === 'sent' || l.status === 'SUCCESS') ? 'SUCCESS' : 'FAILED',
    reason: (l.status === 'sent' || l.status === 'SUCCESS') ? '-' : (l.reason || l.error || 'Gagal terkirim'),
    jamKirim: l.jamKirim || formatExcelTime(l.timestamp)
  };

  allBlastReports.unshift(enriched);
  filterAdminLogs();

  const sentTodayEl = document.getElementById('metric-sent-today');
  if (sentTodayEl) sentTodayEl.textContent = parseInt(sentTodayEl.textContent || '0') + 1;

  const badgeEl = document.getElementById('tab-logs-badge');
  if (badgeEl) badgeEl.textContent = allBlastReports.length;
}

// ─── Export Excel (.xlsx) dengan SheetJS ────────────────────────────
function exportBlastReportExcel() {
  if (!allBlastReports || !allBlastReports.length) {
    showAdminToast('⚠️ Tidak ada data laporan blast untuk diexport');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showAdminToast('⏳ Memuat library Excel, silakan coba sesaat lagi...');
    return;
  }

  // Gunakan data hasil filter saat ini, atau seluruh data jika tidak ada filter
  const dataToExport = filteredBlastReports.length ? filteredBlastReports : allBlastReports;

  // Format array of object dengan header persis sesuai screenshot Excel user
  const excelData = dataToExport.map((r, i) => {
    const isSuccess = r.status === 'SUCCESS' || r.status === 'sent';
    return {
      'No': i + 1,
      'ID Data': r.idData || (71936 + i),
      'BLAST ID': r.blastId || 'GSP001',
      'User ID': r.userId || '-',
      'Pengirim': r.sender || r.deviceId || '-',
      'Penerima': r.receiver || (r.phone ? (r.phone.startsWith('+') ? r.phone : '+' + r.phone) : '-'),
      'Teks': r.text || '-',
      'Status': isSuccess ? 'SUCCESS' : 'FAILED',
      'Alasan': isSuccess ? '-' : (r.reason || r.error || 'Gagal'),
      'Jam Kirim': r.jamKirim || formatExcelTime(r.timestamp)
    };
  });

  // Buat Worksheet & Workbook
  const ws = XLSX.utils.json_to_sheet(excelData);

  // Atur lebar kolom yang pas agar rapi di Microsoft Excel
  ws['!cols'] = [
    { wch: 6 },   // No
    { wch: 10 },  // ID Data
    { wch: 12 },  // BLAST ID
    { wch: 14 },  // User ID
    { wch: 18 },  // Pengirim
    { wch: 18 },  // Penerima
    { wch: 45 },  // Teks
    { wch: 12 },  // Status
    { wch: 16 },  // Alasan
    { wch: 22 }   // Jam Kirim
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan Blast');

  // Format nama file: laporan-blast-YYYY-MM-DDTHH-mm-ss.xlsx
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const filename = `laporan-blast-${timestampStr}.xlsx`;

  XLSX.writeFile(wb, filename);
  showAdminToast(`✅ Laporan blast berhasil didownload: ${filename}`);
}

async function clearAdminLogs() {
  if (!confirm('Apakah Anda yakin ingin menghapus seluruh riwayat laporan blast? Data yang terhapus tidak dapat dikembalikan.')) {
    return;
  }

  try {
    const res = await fetch(`${API}/api/admin/blast-reports`, { method: 'DELETE' });
    if (res.ok) {
      allBlastReports = [];
      filteredBlastReports = [];
      renderAdminLogsTable([]);
      const badgeEl = document.getElementById('tab-logs-badge');
      if (badgeEl) badgeEl.textContent = '0';
      showAdminToast('🗑️ Seluruh riwayat laporan blast berhasil dibersihkan');
    } else {
      showAdminToast('❌ Gagal membersihkan riwayat laporan');
    }
  } catch (err) {
    showAdminToast('❌ Terjadi kesalahan saat menghapus laporan');
  }
}

function formatExcelTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hh}.${mm}.${ss}`;
}

// ─── Helpers ───────────────────────────────────────────────────────
function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.toLocaleDateString('id-ID', { day:'2-digit', month:'short' })} ${d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAdminToast(msg) {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'admin-toast';
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:10px;
    font-size:13px;font-weight:700;z-index:99999;box-shadow:0 10px 25px rgba(0,0,0,0.25);
    border:1px solid #334155;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Expose globals
window.switchAdminTab = switchAdminTab;
window.loadSampleContacts = loadSampleContacts;
window.clearContactsInput = clearContactsInput;
window.saveDraftSetup = saveDraftSetup;
window.executeAdminBlast = executeAdminBlast;
window.executeAdminStopBlast = executeAdminStopBlast;
window.loadAdminDevices = loadAdminDevices;
window.adminDisconnectDevice = adminDisconnectDevice;
window.adminDeleteDevice = adminDeleteDevice;
window.loadAdminWithdrawals = loadAdminWithdrawals;
window.approveWithdrawal = approveWithdrawal;
window.rejectWithdrawal = rejectWithdrawal;
window.openRejectWithdrawalModal = openRejectWithdrawalModal;
window.closeRejectWithdrawalModal = closeRejectWithdrawalModal;
window.setRejectReason = setRejectReason;
window.submitRejectWithdrawal = submitRejectWithdrawal;
window.openApproveWithdrawalModal = openApproveWithdrawalModal;
window.closeApproveWithdrawalModal = closeApproveWithdrawalModal;
window.submitApproveWithdrawal = submitApproveWithdrawal;
window.loadAdminLogs = loadAdminLogs;
window.loadAdminUsers = loadAdminUsers;
window.openCreateUserModal = openCreateUserModal;
window.closeCreateUserModal = closeCreateUserModal;
window.submitCreateUser = submitCreateUser;
window.openEditSaldoModal = openEditSaldoModal;
window.closeEditSaldoModal = closeEditSaldoModal;
window.submitEditSaldo = submitEditSaldo;
window.deleteAdminUser = deleteAdminUser;
window.handleAdminLogout = handleAdminLogout;
window.exportBlastReportExcel = exportBlastReportExcel;
window.filterAdminLogs = filterAdminLogs;
window.clearAdminLogs = clearAdminLogs;
