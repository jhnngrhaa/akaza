/**
 * Akaza Blast v3.0 - Real WhatsApp Blast Platform
 * Connects to real backend via REST + SSE
 */

// ─── Config ────────────────────────────────────────────────────────
const API = '';  // Same-origin
let currentUserId = localStorage.getItem('akaza_auth_uid') || localStorage.getItem('akaza_uid') || null;

let currentUser = null;
let currentTab = 'dashboard';
let eventSource = null;
let qrPollingInterval = null;
let pendingDeviceId = null;
let pendingDeviceMode = 'qr';

// ─── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  checkUrlReferral();
  await checkUserMaintenanceStatus();
  await initUser();
  await loadUserSettings();
  connectSSE();
  await refreshAll();
  switchTab('dashboard');

  // Tampilkan popup peringatan saat pertama kali masuk / buka dashboard
  const warnModal = document.getElementById('warning-notice-modal');
  if (warnModal) {
    warnModal.addEventListener('click', (e) => {
      if (e.target === warnModal) closeWarningModal();
    });
    setTimeout(checkShowWarningModal, 600);
  }
});

function checkShowWarningModal() {
  if (sessionStorage.getItem('akaza_warning_modal_seen')) return;
  const modal = document.getElementById('warning-notice-modal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeWarningModal() {
  const modal = document.getElementById('warning-notice-modal');
  if (modal) modal.style.display = 'none';
  sessionStorage.setItem('akaza_warning_modal_seen', 'true');
}

function checkUrlReferral() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  if (ref && !currentUserId) {
    window.location.href = `/login?ref=${encodeURIComponent(ref.trim().toUpperCase())}`;
  }
}

async function initUser() {
  if (currentUserId) {
    try {
      const resp = await fetch(`${API}/api/user/${currentUserId}`);
      if (resp.ok) {
        currentUser = await resp.json();
        currentUserId = currentUser.id;
        localStorage.setItem('akaza_auth_uid', currentUser.id);
        localStorage.setItem('akaza_uid', currentUser.id);
        updateUserUI();
        return;
      }
    } catch (e) {
      console.error('Init user error:', e);
    }
  }

  // Not logged in or user not found -> Redirect to dedicated login page
  currentUser = null;
  const search = window.location.search;
  window.location.href = '/login' + search;
}

function updateUserUI() {
  const userBadge = document.getElementById('topbar-user-badge');
  const userBadgeName = document.getElementById('topbar-username');
  const authBtnText = document.getElementById('topbar-auth-text');

  if (currentUser) {
    if (userBadge) {
      userBadge.style.display = 'flex';
      if (userBadgeName) userBadgeName.textContent = currentUser.username ? `@${currentUser.username}` : (currentUser.name || 'Mitra');
    }
    if (authBtnText) authBtnText.textContent = 'Logout';

    // Dashboard & Saldo
    const saldo = currentUser.saldo || 0;
    const points = currentUser.points || 0;
    const saldoEl = document.getElementById('wallet-saldo-amount');
    if (saldoEl) saldoEl.textContent = formatRp(saldo);
    const pointsEl = document.getElementById('wallet-points-amount');
    if (pointsEl) pointsEl.textContent = `${points.toLocaleString('id-ID')} Perak`;

    // Cek status banner komisi (hanya muncul di awal login & bisa dihapus)
    checkCommissionBanner();

    // Update nominal banner komisi per pesan
    const bannerRateEl = document.getElementById('user-banner-comm-rate');
    if (bannerRateEl) {
      const commRate = currentUser.commissionPerMessage || 900;
      bannerRateEl.textContent = formatRp(commRate);
    }

    // Wallets form auto-fill
    const wdBank = document.getElementById('wd-bank');
    const wdAccNum = document.getElementById('wd-acc-number');
    const wdAccName = document.getElementById('wd-acc-name');
    if (wdBank && currentUser.ewallet) wdBank.value = currentUser.ewallet;
    if (wdAccNum && (currentUser.ewalletNumber || currentUser.phone)) wdAccNum.value = currentUser.ewalletNumber || currentUser.phone;
    if (wdAccName && (currentUser.ewalletName || currentUser.name)) wdAccName.value = currentUser.ewalletName || currentUser.name;

    // Referrals Tab
    const refCode = currentUser.referralCode || '------';
    const refRate = currentUser.referralBonusRate || 50;
    const refLink = `${window.location.origin}/register?ref=${refCode}`;

    const refBannerRateEl = document.getElementById('ref-banner-rate');
    if (refBannerRateEl) refBannerRateEl.textContent = `Rp${refRate}`;

    const refDispCode = document.getElementById('ref-display-code');
    if (refDispCode) refDispCode.textContent = refCode;

    const refDispLink = document.getElementById('ref-display-link');
    if (refDispLink) refDispLink.textContent = refLink;

    const refEarnings = document.getElementById('ref-total-earnings');
    if (refEarnings) refEarnings.textContent = `Rp${(currentUser.points || 0).toLocaleString('id-ID')}`;

    const refTotalCount = document.getElementById('ref-total-referred-count');
    if (refTotalCount) refTotalCount.textContent = (currentUser.referrals || []).length;

    // Backward compatibility for old element IDs
    const refCodeEl = document.getElementById('ref-code-input');
    if (refCodeEl) refCodeEl.value = refCode;
    const refLinkEl = document.getElementById('ref-link-input');
    if (refLinkEl) refLinkEl.value = refLink;
    const refInvitedEl = document.getElementById('ref-total-invited');
    if (refInvitedEl) refInvitedEl.textContent = (currentUser.referrals || []).length;
    const refPointsEl = document.getElementById('ref-total-points');
    if (refPointsEl) refPointsEl.textContent = `${points.toLocaleString('id-ID')} Perak`;

    // Profile Tab
    const pUid = document.getElementById('profile-uid');
    if (pUid) pUid.textContent = currentUser.id;
    const pUsername = document.getElementById('profile-username');
    if (pUsername) pUsername.textContent = currentUser.username ? `@${currentUser.username}` : '-';
    const pName = document.getElementById('profile-name');
    if (pName) pName.textContent = currentUser.name || '-';
    const pPhone = document.getElementById('profile-phone');
    if (pPhone) pPhone.textContent = currentUser.phone ? `+${currentUser.phone}` : '-';
    const pEwallet = document.getElementById('profile-ewallet');
    if (pEwallet) pEwallet.textContent = currentUser.ewallet || 'DANA';
    const pEwalletDet = document.getElementById('profile-ewallet-details');
    if (pEwalletDet) pEwalletDet.textContent = `${currentUser.ewalletNumber || currentUser.phone || '-'} (a.n ${currentUser.ewalletName || currentUser.name || '-'})`;
    const pRefcode = document.getElementById('profile-refcode');
    if (pRefcode) pRefcode.textContent = refCode;
    const pSaldo = document.getElementById('profile-saldo');
    if (pSaldo) pSaldo.textContent = formatRp(saldo);
    const pPoints = document.getElementById('profile-points');
    if (pPoints) pPoints.textContent = `${points.toLocaleString('id-ID')} Perak`;

    // Profile Form
    const profUName = document.getElementById('prof-user-name');
    const profUPhone = document.getElementById('prof-user-phone');
    const profEw = document.getElementById('prof-ewallet-select');
    const profNum = document.getElementById('prof-ewallet-number');
    const profName = document.getElementById('prof-ewallet-name');
    if (profUName) profUName.value = currentUser.name || '';
    if (profUPhone) profUPhone.value = currentUser.phone || '';
    if (profEw && currentUser.ewallet) profEw.value = currentUser.ewallet;
    if (profNum) profNum.value = currentUser.ewalletNumber || currentUser.phone || '';
    if (profName) profName.value = currentUser.ewalletName || currentUser.name || '';
  } else {
    if (userBadge) userBadge.style.display = 'none';
    if (authBtnText) authBtnText.textContent = 'Masuk';
    const saldoEl = document.getElementById('wallet-saldo-amount');
    if (saldoEl) saldoEl.textContent = 'Rp 0';
    const pointsEl = document.getElementById('wallet-points-amount');
    if (pointsEl) pointsEl.textContent = '0 Perak';
  }
}

// ─── SSE Real-time ─────────────────────────────────────────────────
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`${API}/api/events`);

  eventSource.addEventListener('device_update', e => {
    const data = JSON.parse(e.data);
    handleDeviceUpdate(data);
  });

  eventSource.addEventListener('qr_update', e => {
    const data = JSON.parse(e.data);
    if (data.deviceId === pendingDeviceId) {
      if (typeof renderQRFromString === 'function') {
        renderQRFromString(data.qr);
      } else {
        showQRImage(data.deviceId);
      }
    }
  });

  eventSource.addEventListener('pairing_code', e => {
    const data = JSON.parse(e.data);
    if (data.deviceId === pendingDeviceId) {
      showPairingCode(data.code);
    }
  });

  eventSource.addEventListener('pairing_code_error', e => {
    const data = JSON.parse(e.data);
    if (data.deviceId === pendingDeviceId) {
      showToast('❌ ' + (data.error || 'Gagal membuat kode pairing'));
      const btn = document.getElementById('pair-code-btn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-key"></i> Dapatkan Kode 8 Digit';
      }
    }
  });

  eventSource.addEventListener('message_log', e => {
    try {
      const entry = JSON.parse(e.data);
      const userDevices = (currentUser && currentUser.devices) || [];
      const hasDevice = userDevices.includes(entry.deviceId) || !!document.getElementById(`device-card-${entry.deviceId}`);
      if (!hasDevice) return;

      prependLogRow(entry);

      if (entry.status === 'sent') {
        const comm = entry.commission !== undefined ? entry.commission : 900;
        currentUser.saldo = (currentUser.saldo || 0) + comm;
        updateUserUI();
      }
    } catch (_) {}
  });

  eventSource.addEventListener('message_log_update', e => {
    try {
      const updated = JSON.parse(e.data);
      const userDevices = (currentUser && currentUser.devices) || [];
      const hasDevice = userDevices.includes(updated.deviceId) || !!document.getElementById(`device-card-${updated.deviceId}`);
      if (!hasDevice) return;

      updateMemberLogRow(updated);
      refreshUser();
    } catch (_) {}
  });

  eventSource.addEventListener('blast_revoke_alert', e => {
    try {
      const data = JSON.parse(e.data);
      showToast(`⚠️ Peringatan: Pesan blast ke ${data.phone} ditarik. Komisi dibatalkan!`);
      refreshUser();
    } catch (_) {}
  });

  eventSource.addEventListener('blast_progress', e => {
    const prog = JSON.parse(e.data);
    updateBlastProgress(prog);
  });

  eventSource.addEventListener('withdrawal_update', e => {
    refreshWithdrawals();
  });

  eventSource.addEventListener('referral_bonus', e => {
    try {
      const data = JSON.parse(e.data);
      if (currentUser && currentUser.id === data.inviterId) {
        currentUser.points = data.newPoints;
        if (data.newSaldo !== undefined) currentUser.saldo = data.newSaldo;
        updateUserUI();
        renderReferrals();
        showToast(`🎉 Member @${data.invitedUsername} mendaftar via referral Anda! +100 Perak (Rp 100) diterima!`);
      }
    } catch (_) {}
  });

  eventSource.addEventListener('payout_success', e => {
    try {
      const data = JSON.parse(e.data);
      if (currentUser && currentUser.id === data.userId) {
        refreshWithdrawals();
        showToast(`⚡ Transfer Rp ${Number(data.amount).toLocaleString('id-ID')} ke ${data.ewallet} (${data.accountNumber}) sukses! Ref: ${data.payoutId}`);
      }
    } catch (_) {}
  });

  eventSource.addEventListener('system_maintenance', e => {
    try {
      const data = JSON.parse(e.data);
      const overlay = document.getElementById('maintenance-screen-overlay');
      const msgText = document.getElementById('maintenance-message-text');
      if (data.maintenance) {
        if (overlay) overlay.style.display = 'flex';
        if (msgText) msgText.textContent = data.message || 'Sistem sedang dalam pemeliharaan rutin untuk peningkatan performa. Silakan coba beberapa saat lagi.';
        showToast('🚨 Perhatian: Admin telah mengaktifkan mode maintenance.');
      } else {
        if (overlay) overlay.style.display = 'none';
        showToast('✅ Mode maintenance telah dinonaktifkan. Layanan beroperasi normal.');
      }
    } catch (_) {}
  });

  eventSource.onerror = () => {
    setTimeout(connectSSE, 5000);
  };
}

// ─── Data Refresh ──────────────────────────────────────────────────
async function refreshAll() {
  await Promise.all([
    refreshDevices(),
    refreshUser(),
    refreshLog(),
    refreshWithdrawals(),
    refreshCampaigns()
  ]);
}

async function refreshUser() {
  if (!currentUserId) return;
  try {
    const r = await fetch(`${API}/api/user/${currentUserId}`);
    if (r.ok) {
      currentUser = await r.json();
      updateUserUI();
    }
  } catch (e) {}
}

async function refreshDevices() {
  try {
    const uid = (currentUser && currentUser.id) || currentUserId || '';
    const r = await fetch(`${API}/api/devices?userId=${encodeURIComponent(uid)}`);
    if (!r.ok) return;
    const devices = await r.json();
    renderDeviceCards(devices);
    updateDashboardCounts(devices);
  } catch (e) {}
}

async function refreshLog() {
  try {
    const uid = (currentUser && currentUser.id) || currentUserId || '';
    const r = await fetch(`${API}/api/log?limit=30&userId=${encodeURIComponent(uid)}`);
    if (!r.ok) return;
    const logs = await r.json();
    renderLogTable(logs);
  } catch (e) {}
}

async function refreshWithdrawals() {
  try {
    const uid = (currentUser && currentUser.id) || currentUserId || '';
    const r = await fetch(`${API}/api/withdrawals?userId=${encodeURIComponent(uid)}`);
    if (!r.ok) return;
    const wds = await r.json();
    renderWithdrawals(wds);
  } catch (e) {}
}

async function refreshCampaigns() {
  try {
    const r = await fetch(`${API}/api/campaigns`);
    if (!r.ok) return;
    // Used in admin section
  } catch (e) {}
}

// ─── Device Rendering ──────────────────────────────────────────────
const CHAT_MODES = [
  { value: 'OFF', label: 'OFF' },
  { value: '1_MIN', label: '1 CHAT / 1 MENIT' },
  { value: '3_MIN', label: '1 CHAT / 3 MENIT' },
  { value: '5_MIN', label: '1 CHAT / 5 MENIT' },
  { value: 'SLOW_20S', label: 'SLOW (20s)' },
  { value: 'NORMAL_10S', label: 'NORMAL (10s)' },
  { value: 'FAST_5S', label: 'FAST (5s)' },
  { value: '1_SEC', label: '1 CHAT / 1 DETIK' },
  { value: 'FAST_30', label: '30 CHAT (FAST)' },
  { value: 'FAST_40', label: '40 CHAT (FAST)' },
  { value: 'FAST_50', label: '50 CHAT (FAST)' }
];

async function changeDeviceMode(deviceId, mode) {
  try {
    const r = await fetch(`${API}/api/devices/${deviceId}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const d = await r.json();
    if (d.success) {
      const match = CHAT_MODES.find(m => m.value === mode);
      showToast(`⚡ Mode diubah ke ${match ? match.label : mode}`);
    }
  } catch (err) {
    showToast('❌ Gagal mengubah mode');
  }
}

let allDevicesList = [];
let currentDeviceFilter = 'all';

function setDeviceFilter(filter) {
  currentDeviceFilter = filter;
  ['all', 'online', 'offline'].forEach(f => {
    const el = document.getElementById(`dev-filter-${f}`);
    if (el) {
      if (f === filter) {
        el.style.background = '#ede9fe';
        el.style.color = '#6366f1';
      } else {
        el.style.background = '#f8fafc';
        el.style.color = '#64748b';
      }
    }
  });
  filterDevicesList();
}

function filterDevicesList() {
  const container = document.getElementById('devices-list-cards');
  if (!container) return;

  const query = (document.getElementById('devices-search-input')?.value || '').toLowerCase().trim();
  let filtered = allDevicesList;

  if (currentDeviceFilter === 'online') {
    filtered = filtered.filter(d => d.status === 'online');
  } else if (currentDeviceFilter === 'offline') {
    filtered = filtered.filter(d => d.status !== 'online');
  }

  if (query) {
    filtered = filtered.filter(d => {
      const devId = (d.id || '').toLowerCase();
      const phone = (d.phone || '').toLowerCase();
      const name = (d.name || '').toLowerCase();
      return devId.includes(query) || phone.includes(query) || name.includes(query);
    });
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="clean-panel" style="text-align:center;color:var(--text-muted);padding:32px 16px;">
        <i class="fa-solid fa-mobile-screen" style="font-size:36px;margin-bottom:12px;display:block;opacity:0.3;"></i>
        <div style="font-weight:600;">Tidak ada perangkat ditemukan</div>
        <div style="font-size:12px;margin-top:4px;">Klik "Scan QR" atau "Pairing Code" untuk menautkan WhatsApp</div>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(dev => {
    const isOnline = dev.status === 'online';
    const isConnecting = dev.status === 'connecting' || dev.status === 'qr_ready' || dev.status === 'pairing_code_ready';
    const currentMode = dev.mode || 'NORMAL_10S';
    const sentCount = dev.sentToday || 0;
    const deliveredCount = dev.deliveredCount !== undefined ? dev.deliveredCount : sentCount;
    const profitCount = (sentCount * 900) || (dev.profit !== undefined ? dev.profit : 0);
    const phoneDisplay = dev.phone ? '+' + dev.phone.replace(/\D/g, '') : '-';

    const statusBadgeClass = isOnline ? 'connected' : isConnecting ? 'connecting' : 'disconnected';
    const statusLabel = isOnline ? 'CONNECTED' : isConnecting ? 'CONNECTING' : 'DISCONNECTED';

    const optionsHtml = CHAT_MODES.map(opt => `
      <option value="${opt.value}" ${currentMode === opt.value ? 'selected' : ''}>${opt.label}</option>
    `).join('');

    return `
    <div class="device-card-item" id="device-card-${dev.id}">
      <!-- Header Row: DEVICE ID & Status Pill -->
      <div class="device-card-header">
        <div class="device-id-title">
          <span class="device-label">DEVICE</span>
          <span class="device-id-text">${escHtml(dev.id)}</span>
        </div>
        <div class="device-status-pill ${statusBadgeClass}">
          <span class="dot"></span>
          <span>${statusLabel}</span>
        </div>
      </div>

      <!-- Phone Row: No. WA -->
      <div class="device-phone-row">
        <span class="device-label">No. WA</span>
        <span class="device-phone-val">${phoneDisplay}</span>
      </div>

      <!-- Stats Row: Sent, Delivered, Profit -->
      <div class="device-stats-row">
        <div class="stat-pill pill-sent">
          <i class="fa-solid fa-paper-plane"></i> Sent: <strong>${sentCount}</strong>
        </div>
        <div class="stat-pill pill-delivered">
          <i class="fa-solid fa-check-double"></i> Delivered: <strong>${deliveredCount}</strong>
        </div>
        <div class="stat-pill pill-profit">
          <i class="fa-solid fa-coins"></i> Profit: <strong>${formatRp(profitCount)}</strong>
        </div>
      </div>

      <!-- Mode & Actions Row -->
      <div class="device-mode-row">
        <span class="device-label">MODE</span>
        <select class="device-mode-select" onchange="changeDeviceMode('${dev.id}', this.value)" title="Pilih mode kecepatan chat">
          ${optionsHtml}
        </select>
        ${!isOnline && !isConnecting ? `
          <button class="device-btn-icon btn-reconnect" onclick="openDeviceModalWithTab('qr')" title="Tautkan Ulang">
            <i class="fa-solid fa-rotate"></i>
          </button>
        ` : ''}
        <button class="device-btn-icon btn-del" onclick="deleteDevice('${dev.id}')" title="Hapus Device">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

function renderDeviceCards(devices) {
  allDevicesList = devices || [];
  filterDevicesList();
}

function updateDashboardCounts(devices) {
  const online = devices.filter(d => d.status === 'online').length;
  const offline = devices.filter(d => d.status !== 'online').length;
  const total = devices.length;

  const elOn = document.getElementById('dash-online-count');
  const elOff = document.getElementById('dash-offline-count');
  if (elOn) elOn.textContent = online;
  if (elOff) elOff.textContent = offline;

  const statTot = document.getElementById('devices-stat-total');
  const statOn = document.getElementById('devices-stat-online');
  const statOff = document.getElementById('devices-stat-offline');
  if (statTot) statTot.textContent = total;
  if (statOn) statOn.textContent = online;
  if (statOff) statOff.textContent = offline;
}

function openDeviceModalWithTab(tab = 'qr') {
  openDeviceModal();
  switchDeviceModalTab(tab);
  if (tab === 'pair') {
    clearInterval(qrPollingInterval);
  }
}

function handleDeviceUpdate(data) {
  // If device was deleted, remove its card immediately
  if (data.status === 'deleted') {
    const card = document.getElementById(`device-card-${data.deviceId}`);
    if (card) card.remove();
    refreshDevices();
    return;
  }
  refreshDevices();

  if (data.deviceId === pendingDeviceId && data.status === 'online') {
    pendingDeviceId = null;
    closeDeviceModal(false);
    showToast(`✅ WhatsApp berhasil terhubung! (${data.phone})`);
    refreshUser();
  }
}

// ─── Log Table ─────────────────────────────────────────────────────
function renderLogTable(logs) {
  const tbody = document.getElementById('user-dash-history-tbody');
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">
      Belum ada aktivitas pengiriman. Tambah device dan tunggu blast dari Admin.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const isSuccess = log.status === 'sent' || log.status === 'SUCCESS';
    const isRevoked = log.status === 'REVOKED';
    const fallbackRate = (currentUser && currentUser.commissionPerMessage) || 900;
    const commVal = log.commission !== undefined ? log.commission : fallbackRate;
    const cleanPhone = (log.phone || log.receiver || '').replace(/\D/g, '');
    const logId = log.id || log.idData || '';
    return `
    <tr data-log-id="${logId}" data-phone="${cleanPhone}">
      <td>${formatTime(log.timestamp)}</td>
      <td>${escHtml(maskPhone(log.phone || log.receiver))}</td>
      <td>
        <span class="${isSuccess ? 'badge-online' : 'badge-offline'}" style="font-size:10px;">
          ${isSuccess ? 'Terkirim' : (isRevoked ? 'Ditarik' : 'Gagal')}
        </span>
      </td>
      <td style="color:${isSuccess ? '#16a34a' : '#dc2626'};font-weight:600;">
        ${isSuccess ? '+' + formatRp(commVal) : 'Rp 0'}
      </td>
    </tr>`;
  }).join('');
}

function prependLogRow(entry) {
  const tbody = document.getElementById('user-dash-history-tbody');
  if (!tbody) return;

  // Remove empty row if present
  const emptyRow = tbody.querySelector('td[colspan="4"]');
  if (emptyRow) tbody.innerHTML = '';

  const isSuccess = entry.status === 'sent' || entry.status === 'SUCCESS';
  const isRevoked = entry.status === 'REVOKED';
  const tr = document.createElement('tr');
  const cleanPhone = (entry.phone || entry.receiver || '').replace(/\D/g, '');
  tr.setAttribute('data-log-id', entry.id || entry.idData || '');
  tr.setAttribute('data-phone', cleanPhone);

  const fallbackRate = (currentUser && currentUser.commissionPerMessage) || 900;
  const comm = entry.commission !== undefined ? entry.commission : fallbackRate;
  tr.innerHTML = `
    <td>${formatTime(entry.timestamp)}</td>
    <td>${escHtml(maskPhone(entry.phone || entry.receiver))}</td>
    <td><span class="${isSuccess ? 'badge-online' : 'badge-offline'}" style="font-size:10px;">${isSuccess ? 'Terkirim' : (isRevoked ? 'Ditarik' : 'Gagal')}</span></td>
    <td style="color:${isSuccess ? '#16a34a' : '#dc2626'};font-weight:600;">${isSuccess ? '+' + formatRp(comm) : 'Rp 0'}</td>`;
  tr.style.animation = 'fadeInRow 0.4s ease';
  tbody.insertBefore(tr, tbody.firstChild);

  // Limit rows
  while (tbody.rows.length > 30) tbody.removeChild(tbody.lastChild);
}

function updateMemberLogRow(updated) {
  const tbody = document.getElementById('user-dash-history-tbody');
  if (!tbody) return;

  const targetId = String(updated.id || updated.idData || '');
  const targetPhone = (updated.phone || updated.receiver || '').replace(/\D/g, '');
  const rows = tbody.querySelectorAll('tr');

  for (const tr of rows) {
    const rowId = tr.getAttribute('data-log-id');
    const rowPhone = tr.getAttribute('data-phone');
    if ((targetId && rowId && rowId === targetId) || 
        (targetPhone && rowPhone && (rowPhone.endsWith(targetPhone) || targetPhone.endsWith(rowPhone)))) {
      const isSuccess = updated.status === 'sent' || updated.status === 'SUCCESS';
      const isRevoked = updated.status === 'REVOKED';

      const statusBadge = tr.querySelector('.badge-online, .badge-offline');
      if (statusBadge) {
        statusBadge.className = isSuccess ? 'badge-online' : 'badge-offline';
        statusBadge.textContent = isSuccess ? 'Terkirim' : (isRevoked ? 'Ditarik' : 'Gagal');
      }

      const commTd = tr.querySelector('td:last-child');
      if (commTd) {
        commTd.style.color = isSuccess ? '#16a34a' : '#dc2626';
        commTd.textContent = isSuccess ? ('+' + formatRp(updated.commission || 900)) : 'Rp 0';
      }

      tr.style.background = isRevoked ? '#fff1f2' : '';
      tr.style.transition = 'background 0.5s ease';
      break;
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function switchWalletSubTab(tab) {
  const viewForm = document.getElementById('wallet-view-form');
  const viewHistory = document.getElementById('wallet-view-history');
  const btnForm = document.getElementById('btn-wallet-form');
  const btnHistory = document.getElementById('btn-wallet-history');

  if (tab === 'history') {
    if (viewForm) viewForm.style.display = 'none';
    if (viewHistory) viewHistory.style.display = 'block';
    if (btnForm) {
      btnForm.style.background = 'transparent';
      btnForm.style.color = 'var(--text-secondary)';
      btnForm.style.boxShadow = 'none';
    }
    if (btnHistory) {
      btnHistory.style.background = '#ffffff';
      btnHistory.style.color = 'var(--primary)';
      btnHistory.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
    }
    refreshWithdrawals();
  } else {
    if (viewForm) viewForm.style.display = 'block';
    if (viewHistory) viewHistory.style.display = 'none';
    if (btnForm) {
      btnForm.style.background = '#ffffff';
      btnForm.style.color = 'var(--primary)';
      btnForm.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
    }
    if (btnHistory) {
      btnHistory.style.background = 'transparent';
      btnHistory.style.color = 'var(--text-secondary)';
      btnHistory.style.boxShadow = 'none';
    }
  }
}

// ─── Withdrawals ───────────────────────────────────────────────────
function renderWithdrawals(wds) {
  const tbody = document.getElementById('wd-history-tbody');
  const countBadge = document.getElementById('wallet-history-badge');
  if (countBadge) countBadge.textContent = (wds || []).length;

  if (!tbody) return;

  if (!wds || !wds.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">Belum ada riwayat penarikan.</td></tr>`;
    return;
  }

  tbody.innerHTML = wds.map(w => {
    let statusHtml = '';
    if (w.status === 'approved' || w.status === 'paid') {
      statusHtml = `<span class="badge-online" style="font-size:10.5px;"><i class="fa-solid fa-check"></i> Selesai Ditransfer</span>`;
    } else if (w.status === 'rejected') {
      const reasonText = w.rejectReason || 'Ditolak oleh admin';
      statusHtml = `<span class="badge-offline" style="font-size:10.5px;cursor:help;" title="Alasan: ${escHtml(reasonText)}"><i class="fa-solid fa-xmark"></i> Ditolak</span>`;
    } else {
      statusHtml = `<span class="badge-connecting" style="font-size:10.5px;"><i class="fa-solid fa-clock"></i> Menunggu Transfer Admin</span>`;
    }

    return `
      <tr>
        <td>${formatDate(w.requestedAt)}</td>
        <td><strong>${w.bank}</strong> - ${w.accountNumber} <div style="font-size:11px;color:var(--text-muted);">${w.accountName || ''}</div></td>
        <td style="font-weight:700;color:var(--color-primary);">${formatRp(w.amount)}</td>
        <td>${statusHtml}</td>
      </tr>`;
  }).join('');
}

// ─── Device Modal ──────────────────────────────────────────────────
function openDeviceModal() {
  pendingDeviceId = null;
  document.getElementById('device-modal').style.display = 'flex';
  switchDeviceModalTab('qr');
  // Auto-start QR generation immediately
  setTimeout(() => startQRSession(), 300);
}

function closeDeviceModal(isCancel = false) {
  document.getElementById('device-modal').style.display = 'none';
  clearInterval(qrPollingInterval);
  qrPollingInterval = null;

  if (pendingDeviceId && isCancel) {
    const devIdToClean = pendingDeviceId;
    pendingDeviceId = null;
    fetch(`${API}/api/devices/${devIdToClean}`, { method: 'DELETE' }).catch(() => {});
    setTimeout(() => refreshDevices(), 300);
  } else {
    pendingDeviceId = null;
  }

  // Reset QR UI
  const img = document.getElementById('qr-image');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const loadEl = document.getElementById('qr-loading-msg');
  if (loadEl) loadEl.style.display = 'block';
  const refBtn = document.getElementById('qr-refresh-btn');
  if (refBtn) refBtn.style.display = 'none';
  document.getElementById('pair-result-box').style.display = 'none';
}

function switchDeviceModalTab(tab) {
  pendingDeviceMode = tab;
  document.getElementById('modal-content-qr').style.display = tab === 'qr' ? 'block' : 'none';
  document.getElementById('modal-content-pair').style.display = tab === 'pair' ? 'block' : 'none';
  document.getElementById('modal-tab-qr').className = tab === 'qr' ? 'btn-primary' : 'btn-secondary';
  document.getElementById('modal-tab-pair').className = tab === 'pair' ? 'btn-primary' : 'btn-secondary';
}

async function startQRSession() {
  // Prevent double-call if already connecting
  if (pendingDeviceId) return;

  const loadingEl = document.getElementById('qr-loading-msg');
  if (loadingEl) loadingEl.style.display = 'block';

  const name = document.getElementById('device-name-input').value.trim() || 'WhatsApp Device';

  let data;
  try {
    const resp = await fetch(`${API}/api/devices/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, userId: currentUserId || 'usr_guest', usePairingCode: false })
    });
    data = await resp.json();
  } catch (err) {
    showToast('❌ Gagal terhubung ke server');
    return;
  }

  if (!data.success) {
    showToast('❌ Gagal: ' + (data.error || 'Unknown'));
    return;
  }

  pendingDeviceId = data.deviceId;

  // Poll: cek apakah QR image sudah tersedia
  let tries = 0;
  qrPollingInterval = setInterval(async () => {
    tries++;
    try {
      // Cek status dulu
      const statusResp = await fetch(`${API}/api/devices/${pendingDeviceId}/qr`);
      const statusData = await statusResp.json();

      if (statusData.status === 'online') {
        clearInterval(qrPollingInterval);
        pendingDeviceId = null;
        closeDeviceModal(false);
        showToast('✅ WhatsApp berhasil terhubung!');
        refreshAll();
        return;
      }

      if (statusData.qr) {
        // QR tersedia — tampilkan via /qr-image endpoint
        showQRImage(pendingDeviceId);
        clearInterval(qrPollingInterval);

        // Setelah QR muncul, poll status online
        startOnlinePoller(pendingDeviceId);
      }
    } catch (_) {}

    // Timeout 60 detik
    if (tries > 30) {
      clearInterval(qrPollingInterval);
      const refBtn = document.getElementById('qr-refresh-btn');
      if (refBtn) refBtn.style.display = 'block';
      showToast('⏱ QR timeout. Klik Refresh untuk coba lagi.');
    }
  }, 2000);
}

function showQRImage(deviceId) {
  const img = document.getElementById('qr-image');
  const loadEl = document.getElementById('qr-loading-msg');
  if (!img) return;

  // Tambahkan timestamp agar browser tidak cache
  img.src = `${API}/api/devices/${deviceId}/qr-image?t=${Date.now()}`;
  img.onload = () => {
    img.style.display = 'block';
    if (loadEl) loadEl.style.display = 'none';
  };
  img.onerror = () => {
    // Gambar belum siap, coba lagi 2 detik
    setTimeout(() => showQRImage(deviceId), 2000);
  };
}

function refreshQRImage() {
  if (!pendingDeviceId) return;
  const refBtn = document.getElementById('qr-refresh-btn');
  if (refBtn) refBtn.style.display = 'none';
  showQRImage(pendingDeviceId);
  startOnlinePoller(pendingDeviceId);
}

function startOnlinePoller(deviceId) {
  // Poll hingga device online setelah QR di-scan
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`${API}/api/devices/${deviceId}/status`);
      const d = await r.json();
      if (d.status === 'online') {
        clearInterval(poll);
        if (deviceId === pendingDeviceId) {
          pendingDeviceId = null;
          closeDeviceModal(false);
          showToast('✅ WhatsApp berhasil terhubung!');
          refreshAll();
        }
      }
    } catch (_) {}
  }, 3000);
}

let currentRawPairingCode = '';

async function generatePairingCode() {
  const phoneInput = document.getElementById('pair-phone-input');
  const ccSelect = document.getElementById('pair-country-code');
  const rawPhone = (phoneInput?.value || '').trim();

  if (!rawPhone) { showToast('Masukkan nomor WhatsApp dulu!'); return; }

  const selectedCc = (ccSelect?.value || '55').replace(/\D/g, '');
  let cleanDigits = rawPhone.replace(/\D/g, '');

  if (cleanDigits.startsWith('0')) {
    cleanDigits = selectedCc + cleanDigits.slice(1);
  } else if (!cleanDigits.startsWith(selectedCc) && cleanDigits.length <= 11) {
    cleanDigits = selectedCc + cleanDigits;
  }

  if (cleanDigits.length < 9) {
    showToast('Nomor WhatsApp terlalu pendek atau tidak valid!');
    return;
  }

  const name = document.getElementById('device-name-input')?.value?.trim() || 'WhatsApp Device';

  const btn = document.getElementById('pair-code-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungkan & Meminta Kode...';
  }

  try {
    const resp = await fetch(`${API}/api/devices/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        userId: currentUserId || 'usr_guest',
        usePairingCode: true,
        phoneNumber: cleanDigits
      })
    });
    const data = await resp.json();
    if (!data.success) {
      showToast('❌ Gagal: ' + (data.error || 'Unknown'));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-key"></i> Dapatkan Kode 8 Digit';
      }
      return;
    }
    pendingDeviceId = data.deviceId;

    // Poll for code
    let tries = 0;
    if (window._pairPollInterval) clearInterval(window._pairPollInterval);
    window._pairPollInterval = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`${API}/api/devices/${pendingDeviceId}/pairing-code`);
        const d = await r.json();
        if (d.code) {
          clearInterval(window._pairPollInterval);
          showPairingCode(d.code);
        }
        if (d.status === 'online') {
          clearInterval(window._pairPollInterval);
          pendingDeviceId = null;
          closeDeviceModal(false);
          showToast('✅ WhatsApp berhasil terhubung!');
          refreshAll();
        }
      } catch (_) {}
      if (tries > 40) {
        clearInterval(window._pairPollInterval);
        if (!currentRawPairingCode && btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Coba Minta Kode Lagi';
        }
      }
    }, 2000);

    // Also watch for online status
    if (qrPollingInterval) clearInterval(qrPollingInterval);
    qrPollingInterval = setInterval(async () => {
      try {
        const r = await fetch(`${API}/api/devices/${pendingDeviceId}/status`);
        const d = await r.json();
        if (d.status === 'online') {
          clearInterval(qrPollingInterval);
          if (window._pairPollInterval) clearInterval(window._pairPollInterval);
          pendingDeviceId = null;
          closeDeviceModal(false);
          showToast('✅ WhatsApp berhasil terhubung!');
          refreshAll();
        }
      } catch (_) {}
    }, 2000);

  } catch (err) {
    showToast('❌ Terjadi kesalahan: ' + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-key"></i> Dapatkan Kode 8 Digit';
    }
  }
}

function showPairingCode(code) {
  currentRawPairingCode = code;
  const resultBox = document.getElementById('pair-result-box');
  const codeEl = document.getElementById('display-pairing-code');
  if (resultBox) resultBox.style.display = 'block';

  let formatted = code;
  if (code && code.length === 8) {
    formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
  }
  if (codeEl) codeEl.textContent = formatted;

  const btn = document.getElementById('pair-code-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Dapatkan Kode Baru';
  }
}

function copyPairingCode() {
  if (!currentRawPairingCode) return;
  navigator.clipboard.writeText(currentRawPairingCode).then(() => {
    showToast('📋 Kode pairing disalin: ' + currentRawPairingCode);
  }).catch(() => {
    showToast('Kode: ' + currentRawPairingCode);
  });
}

async function loadUserSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    if (res.ok) {
      const s = await res.json();
      if (s.countryCode) {
        const ccSelect = document.getElementById('pair-country-code');
        if (ccSelect) {
          const ccStr = String(s.countryCode).replace(/\D/g, '');
          if ([...ccSelect.options].some(o => o.value === ccStr)) {
            ccSelect.value = ccStr;
          }
        }
      }
    }
  } catch (_) {}
}

async function disconnectDevice(deviceId) {
  const ok = await showCustomConfirm('Yakin ingin memutuskan koneksi WhatsApp device ini?', {
    title: 'Putuskan WhatsApp',
    confirmText: 'Putuskan',
    isDanger: true
  });
  if (!ok) return;
  await fetch(`${API}/api/devices/${deviceId}/disconnect`, { method: 'POST' });
  refreshDevices();
  showToast('Device diputuskan.');
}

async function deleteDevice(deviceId) {
  const ok = await showCustomConfirm('Hapus device ini secara permanen? Sesi login WhatsApp pada server akan dihapus.', {
    title: 'Hapus Device',
    confirmText: 'Hapus Permanen',
    isDanger: true
  });
  if (!ok) return;
  const r = await fetch(`${API}/api/devices/${deviceId}`, { method: 'DELETE' });
  if (r.ok) {
    const card = document.getElementById(`device-card-${deviceId}`);
    if (card) card.remove();
    refreshDevices();
    showToast('🗑️ Device berhasil dihapus.');
  } else {
    showToast('❌ Gagal menghapus device.');
  }
}

async function reconnectDevice(deviceId) {
  showToast('Mencoba reconnect... Buka modal untuk scan QR baru.');
}

// ─── Admin Blast ────────────────────────────────────────────────────
async function loadAdminCurrentSetup() {
  try {
    const r = await fetch(`${API}/api/blast/contacts`);
    if (!r.ok) return;
    const d = await r.json();
    if (d.contacts && d.contacts.length) {
      const raw = d.contacts.map(c => `${c.phone}, ${c.name}`).join('\n');
      document.getElementById('blast-contacts').value = raw;
    }
    if (d.message) document.getElementById('blast-message').value = d.message;
    if (d.title) document.getElementById('blast-title').value = d.title;
  } catch (e) {}
}

async function handleStartBlast(e) {
  e.preventDefault();
  const contactsRaw = document.getElementById('blast-contacts').value.trim();
  const message = document.getElementById('blast-message').value.trim();
  const title = document.getElementById('blast-title').value.trim() || 'Blast Campaign';

  if (!contactsRaw) { showToast('Database nomor masih kosong!'); return; }
  if (!message) { showToast('Isi pesan belum diisi!'); return; }

  // Save setup
  const setupResp = await fetch(`${API}/api/blast/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts: contactsRaw, message, title })
  });
  const setupData = await setupResp.json();

  if (!setupData.success) {
    showToast('❌ Gagal setup: ' + (setupData.error || 'Unknown'));
    return;
  }

  showToast(`📋 ${setupData.count} nomor siap dikirim...`);

  // Start blast
  const blastResp = await fetch(`${API}/api/blast/start`, { method: 'POST' });
  const blastData = await blastResp.json();

  if (!blastData.success) {
    showToast('❌ ' + (blastData.error || 'Gagal memulai blast'));
    return;
  }

  showToast(`🚀 Blast dimulai! ${setupData.count} pesan antri...`);
  document.getElementById('btn-start-blast').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Blast Berjalan...';
  document.getElementById('btn-start-blast').disabled = true;
}

async function stopBlast() {
  await fetch(`${API}/api/blast/stop`, { method: 'POST' });
  showToast('Blast dihentikan.');
  resetBlastBtn();
}

function resetBlastBtn() {
  const btn = document.getElementById('btn-start-blast');
  if (btn) {
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Luncurkan ke WhatsApp Mitra';
    btn.disabled = false;
  }
}

function updateBlastProgress(prog) {
  const statusEl = document.getElementById('blast-status-badge');
  const pctEl = document.getElementById('monitor-percent-val');
  const sentEl = document.getElementById('monitor-sent-val');

  if (statusEl) statusEl.textContent = prog.status === 'running' ? 'Berjalan 🟢' : prog.status === 'done' ? 'Selesai ✅' : prog.status === 'stopped' ? 'Dihentikan' : 'Standby';
  if (pctEl && prog.total > 0) pctEl.textContent = Math.round((prog.sent / prog.total) * 100) + '%';
  if (sentEl) sentEl.textContent = prog.sent || 0;

  if (prog.status === 'done' || prog.status === 'stopped' || prog.status === 'idle') {
    resetBlastBtn();
  }
}

function loadAdminDefaultDatabase() {
  document.getElementById('blast-contacts').value = `081234567890, Budi Santoso
085678901234, Siti Rahayu
087890123456, Ahmad Fauzi
082345678901, Dewi Kartika
089012345678, Rudi Hermawan
083456789012, Ani Wijayanti
086789012345, Hendra Gunawan
084567890123, Rina Susanti`;
}

// ─── Withdraw Form ─────────────────────────────────────────────────
async function handleWithdrawSubmit(e) {
  e.preventDefault();
  if (!currentUserId || !currentUser) {
    showToast('⚠️ Silakan masuk ke akun terlebih dahulu!');
    openAuthModal('login');
    return;
  }

  const amount = parseInt(document.getElementById('wd-amount').value);
  const bank = document.getElementById('wd-bank').value;
  const accountNumber = document.getElementById('wd-acc-number').value.trim();
  const accountName = document.getElementById('wd-acc-name').value.trim();

  if (amount < 30000) {
    showToast('⚠️ Minimal penarikan saldo adalah Rp 30.000');
    return;
  }
  if (amount > (currentUser.saldo || 0)) {
    showToast('⚠️ Saldo komisi Anda tidak mencukupi untuk penarikan ini');
    return;
  }

  try {
    const resp = await fetch(`${API}/api/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, amount, bank, accountNumber, accountName })
    });
    const data = await resp.json();

    if (!data.success) {
      showToast('❌ ' + (data.error || 'Penarikan gagal'));
      return;
    }

    currentUser.saldo = data.newSaldo;
    updateUserUI();
    refreshWithdrawals();
    document.getElementById('withdraw-form').reset();
    showToast(`✅ Permintaan penarikan Rp ${amount.toLocaleString('id-ID')} terkirim! Sedang diproses sistem.`);
    switchWalletSubTab('history');
  } catch (err) {
    showToast('❌ Gagal menghubungi server penarikan.');
  }
}

// ─── Navigation ────────────────────────────────────────────────────
function switchTab(tab, subTab = null) {
  if (tab === 'history') {
    tab = 'wallets';
    subTab = 'history';
  }
  currentTab = tab;
  const tabs = ['dashboard', 'devices', 'wallets', 'referrals', 'profile'];
  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    if (section) section.style.display = t === tab ? 'block' : 'none';
    const navBtn = document.getElementById(`nav-btn-${t}`);
    if (navBtn) navBtn.className = t === tab ? 'nav-tab-item active' : 'nav-tab-item';
  });

  // Load tab-specific data
  if (tab === 'devices') refreshDevices();
  if (tab === 'wallets') {
    refreshUser();
    refreshWithdrawals();
    if (subTab) switchWalletSubTab(subTab);
  }
  if (tab === 'profile') { refreshUser(); }
  if (tab === 'referrals') renderReferrals();
}

// ─── Referrals ──────────────────────────────────────────────────────
let activeReferralSubTab = 'users';

function formatDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return String(iso);
  }
}

function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(iso);
  }
}

function switchReferralSubTab(tab) {
  activeReferralSubTab = tab;
  const btnUsers = document.getElementById('ref-subtab-btn-users');
  const btnHistory = document.getElementById('ref-subtab-btn-history');
  const viewUsers = document.getElementById('ref-view-users');
  const viewHistory = document.getElementById('ref-view-history');

  if (btnUsers) {
    if (tab === 'users') {
      btnUsers.style.background = '#e0e7ff';
      btnUsers.style.color = '#4f46e5';
      btnUsers.style.border = '1px solid #c7d2fe';
      btnUsers.style.fontWeight = '700';
    } else {
      btnUsers.style.background = '#ffffff';
      btnUsers.style.color = '#64748b';
      btnUsers.style.border = '1px solid #e2e8f0';
      btnUsers.style.fontWeight = '600';
    }
  }

  if (btnHistory) {
    if (tab === 'history') {
      btnHistory.style.background = '#e0e7ff';
      btnHistory.style.color = '#4f46e5';
      btnHistory.style.border = '1px solid #c7d2fe';
      btnHistory.style.fontWeight = '700';
    } else {
      btnHistory.style.background = '#ffffff';
      btnHistory.style.color = '#64748b';
      btnHistory.style.border = '1px solid #e2e8f0';
      btnHistory.style.fontWeight = '600';
    }
  }

  if (viewUsers) viewUsers.style.display = tab === 'users' ? 'block' : 'none';
  if (viewHistory) viewHistory.style.display = tab === 'history' ? 'block' : 'none';
}
window.switchReferralSubTab = switchReferralSubTab;

async function renderReferrals() {
  if (!currentUserId) return;

  try {
    const res = await fetch(`${API}/api/user/${currentUserId}/referrals`);
    if (!res.ok) return;
    const data = await res.json();

    const refCode = data.referralCode || '------';
    const refRate = data.referralBonusRate || 50;
    const refLink = `${window.location.origin}/register?ref=${refCode}`;

    // Banner rate
    const bannerRateEl = document.getElementById('ref-banner-rate');
    if (bannerRateEl) bannerRateEl.textContent = `Rp${refRate}`;

    // Card 1
    const codeEl = document.getElementById('ref-display-code');
    if (codeEl) codeEl.textContent = refCode;

    const linkEl = document.getElementById('ref-display-link');
    if (linkEl) linkEl.textContent = refLink;

    // Backward compat
    const oldCodeEl = document.getElementById('ref-code-input');
    if (oldCodeEl) oldCodeEl.value = refCode;
    const oldLinkEl = document.getElementById('ref-link-input');
    if (oldLinkEl) oldLinkEl.value = refLink;

    // Card 2
    const totalEarningsEl = document.getElementById('ref-total-earnings');
    if (totalEarningsEl) {
      totalEarningsEl.textContent = `Rp${(data.points || data.totalEarnings || 0).toLocaleString('id-ID')}`;
    }

    const totalReferredEl = document.getElementById('ref-total-referred-count');
    if (totalReferredEl) {
      totalReferredEl.textContent = data.totalInvited || (data.referrals ? data.referrals.length : 0);
    }

    const todayEarningsEl = document.getElementById('ref-today-earnings');
    if (todayEarningsEl) {
      todayEarningsEl.textContent = `Rp${(data.todayEarnings || 0).toLocaleString('id-ID')}`;
    }

    // Sub-tab 1: Pengguna
    const usersEmpty = document.getElementById('ref-users-empty');
    const usersList = document.getElementById('ref-users-list');
    const list = data.referrals || [];

    if (list.length === 0) {
      if (usersEmpty) usersEmpty.style.display = 'block';
      if (usersList) {
        usersList.style.display = 'none';
        usersList.innerHTML = '';
      }
    } else {
      if (usersEmpty) usersEmpty.style.display = 'none';
      if (usersList) {
        usersList.style.display = 'block';
        usersList.innerHTML = list.map(m => {
          const initials = ((m.name || m.username || 'M').trim().slice(0, 2)).toUpperCase();
          const earned = (m.bonusRp || m.pointsEarned || 0).toLocaleString('id-ID');
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:38px;height:38px;border-radius:50%;background:#eef2ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">
                  ${escHtml(initials)}
                </div>
                <div>
                  <div style="font-size:13.5px;font-weight:700;color:#0f172a;">${escHtml(m.name || 'Member')}</div>
                  <div style="font-size:11.5px;color:#64748b;">@${escHtml(m.username || '-')} • ${formatDate(m.joinedAt)}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:13.5px;font-weight:800;color:#16a34a;">+Rp ${earned}</div>
                <div style="font-size:11px;color:#94a3b8;">${m.totalMessagesSent || 0} pesan blast</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Sub-tab 2: Riwayat
    const historyEmpty = document.getElementById('ref-history-empty');
    const historyList = document.getElementById('ref-history-list');
    const history = data.history || [];

    if (history.length === 0) {
      if (historyEmpty) historyEmpty.style.display = 'block';
      if (historyList) {
        historyList.style.display = 'none';
        historyList.innerHTML = '';
      }
    } else {
      if (historyEmpty) historyEmpty.style.display = 'none';
      if (historyList) {
        historyList.style.display = 'block';
        historyList.innerHTML = history.map(h => {
          const amount = (h.amount || 0).toLocaleString('id-ID');
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:38px;height:38px;border-radius:50%;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">
                  <i class="fa-solid fa-coins"></i>
                </div>
                <div>
                  <div style="font-size:13.5px;font-weight:700;color:#0f172a;">${escHtml(h.title || 'Komisi Referral')}</div>
                  <div style="font-size:11.5px;color:#64748b;">dari @${escHtml(h.fromUser || '-')} • ${formatDateTime(h.timestamp)}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:14px;font-weight:800;color:#16a34a;">+Rp ${amount}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.error('Failed to load referrals:', err);
  }
}

function copyReferralCode() {
  const el = document.getElementById('ref-display-code');
  const code = (el ? el.textContent : '') || (document.getElementById('ref-code-input')?.value || '');
  const cleanCode = code.trim();
  if (!cleanCode || cleanCode === 'Loading...' || cleanCode === '------') return;
  navigator.clipboard.writeText(cleanCode).then(() => showToast(`✅ Kode ${cleanCode} disalin ke clipboard!`));
}

function copyReferralLink() {
  const el = document.getElementById('ref-display-link');
  const link = (el ? el.textContent : '') || (document.getElementById('ref-link-input')?.value || '');
  const cleanLink = link.trim();
  if (!cleanLink || cleanLink.startsWith('Loading')) return;
  navigator.clipboard.writeText(cleanLink).then(() => showToast('✅ Link referral disalin ke clipboard!'));
}

function shareReferral() {
  const elCode = document.getElementById('ref-display-code');
  const code = (elCode ? elCode.textContent : '').trim() || '------';
  const elLink = document.getElementById('ref-display-link');
  const link = (elLink ? elLink.textContent : '').trim() || `${window.location.origin}/register?ref=${code}`;
  const shareText = `Halo! Yuk gabung jadi mitra di Akaza Blast dan hasilkan uang dari WhatsApp kamu!\n\nDaftar lewat tautan ini:\n${link}\n\nKode referral: ${code}`;

  if (navigator.share) {
    navigator.share({
      title: 'Akaza Blast Referral',
      text: shareText,
      url: link
    }).catch(() => {
      shareReferralWhatsApp();
    });
  } else {
    shareReferralWhatsApp();
  }
}

function shareReferralWhatsApp() {
  const elCode = document.getElementById('ref-display-code');
  const code = (elCode ? elCode.textContent : '').trim() || '------';
  const elLink = document.getElementById('ref-display-link');
  const link = (elLink ? elLink.textContent : '').trim() || `${window.location.origin}/register?ref=${code}`;
  const msg = encodeURIComponent(`Halo! Yuk gabung jadi mitra Akaza Blast dan hasilkan uang dari WhatsApp kamu!\n\nDaftar gratis lewat link ini:\n${link}\n\nAtau gunakan kode referral: ${code}`);
  window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
}

// ─── Profile Update ────────────────────────────────────────────────
async function handleUpdateProfile(e) {
  e.preventDefault();
  if (!currentUser) {
    showToast('⚠️ Silakan login terlebih dahulu!');
    return;
  }

  const name = document.getElementById('prof-user-name') ? document.getElementById('prof-user-name').value.trim() : '';
  const phone = document.getElementById('prof-user-phone') ? document.getElementById('prof-user-phone').value.trim() : '';
  const ewallet = document.getElementById('prof-ewallet-select').value;
  const ewalletNumber = document.getElementById('prof-ewallet-number').value.trim();
  const ewalletName = document.getElementById('prof-ewallet-name').value.trim();

  const idToUpdate = currentUser.id || currentUser.username || currentUserId;
  const btn = document.getElementById('btn-save-profile');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

  try {
    const res = await fetch(`${API}/api/user/${idToUpdate}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, ewallet, ewalletNumber, ewalletName })
    });
    const d = await res.json();
    if (d.success && d.user) {
      currentUser = { ...currentUser, ...d.user };
      localStorage.setItem('blast_user', JSON.stringify(currentUser));
      updateUserUI();
      showToast('✅ Data profil & E-Wallet berhasil diperbarui!');
    } else {
      showToast(`❌ Gagal: ${d.error || 'Gagal memperbarui profil'}`);
    }
  } catch (err) {
    showToast('❌ Gagal menghubungi server');
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan Profil';
  }
}

// ─── Auth Modal (Login & Register) ─────────────────────────────────
function openAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchAuthMode(mode);
}

function closeAuthModal() {
  // If user is not authenticated yet, do not allow closing without login unless user exists
  if (!currentUser) {
    showToast('Silakan masuk atau daftar akun terlebih dahulu.');
    return;
  }
  const modal = document.getElementById('auth-modal');
  if (modal) modal.style.display = 'none';
}

function switchAuthMode(mode) {
  const loginForm = document.getElementById('form-auth-login');
  const regForm = document.getElementById('form-auth-register');
  const loginBtn = document.getElementById('auth-tab-btn-login');
  const regBtn = document.getElementById('auth-tab-btn-register');
  const title = document.getElementById('auth-modal-title');

  if (mode === 'login') {
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
    if (loginBtn) { loginBtn.className = 'btn-primary'; }
    if (regBtn) { regBtn.className = 'btn-secondary'; }
    if (title) title.textContent = 'Masuk ke Akaza Blast';
  } else {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'block';
    if (loginBtn) { loginBtn.className = 'btn-secondary'; }
    if (regBtn) { regBtn.className = 'btn-primary'; }
    if (title) title.textContent = 'Daftar Akun Mitra Baru';
  }
}

async function handleAuthClick() {
  if (currentUser) {
    const ok = await showCustomConfirm(`Yakin ingin keluar (logout) dari akun @${currentUser.username || currentUser.name}?`, {
      title: 'Keluar Akun',
      confirmText: 'Keluar Sekarang',
      isDanger: true
    });
    if (ok) {
      currentUserId = null;
      currentUser = null;
      localStorage.removeItem('akaza_auth_uid');
      localStorage.removeItem('akaza_uid');
      sessionStorage.removeItem('just_logged_in');
      sessionStorage.removeItem('commission_banner_dismissed');
      window.location.href = '/login';
    }
  } else {
    window.location.href = '/login';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────
function maskPhone(phone) {
  if (!phone || phone === '-') return '-';
  const str = phone.toString().trim();
  if (str.length <= 7) return str;
  if (str.startsWith('+')) {
    const prefixLen = str.length >= 12 ? 5 : 4;
    const start = str.slice(0, prefixLen);
    const end = str.slice(-4);
    return `${start}****${end}`;
  }
  const start = str.slice(0, 4);
  const end = str.slice(-4);
  return `${start}****${end}`;
}

function formatRp(amount) {
  return 'Rp ' + (amount || 0).toLocaleString('id-ID');
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}j lalu`;
  return `${Math.floor(h / 24)}h lalu`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
  const existing = document.getElementById('toast-msg');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast-msg';
  toast.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#1a1a2e;color:#fff;padding:10px 18px;border-radius:8px;
    font-size:13px;font-weight:600;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.3);
    animation:slideUpToast 0.3s ease;white-space:nowrap;max-width:90vw;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ─── Custom UI Popup Dialog (Menggantikan Alert & Confirm Bawaan Browser) ───
function initCustomDialogUI() {
  if (document.getElementById('akaza-custom-dialog-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'akaza-custom-dialog-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 999999;
    display: none;
    align-items: center;
    justify-content: center;
    padding: 16px;
    font-family: inherit;
  `;

  overlay.innerHTML = `
    <div id="akaza-custom-dialog-box" style="
      background: #ffffff;
      border-radius: 20px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      border: 1px solid rgba(226, 232, 240, 0.9);
      transform: scale(0.92);
      opacity: 0;
      transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    ">
      <div style="padding: 28px 24px 18px; text-align: center;">
        <div id="akaza-dialog-icon-box" style="
          width: 64px; height: 64px; border-radius: 50%;
          margin: 0 auto 16px; display: flex; align-items: center;
          justify-content: center; font-size: 28px;
        ">
          <i id="akaza-dialog-icon" class="fa-solid fa-circle-check"></i>
        </div>
        <h3 id="akaza-dialog-title" style="margin: 0 0 8px; font-size: 17px; font-weight: 800; color: #0f172a; letter-spacing: -0.2px;"></h3>
        <div id="akaza-dialog-message" style="margin: 0; font-size: 13.5px; color: #475569; line-height: 1.55; white-space: pre-line; word-break: break-word;"></div>
      </div>
      <div id="akaza-dialog-actions" style="padding: 8px 20px 22px; display: flex; gap: 10px; justify-content: center;">
        <button type="button" id="akaza-dialog-cancel-btn" style="
          display: none; flex: 1; padding: 11px 18px; border-radius: 12px;
          border: 1px solid #cbd5e1; background: #ffffff; color: #475569;
          font-weight: 700; font-size: 13px; cursor: pointer; transition: background 0.15s;
        ">Batal</button>
        <button type="button" id="akaza-dialog-confirm-btn" style="
          flex: 1; padding: 11px 18px; border-radius: 12px;
          border: none; background: #2563eb; color: #ffffff;
          font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.15s;
          box-shadow: 0 4px 14px rgba(37, 99, 235, 0.25);
        ">Oke, Mengerti</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') {
      const cancelBtn = document.getElementById('akaza-dialog-cancel-btn');
      if (cancelBtn && cancelBtn.style.display !== 'none') {
        cancelBtn.click();
      } else {
        const confirmBtn = document.getElementById('akaza-dialog-confirm-btn');
        if (confirmBtn) confirmBtn.click();
      }
    }
  });
}

function showCustomAlert(msg, title = '') {
  return new Promise((resolve) => {
    initCustomDialogUI();
    const overlay = document.getElementById('akaza-custom-dialog-overlay');
    const box = document.getElementById('akaza-custom-dialog-box');
    const titleEl = document.getElementById('akaza-dialog-title');
    const msgEl = document.getElementById('akaza-dialog-message');
    const iconBox = document.getElementById('akaza-dialog-icon-box');
    const iconEl = document.getElementById('akaza-dialog-icon');
    const cancelBtn = document.getElementById('akaza-dialog-cancel-btn');
    const confirmBtn = document.getElementById('akaza-dialog-confirm-btn');

    const msgStr = String(msg || '');
    let finalType = 'info';
    if (msgStr.includes('✅') || msgStr.toLowerCase().includes('berhasil') || msgStr.toLowerCase().includes('sukses')) {
      finalType = 'success';
    } else if (msgStr.includes('❌') || msgStr.toLowerCase().includes('gagal') || msgStr.toLowerCase().includes('error')) {
      finalType = 'error';
    } else if (msgStr.includes('⚠️') || msgStr.toLowerCase().includes('peringatan') || msgStr.toLowerCase().includes('perhatian')) {
      finalType = 'warning';
    }

    const cleanMsg = msgStr.replace(/^[✅❌⚠️ℹ️🎉]\s*/, '');
    let defaultTitle = 'Pemberitahuan';
    if (finalType === 'success') defaultTitle = 'Berhasil!';
    else if (finalType === 'error') defaultTitle = 'Terjadi Kesalahan';
    else if (finalType === 'warning') defaultTitle = 'Perhatian';

    titleEl.textContent = title || defaultTitle;
    msgEl.textContent = cleanMsg;

    if (finalType === 'success') {
      iconBox.style.background = '#ecfdf5';
      iconBox.style.color = '#10b981';
      iconEl.className = 'fa-solid fa-circle-check';
      confirmBtn.style.background = '#10b981';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.3)';
      confirmBtn.textContent = 'Oke, Selesai';
    } else if (finalType === 'error') {
      iconBox.style.background = '#fef2f2';
      iconBox.style.color = '#ef4444';
      iconEl.className = 'fa-solid fa-circle-xmark';
      confirmBtn.style.background = '#ef4444';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(239, 68, 68, 0.3)';
      confirmBtn.textContent = 'Tutup';
    } else if (finalType === 'warning') {
      iconBox.style.background = '#fffbeb';
      iconBox.style.color = '#f59e0b';
      iconEl.className = 'fa-solid fa-triangle-exclamation';
      confirmBtn.style.background = '#f59e0b';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(245, 158, 11, 0.3)';
      confirmBtn.textContent = 'Oke, Mengerti';
    } else {
      iconBox.style.background = '#eff6ff';
      iconBox.style.color = '#3b82f6';
      iconEl.className = 'fa-solid fa-circle-info';
      confirmBtn.style.background = '#2563eb';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(37, 99, 235, 0.3)';
      confirmBtn.textContent = 'Oke';
    }

    cancelBtn.style.display = 'none';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      box.style.transform = 'scale(1)';
      box.style.opacity = '1';
    });

    const finish = () => {
      box.style.transform = 'scale(0.92)';
      box.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
        resolve(true);
      }, 150);
    };

    confirmBtn.onclick = finish;
  });
}

function showCustomConfirm(msg, {
  title = 'Konfirmasi Tindakan',
  confirmText = 'Ya, Lanjutkan',
  cancelText = 'Batal',
  isDanger = false
} = {}) {
  return new Promise((resolve) => {
    initCustomDialogUI();
    const overlay = document.getElementById('akaza-custom-dialog-overlay');
    const box = document.getElementById('akaza-custom-dialog-box');
    const titleEl = document.getElementById('akaza-dialog-title');
    const msgEl = document.getElementById('akaza-dialog-message');
    const iconBox = document.getElementById('akaza-dialog-icon-box');
    const iconEl = document.getElementById('akaza-dialog-icon');
    const cancelBtn = document.getElementById('akaza-dialog-cancel-btn');
    const confirmBtn = document.getElementById('akaza-dialog-confirm-btn');

    titleEl.textContent = title;
    msgEl.textContent = msg;

    if (isDanger) {
      iconBox.style.background = '#fef2f2';
      iconBox.style.color = '#ef4444';
      iconEl.className = 'fa-solid fa-triangle-exclamation';
      confirmBtn.style.background = '#ef4444';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(239, 68, 68, 0.3)';
    } else {
      iconBox.style.background = '#eff6ff';
      iconBox.style.color = '#3b82f6';
      iconEl.className = 'fa-solid fa-circle-question';
      confirmBtn.style.background = '#2563eb';
      confirmBtn.style.boxShadow = '0 4px 14px rgba(37, 99, 235, 0.3)';
    }

    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = 'block';

    overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      box.style.transform = 'scale(1)';
      box.style.opacity = '1';
    });

    const cleanup = (result) => {
      box.style.transform = 'scale(0.92)';
      box.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
        resolve(result);
      }, 150);
    };

    confirmBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

// Override alert bawaan browser agar selalu menampilkan modal custom cantik
window.alert = function(msg) {
  showCustomAlert(msg);
};

// ─── Commission Banner Dismissible ────────────────────────────────
function checkCommissionBanner() {
  const banner = document.getElementById('commission-banner');
  if (!banner) return;
  const isDismissed = sessionStorage.getItem('commission_banner_dismissed') === 'true' ||
                      (currentUserId && localStorage.getItem(`commission_banner_dismissed_${currentUserId}`) === 'true');
  if (isDismissed) {
    banner.style.display = 'none';
  } else {
    banner.style.display = 'flex';
  }
}

function dismissCommissionBanner() {
  const banner = document.getElementById('commission-banner');
  if (banner) {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-6px)';
    banner.style.transition = 'all 0.25s ease';
    setTimeout(() => {
      banner.style.display = 'none';
    }, 250);
  }
  sessionStorage.setItem('commission_banner_dismissed', 'true');
  if (currentUserId) {
    localStorage.setItem(`commission_banner_dismissed_${currentUserId}`, 'true');
  }
}

// ─── Expose to HTML ────────────────────────────────────────────────
window.switchTab = switchTab;
window.openDeviceModal = openDeviceModal;
window.closeDeviceModal = closeDeviceModal;
window.switchDeviceModalTab = switchDeviceModalTab;
window.startQRSession = startQRSession;
window.refreshQRImage = refreshQRImage;
window.generatePairingCode = generatePairingCode;
window.copyPairingCode = copyPairingCode;
window.disconnectDevice = disconnectDevice;
window.deleteDevice = deleteDevice;
window.reconnectDevice = reconnectDevice;
window.handleStartBlast = handleStartBlast;
window.stopBlast = stopBlast;
window.handleWithdrawSubmit = handleWithdrawSubmit;
window.loadAdminDefaultDatabase = loadAdminDefaultDatabase;
window.copyReferralLink = copyReferralLink;
window.copyReferralCode = copyReferralCode;
window.shareReferralWhatsApp = shareReferralWhatsApp;
window.shareReferral = shareReferral;
window.switchReferralSubTab = switchReferralSubTab;
window.changeDeviceMode = changeDeviceMode;
window.handleAuthClick = handleAuthClick;
window.handleUpdateProfile = handleUpdateProfile;
window.dismissCommissionBanner = dismissCommissionBanner;
window.checkCommissionBanner = checkCommissionBanner;

// ─── Maintenance Mode User Logic ──────────────────────────────────
async function checkUserMaintenanceStatus(showToastFeedback = false) {
  const refreshBtnIcon = document.getElementById('maint-refresh-icon');
  if (refreshBtnIcon) refreshBtnIcon.classList.add('fa-spin');

  try {
    const res = await fetch(`${API}/api/system/maintenance`);
    const data = await res.json();
    const overlay = document.getElementById('maintenance-screen-overlay');
    const msgText = document.getElementById('maintenance-message-text');

    if (data.maintenance) {
      if (overlay) overlay.style.display = 'flex';
      if (msgText) msgText.textContent = data.message || 'Sistem sedang dalam pemeliharaan rutin untuk peningkatan performa. Silakan coba beberapa saat lagi.';
      if (showToastFeedback) {
        showToast('⚠️ Sistem masih dalam pemeliharaan rutin. Silakan coba lagi nanti.');
      }
    } else {
      if (overlay && overlay.style.display !== 'none') {
        overlay.style.display = 'none';
        if (showToastFeedback) {
          showToast('✅ Pemeliharaan selesai! Sistem sudah aktif kembali.');
        }
      }
    }
  } catch (err) {
    console.error('Failed to check maintenance status:', err);
  } finally {
    if (refreshBtnIcon) {
      setTimeout(() => refreshBtnIcon.classList.remove('fa-spin'), 600);
    }
  }
}

window.checkUserMaintenanceStatus = checkUserMaintenanceStatus;
