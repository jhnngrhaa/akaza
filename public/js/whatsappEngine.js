/**
 * WhatsApp Engine & Multi-Device Blast Simulator
 * Handles Device connection (QR & Pairing Code), Campaign Blast Queue,
 * Commission Calculation, and Local Storage State.
 */

import { SpintaxEngine } from './spintax.js';

export class WhatsAppEngine {
  constructor() {
    this.storageKey = 'blastwa_platform_state_v1';
    this.activeBlast = null;
    this.isPaused = false;
    this.listeners = {};
    this.loadState();
  }

  // Event dispatcher
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  // Load from local storage or initialize defaults
  loadState() {
    const raw = localStorage.getItem(this.storageKey);
    if (raw) {
      try {
        this.state = JSON.parse(raw);
        return;
      } catch (e) {
        console.error('Failed to parse state, initializing default', e);
      }
    }

    this.state = {
      // Status Mode Pekerja Otomatis User
      autoWorkerActive: true,
      
      // Profil User Mitra
      user: {
        id: 'usr_001',
        name: 'Rian Pratama',
        email: 'rian.pratama@gmail.com',
        phone: '6281234567890',
        referralCode: 'RIAN-WA88',
        saldo: 375000,
        commissionPerMessage: 50,
        referralCommissionPerMessage: 10,
        joinedDate: '2026-08-15'
      },

      // Database Nomor Sasaran Masal dari Admin
      adminDatabaseContacts: [
        { id: 'c_01', phone: '6281234567890', name: 'Budi Santoso', status: 'pending', city: 'Jakarta' },
        { id: 'c_02', phone: '6285788990011', name: 'Siti Nurhaliza', status: 'pending', city: 'Bandung' },
        { id: 'c_03', phone: '6289612344321', name: 'Dani Saputra', status: 'pending', city: 'Surabaya' },
        { id: 'c_04', phone: '6282199887766', name: 'Rina Anggraini', status: 'pending', city: 'Medan' },
        { id: 'c_05', phone: '6281344556677', name: 'Hendra Gunawan', status: 'pending', city: 'Semarang' },
        { id: 'c_06', phone: '6287811223344', name: 'Dewi Lestari', status: 'pending', city: 'Yogyakarta' },
        { id: 'c_07', phone: '6289566778899', name: 'Ahmad Fauzi', status: 'pending', city: 'Makassar' },
        { id: 'c_08', phone: '6285233445566', name: 'Maya Indah', status: 'pending', city: 'Denpasar' }
      ],

      // Kampanye Pesan Default dari Admin
      adminBroadcastConfig: {
        title: 'Broadcast Promosi Flash Sale Admin',
        template: '{Halo|Hai|Selamat Siang} Kak {nama},\n\nKami dari Official Store ingin menginfokan promo diskon spesial hingga 50% untuk wilayah {var1} hari ini!\n\nInfo selengkapnya: https://officialstore.id/promo\n\nTerima kasih!',
        delayMin: 3,
        delayMax: 6,
        status: 'ready' // 'ready' | 'running' | 'paused' | 'completed'
      },
      devices: [
        {
          id: 'dev_101',
          name: 'WhatsApp Bisnis Utama',
          phone: '6281234567890',
          type: 'QR',
          status: 'online', // 'online' | 'disconnected'
          connectedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
          sentToday: 142,
          totalSent: 1840,
          battery: 88
        },
        {
          id: 'dev_102',
          name: 'Device CS Toko Online',
          phone: '6285789123445',
          type: 'Pairing',
          status: 'online',
          connectedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
          sentToday: 110,
          totalSent: 1420,
          battery: 95
        }
      ],
      campaigns: [
        {
          id: 'camp_001',
          title: 'Promo Flash Sale 9.9',
          totalRecipients: 500,
          sent: 492,
          failed: 8,
          status: 'completed',
          createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
          cost: 25000
        }
      ],
      history: [
        {
          id: 'hist_01',
          recipient: '6281399887766',
          recipientName: 'Budi Santoso',
          deviceId: 'dev_101',
          devicePhone: '6281234567890',
          message: 'Halo Kak Budi, jangan lewatkan voucher diskon spesial hari ini ya!',
          status: 'sent',
          commissionEarned: 50,
          timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString()
        },
        {
          id: 'hist_02',
          recipient: '6287711223344',
          recipientName: 'Siti Rahma',
          deviceId: 'dev_102',
          devicePhone: '6285789123445',
          message: 'Hai Kak Siti, promo diskon hingga 40% berlaku sampai malam ini.',
          status: 'sent',
          commissionEarned: 50,
          timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString()
        }
      ],
      withdrawals: [
        {
          id: 'wd_001',
          amount: 250000,
          bank: 'BCA',
          accountNumber: '8271928371',
          accountName: 'Rian Pratama',
          status: 'approved', // 'pending' | 'approved' | 'rejected'
          requestedAt: new Date(Date.now() - 3600000 * 72).toISOString(),
          completedAt: new Date(Date.now() - 3600000 * 48).toISOString()
        }
      ],
      referrals: [
        {
          id: 'ref_1',
          name: 'Dimas Wijaya',
          phone: '6282144332211',
          registeredAt: '2026-09-10',
          totalMessagesSent: 480,
          commissionEarned: 4800
        },
        {
          id: 'ref_2',
          name: 'Agus Saputra',
          phone: '6289655443322',
          registeredAt: '2026-09-14',
          totalMessagesSent: 720,
          commissionEarned: 7200
        }
      ],
      templates: [
        {
          id: 'tpl_1',
          title: 'Promo Diskon Eksklusif',
          content: '{Halo|Hai|Selamat Siang} {nama},\n\nKami ada penawaran spesial diskon hingga 50% untuk produk pilihan minggu ini!\n\nKlaim sekarang sebelum kehabisan: https://tokokita.id/promo\n\nTerima kasih!'
        },
        {
          id: 'tpl_2',
          title: 'Notifikasi Konfirmasi Pesanan',
          content: 'Halo {nama},\n\nPesanan #{var1} Anda telah berhasil kami terima dan sedang diproses oleh tim gudang.\n\nEstimasi pengiriman 1-2 hari kerja. Terima kasih telah berbelanja bersama kami.'
        },
        {
          id: 'tpl_3',
          title: 'Pengingat Pembayaran / Tagihan',
          content: '{Yth.|Salam Hangat} {nama},\n\nIni adalah pengingat ramah untuk tagihan #{var1} yang akan jatuh tempo pada besok hari.\n\nSilakan abaikan pesan ini jika Anda sudah melakukan pembayaran. Terima kasih.'
        }
      ]
    };
    this.saveState();
  }

  saveState() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    this.emit('stateChanged', this.state);
  }

  // --- DEVICE MANAGEMENT ---

  generateRandomQRString(prefix = 'BLASTWA') {
    return `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now()}`;
  }

  generatePairingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let p1 = '';
    let p2 = '';
    for (let i = 0; i < 4; i++) p1 += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) p2 += chars.charAt(Math.floor(Math.random() * chars.length));
    return `${p1}-${p2}`;
  }

  addDevice({ name, phone, type }) {
    const newDevice = {
      id: `dev_${Date.now()}`,
      name: name || `Perangkat WhatsApp ${this.state.devices.length + 1}`,
      phone: SpintaxEngine.cleanPhoneNumber(phone),
      type: type || 'QR',
      status: 'online',
      connectedAt: new Date().toISOString(),
      sentToday: 0,
      totalSent: 0,
      battery: Math.floor(Math.random() * 20) + 80
    };

    this.state.devices.push(newDevice);
    this.saveState();
    return newDevice;
  }

  disconnectDevice(deviceId) {
    const dev = this.state.devices.find(d => d.id === deviceId);
    if (dev) {
      dev.status = 'disconnected';
      this.saveState();
    }
  }

  reconnectDevice(deviceId) {
    const dev = this.state.devices.find(d => d.id === deviceId);
    if (dev) {
      dev.status = 'online';
      this.saveState();
    }
  }

  removeDevice(deviceId) {
    this.state.devices = this.state.devices.filter(d => d.id !== deviceId);
    this.saveState();
  }

  getActiveDevices() {
    return this.state.devices.filter(d => d.status === 'online');
  }

  // --- AUTO-WORKER FOR USERS ---

  toggleAutoWorker(enabled) {
    this.state.autoWorkerActive = enabled !== undefined ? enabled : !this.state.autoWorkerActive;
    this.saveState();
    this.emit('autoWorkerToggled', this.state.autoWorkerActive);
    return this.state.autoWorkerActive;
  }

  // --- ADMIN DATABASE & GLOBAL CAMPAIGN ---

  importAdminDatabase(newContacts, replace = false) {
    if (replace) {
      this.state.adminDatabaseContacts = newContacts;
    } else {
      this.state.adminDatabaseContacts = [...this.state.adminDatabaseContacts, ...newContacts];
    }
    this.saveState();
    return this.state.adminDatabaseContacts;
  }

  updateAdminBroadcastConfig({ title, template, delayMin, delayMax }) {
    this.state.adminBroadcastConfig = {
      ...this.state.adminBroadcastConfig,
      title: title || this.state.adminBroadcastConfig.title,
      template: template || this.state.adminBroadcastConfig.template,
      delayMin: delayMin || this.state.adminBroadcastConfig.delayMin,
      delayMax: delayMax || this.state.adminBroadcastConfig.delayMax
    };
    this.saveState();
    return this.state.adminBroadcastConfig;
  }

  startAdminGlobalBlast() {
    if (!this.state.autoWorkerActive) {
      throw new Error('Mode Pekerja Otomatis sedang dimatikan oleh User. Aktifkan tombol pekerja otomatis terlebih dahulu.');
    }

    const pendingContacts = this.state.adminDatabaseContacts.filter(c => c.status !== 'sent');
    if (pendingContacts.length === 0) {
      throw new Error('Semua nomor di database admin sudah terkirim! Silakan upload atau tambahkan nomor baru.');
    }

    const cfg = this.state.adminBroadcastConfig;
    return this.startBlast({
      title: cfg.title,
      template: cfg.template,
      contacts: pendingContacts,
      minDelay: cfg.delayMin || 2,
      maxDelay: cfg.delayMax || 5
    });
  }

  // --- CAMPAIGN BLAST SYSTEM ---

  startBlast({ title, template, contacts, minDelay = 2, maxDelay = 5, usePool = true }) {
    const activeDevices = this.getActiveDevices();
    if (activeDevices.length === 0) {
      throw new Error('Tidak ada perangkat WhatsApp yang aktif/terhubung! Silakan scan QR / tambah device terlebih dahulu.');
    }

    if (!contacts || contacts.length === 0) {
      throw new Error('Daftar nomor penerima tidak boleh kosong.');
    }

    const campaignId = `camp_${Date.now()}`;
    const newCampaign = {
      id: campaignId,
      title: title || `Kampanye Siaran ${new Date().toLocaleDateString('id-ID')}`,
      template,
      totalRecipients: contacts.length,
      sent: 0,
      failed: 0,
      status: 'running',
      createdAt: new Date().toISOString(),
      logs: []
    };

    this.state.campaigns.unshift(newCampaign);
    this.saveState();

    this.activeBlast = {
      campaign: newCampaign,
      contacts: [...contacts],
      currentIndex: 0,
      minDelay,
      maxDelay,
      activeDevices
    };

    this.isPaused = false;
    this.processNextInQueue();
    return newCampaign;
  }

  pauseBlast() {
    this.isPaused = true;
    if (this.activeBlast) {
      this.activeBlast.campaign.status = 'paused';
      this.saveState();
      this.emit('blastPaused', this.activeBlast.campaign);
    }
  }

  resumeBlast() {
    if (this.activeBlast && this.isPaused) {
      this.isPaused = false;
      this.activeBlast.campaign.status = 'running';
      this.saveState();
      this.emit('blastResumed', this.activeBlast.campaign);
      this.processNextInQueue();
    }
  }

  cancelBlast() {
    if (this.activeBlast) {
      this.activeBlast.campaign.status = 'cancelled';
      this.saveState();
      this.emit('blastCancelled', this.activeBlast.campaign);
      this.activeBlast = null;
    }
  }

  processNextInQueue() {
    if (!this.activeBlast || this.isPaused) return;

    const { campaign, contacts, currentIndex, minDelay, maxDelay, activeDevices } = this.activeBlast;

    if (currentIndex >= contacts.length) {
      campaign.status = 'completed';
      this.saveState();
      this.emit('blastCompleted', campaign);
      this.activeBlast = null;
      return;
    }

    const contact = contacts[currentIndex];
    // Round-robin device assignment
    const deviceIndex = currentIndex % activeDevices.length;
    const device = activeDevices[deviceIndex];

    // Calculate random delay
    const delayMs = (Math.random() * (maxDelay - minDelay) + minDelay) * 1000;

    setTimeout(() => {
      if (!this.activeBlast || this.isPaused) return;

      // Simulate sending success (97% success rate)
      const isSuccess = Math.random() < 0.97;
      const messageContent = SpintaxEngine.interpolate(campaign.template, contact);

      if (isSuccess) {
        campaign.sent += 1;
        device.sentToday += 1;
        device.totalSent += 1;

        // Reward commission
        const earned = this.state.user.commissionPerMessage;
        this.state.user.saldo += earned;

        // Add to history
        this.state.history.unshift({
          id: `hist_${Date.now()}_${currentIndex}`,
          recipient: contact.phone,
          recipientName: contact.name,
          deviceId: device.id,
          devicePhone: device.phone,
          message: messageContent,
          status: 'sent',
          commissionEarned: earned,
          timestamp: new Date().toISOString()
        });

        // Add log
        const logItem = {
          time: new Date().toLocaleTimeString('id-ID'),
          status: 'success',
          text: `[Terkirim] Nomor ${contact.phone} (${contact.name}) via ${device.phone} (+Rp ${earned})`
        };
        campaign.logs = campaign.logs || [];
        campaign.logs.unshift(logItem);

        this.emit('messageSent', {
          campaign,
          contact,
          device,
          messageContent,
          logItem,
          progress: ((currentIndex + 1) / contacts.length) * 100
        });

      } else {
        campaign.failed += 1;
        const logItem = {
          time: new Date().toLocaleTimeString('id-ID'),
          status: 'error',
          text: `[Gagal] Nomor ${contact.phone} (${contact.name}) - Perangkat sibuk / timeout`
        };
        campaign.logs = campaign.logs || [];
        campaign.logs.unshift(logItem);

        this.emit('messageFailed', {
          campaign,
          contact,
          device,
          logItem,
          progress: ((currentIndex + 1) / contacts.length) * 100
        });
      }

      this.activeBlast.currentIndex += 1;
      this.saveState();
      this.processNextInQueue();
    }, delayMs);
  }

  // --- WITHDRAWALS ---

  requestWithdraw({ amount, bank, accountNumber, accountName }) {
    if (amount < 30000) {
      throw new Error('Minimum penarikan dana adalah Rp 30.000');
    }
    if (amount > this.state.user.saldo) {
      throw new Error('Saldo tidak mencukupi untuk melakukan penarikan ini.');
    }

    this.state.user.saldo -= amount;
    const newWd = {
      id: `wd_${Date.now()}`,
      amount,
      bank,
      accountNumber,
      accountName,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      completedAt: null
    };

    this.state.withdrawals.unshift(newWd);
    this.saveState();
    return newWd;
  }

  approveWithdraw(wdId) {
    const wd = this.state.withdrawals.find(w => w.id === wdId);
    if (wd && wd.status === 'pending') {
      wd.status = 'approved';
      wd.completedAt = new Date().toISOString();
      this.saveState();
      return wd;
    }
  }

  rejectWithdraw(wdId, reason = 'Data rekening tidak sesuai') {
    const wd = this.state.withdrawals.find(w => w.id === wdId);
    if (wd && wd.status === 'pending') {
      wd.status = 'rejected';
      wd.completedAt = new Date().toISOString();
      // Refund saldo
      this.state.user.saldo += wd.amount;
      this.saveState();
      return wd;
    }
  }

  // --- TEMPLATES ---

  addTemplate({ title, content }) {
    const newTpl = {
      id: `tpl_${Date.now()}`,
      title,
      content
    };
    this.state.templates.push(newTpl);
    this.saveState();
    return newTpl;
  }

  deleteTemplate(id) {
    this.state.templates = this.state.templates.filter(t => t.id !== id);
    this.saveState();
  }
}
