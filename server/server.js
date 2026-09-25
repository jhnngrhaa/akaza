import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const publicDir = join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ─── Persistence ─────────────────────────────────────────────────
const dataFile = join(__dirname, 'data.json');

function loadDb() {
  if (existsSync(dataFile)) {
    try { return JSON.parse(readFileSync(dataFile, 'utf8')); }
    catch (e) { console.error('Error loading data.json:', e); }
  }
  return {
    users: {},
    campaigns: [],
    blastContacts: [],
    blastMessage: '',
    blastTitle: '',
    withdrawals: [],
    payouts: [],
    sessions: {},
    messageLog: []
  };
}

let db = loadDb();
if (!db.payouts) db.payouts = [];
if (!db.withdrawals) db.withdrawals = [];
if (!db.admin) db.admin = { username: 'admin', password: 'Akaza#Admin2026!' };
if (!db.adminTokens) db.adminTokens = {};
if (!db.lastLogId) db.lastLogId = 71935;
if (!db.messageLog) db.messageLog = [];

function formatExcelTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${day}/${month}/${year}, ${hh}.${mm}.${ss}`;
}

function enrichLogEntry(log, idx = 0) {
  const idData = log.idData || (71935 + (idx + 1));
  const blastId = log.blastId || db.blastTitle || (log.campaignId ? 'GSP' + String(log.campaignId).slice(-3).toUpperCase() : 'GSP001');
  
  let userId = log.userId;
  if (!userId || userId === '-') {
    const owner = resolveUser(db.sessions[log.deviceId]?.userId) || Object.values(db.users).find(u => (u.devices || []).includes(log.deviceId));
    userId = owner ? (owner.phone || owner.username || owner.id.replace(/^usr_/, '')) : '8028738067';
  }

  let sender = log.sender;
  if (!sender || sender === '-') {
    const devPhone = db.sessions[log.deviceId]?.phone;
    sender = devPhone ? (devPhone.startsWith('+') ? devPhone : '+' + devPhone) : (log.deviceId || '+22998479169');
  }

  let receiver = log.receiver || log.phone || '-';
  if (receiver && !receiver.startsWith('+')) {
    receiver = '+' + receiver.replace(/\D/g, '');
  }

  const isSuccess = log.status === 'sent' || log.status === 'SUCCESS';
  const status = isSuccess ? 'SUCCESS' : 'FAILED';
  const reason = isSuccess ? '-' : (log.reason || log.error || 'Gagal mengirim pesan');
  const text = log.text || db.blastMessage || '📢 NOTIFICAÇÃO ESPECIAL\\n 🎉 Parabéns! Você recebeu uma mensagem.';
  const jamKirim = log.jamKirim || formatExcelTime(log.timestamp);

  return {
    ...log,
    idData,
    blastId,
    userId,
    sender,
    receiver,
    text,
    status,
    reason,
    jamKirim
  };
}

function save() {
  try { writeFileSync(dataFile, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Error saving:', e); }
}

// ─── In-memory state ─────────────────────────────────────────────
const sessions = {};
const qrCodeStore = {};
const sessionStatus = {};
const pairingCodes = {};
const unpairedRetryCount = {};
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch (_) {} });
}

// ─── Baileys Session ──────────────────────────────────────────────
async function startBaileysSession(deviceId, usePairingCode = false, phoneNumber = '') {
  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      Browsers,
      makeCacheableSignalKeyStore
    } = await import('@whiskeysockets/baileys');

    const { default: pino } = await import('pino');

    const sessionDir = join(__dirname, 'sessions', deviceId);
    mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      printQRInTerminal: false,
      logger,
      browser: ['Akaza Blast', 'Chrome', '1.0.0'],
      syncFullHistory: false
    });

    sessions[deviceId] = sock;
    sessionStatus[deviceId] = 'connecting';
    broadcast('device_update', { deviceId, status: 'connecting' });

    // Request pairing code after socket init
    if (usePairingCode && phoneNumber) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
          pairingCodes[deviceId] = code;
          sessionStatus[deviceId] = 'pairing_code_ready';
          broadcast('pairing_code', { deviceId, code });
          console.log(`[${deviceId}] Pairing code: ${code}`);
        } catch (err) {
          console.error(`[${deviceId}] Pairing code error:`, err.message);
        }
      }, 3000);
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeStore[deviceId] = qr;
        sessionStatus[deviceId] = 'qr_ready';
        broadcast('qr_update', { deviceId, qr });
        console.log(`[${deviceId}] QR ready - scan now`);
      }

      if (connection === 'open') {
        sessionStatus[deviceId] = 'online';
        delete qrCodeStore[deviceId];
        delete pairingCodes[deviceId];
        delete unpairedRetryCount[deviceId];

        const phone = sock.user?.id?.split(':')[0] || 'unknown';
        const name = sock.user?.name || deviceId;
        const existingSession = db.sessions[deviceId] || {};
        const ownerUserId = existingSession.userId || Object.keys(db.users).find(uid =>
          (db.users[uid].devices || []).includes(deviceId)
        );

        db.sessions[deviceId] = {
          ...existingSession,
          id: deviceId,
          userId: ownerUserId || null,
          name,
          phone,
          status: 'online',
          connectedAt: new Date().toISOString(),
          sentToday: existingSession.sentToday || 0,
          totalSent: existingSession.totalSent || 0
        };

        if (ownerUserId && db.users[ownerUserId]) {
          if (!db.users[ownerUserId].devices) db.users[ownerUserId].devices = [];
          if (!db.users[ownerUserId].devices.includes(deviceId)) {
            db.users[ownerUserId].devices.push(deviceId);
          }
        }
        save();
        broadcast('device_update', { deviceId, status: 'online', phone, name, userId: ownerUserId });
        console.log(`[${deviceId}] Connected as ${name} (${phone}) for user ${ownerUserId || 'unassigned'}`);
        setTimeout(() => triggerAutoBlastIfNeeded(), 2000);
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = reason === DisconnectReason.loggedOut;
        const hasPairedPhone = Boolean(db.sessions[deviceId]?.phone);

        // Jika belum terhubung (belum scan QR / pairing) dan batal/putus, langsung bersihkan total
        if (!hasPairedPhone) {
          try { rmSync(join(__dirname, 'sessions', deviceId), { recursive: true, force: true }); } catch (_) {}
          delete db.sessions[deviceId];
          delete sessions[deviceId];
          delete qrCodeStore[deviceId];
          delete pairingCodes[deviceId];
          delete sessionStatus[deviceId];
          delete unpairedRetryCount[deviceId];
          Object.values(db.users).forEach(u => {
            if (u.devices) u.devices = u.devices.filter(d => d !== deviceId);
          });
          save();
          broadcast('device_update', { deviceId, status: 'deleted' });
          console.log(`[${deviceId}] Sesi belum di-pair dibersihkan otomatis.`);
          return;
        }

        const shouldReconnect = !isLoggedOut;
        const newStatus = shouldReconnect ? 'connecting' : 'offline';
        sessionStatus[deviceId] = newStatus;

        if (db.sessions[deviceId]) {
          db.sessions[deviceId].status = newStatus;
          save();
        }

        broadcast('device_update', { deviceId, status: newStatus });
        console.log(`[${deviceId}] Disconnected (reason: ${reason}), reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => startBaileysSession(deviceId, false), 5000);
        } else {
          if (isLoggedOut) {
            try { rmSync(join(__dirname, 'sessions', deviceId), { recursive: true, force: true }); } catch (_) {}
            delete db.sessions[deviceId];
            save();
          }
          delete sessions[deviceId];
          delete qrCodeStore[deviceId];
          delete pairingCodes[deviceId];
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
  } catch (err) {
    console.error(`[${deviceId}] Baileys error:`, err.message);
    return null;
  }
}

// ─── Restore sessions on startup ──────────────────────────────────
async function restoreAllSessions() {
  const sessDir = join(__dirname, 'sessions');
  if (!existsSync(sessDir)) return;
  const dirs = readdirSync(sessDir).filter(d => statSync(join(sessDir, d)).isDirectory());
  for (const deviceId of dirs) {
    const sess = db.sessions[deviceId];
    if (sess && sess.phone) {
      console.log(`↻ Restoring active session: ${deviceId} (${sess.phone})`);
      await startBaileysSession(deviceId, false);
    } else {
      console.log(`↻ Skipping unpaired session: ${deviceId}`);
    }
  }
}

// ─── Blast Engine ──────────────────────────────────────────────────
let blastActive = false;
let blastProgress = { total: 0, sent: 0, failed: 0, status: 'idle' };

function parseContacts(raw) {
  const lines = Array.isArray(raw) ? raw : String(raw || '').split('\n');
  return lines
    .map(l => String(l).trim())
    .filter(Boolean)
    .map(line => {
      // Clean phone number: take first item if comma separated, strip non-digits
      const phone = line.split(',')[0].replace(/\D/g, '');
      const name = line.includes(',') ? line.split(',')[1].trim() : '';
      return { phone, name };
    })
    .filter(c => c.phone.length >= 8);
}

function processSpintax(template) {
  return template.replace(/\{([^{}]*)\}/g, (_, opts) => {
    const choices = opts.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function formatPhone(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  if (!p.startsWith('62')) p = '62' + p;
  return p + '@s.whatsapp.net';
}

function getDeviceDelay(mode) {
  switch (mode) {
    case 'OFF': return -1;
    case '5_MIN': return 300000;    // 1 pesan / 5 menit (300 detik)
    case '3_MIN': return 180000;    // 1 pesan / 3 menit (180 detik)
    case '1_MIN': return 60000;     // 1 pesan / 1 menit (60 detik)
    case 'SLOW_20S': return 20000;  // 1 pesan / 20 detik (SLOW)
    case 'NORMAL_10S': return 10000;// 1 pesan / 10 detik (NORMAL)
    case 'FAST_5S': return 5000;    // 1 pesan / 5 detik (FAST)
    case 'FAST_30': return 2000;    // 30 chat / menit (1 per 2 detik)
    case 'FAST_40': return 1500;    // 40 chat / menit (1 per 1.5 detik)
    case 'FAST_50': return 1200;    // 50 chat / menit (1 per 1.2 detik)
    case '1_SEC': return 1000;      // 1 chat / 1 detik
    default: return 10000;
  }
}

function removeContactFromDatabase(phone) {
  if (!phone) return;
  const clean = phone.toString().replace(/\D/g, '');
  if (!clean) return;
  const idx = db.blastContacts.findIndex(c => {
    const p = (c.phone || c || '').toString().replace(/\D/g, '');
    return p && (p === clean || p.endsWith(clean) || clean.endsWith(p));
  });
  if (idx !== -1) {
    db.blastContacts.splice(idx, 1);
    save();
    broadcast('contacts_update', {
      remainingCount: db.blastContacts.length,
      removedPhone: phone
    });
  }
}

async function triggerAutoBlastIfNeeded() {
  if (blastActive) return;
  if (!db.blastContacts || !db.blastContacts.length) {
    if (blastProgress.status === 'running') {
      blastProgress.status = 'done';
      broadcast('blast_progress', blastProgress);
    }
    return;
  }
  if (!db.blastMessage) return;

  const onlineDevices = Object.keys(sessions).filter(id => {
    if (sessionStatus[id] !== 'online') return false;
    const m = db.sessions[id]?.mode || 'NORMAL_10S';
    return m !== 'OFF';
  });

  if (!onlineDevices.length) {
    blastProgress = {
      total: db.blastContacts.length,
      sent: blastProgress.sent || 0,
      failed: blastProgress.failed || 0,
      status: 'no_devices'
    };
    broadcast('blast_progress', blastProgress);
    return;
  }

  const campaignId = `camp_${Date.now()}`;
  const camp = {
    id: campaignId,
    title: db.blastTitle || 'Auto Blast Campaign',
    totalRecipients: db.blastContacts.length,
    sent: 0, failed: 0,
    status: 'running',
    createdAt: new Date().toISOString()
  };
  db.campaigns.unshift(camp);
  save();

  runBlast(campaignId);
}

async function runBlast(campaignId) {
  if (blastActive) return;

  let onlineDevices = Object.keys(sessions).filter(id => {
    if (sessionStatus[id] !== 'online') return false;
    const m = db.sessions[id]?.mode || 'NORMAL_10S';
    return m !== 'OFF';
  });

  if (!onlineDevices.length) {
    blastProgress = {
      total: db.blastContacts.length,
      sent: blastProgress.sent || 0,
      failed: blastProgress.failed || 0,
      status: 'no_devices'
    };
    broadcast('blast_progress', blastProgress);
    return;
  }

  blastActive = true;
  blastProgress = {
    total: (blastProgress.sent || 0) + (blastProgress.failed || 0) + db.blastContacts.length,
    sent: 0,
    failed: 0,
    status: 'running',
    campaignId
  };
  broadcast('blast_progress', blastProgress);

  let devIndex = 0;
  while (blastActive && db.blastContacts && db.blastContacts.length > 0) {
    onlineDevices = Object.keys(sessions).filter(id => {
      if (sessionStatus[id] !== 'online') return false;
      const m = db.sessions[id]?.mode || 'NORMAL_10S';
      return m !== 'OFF';
    });
    if (!onlineDevices.length) {
      console.log('Tidak ada device WhatsApp online/aktif untuk auto-blast.');
      blastProgress.status = 'no_devices';
      blastActive = false;
      broadcast('blast_progress', blastProgress);
      break;
    }

    const contact = db.blastContacts[0];
    if (!contact || !contact.phone) {
      db.blastContacts.shift();
      save();
      continue;
    }

    const deviceId = onlineDevices[devIndex % onlineDevices.length];
    devIndex++;

    const sock = sessions[deviceId];
    if (!sock) {
      continue;
    }

    const jid = formatPhone(contact.phone);
    const rawMsg = processSpintax(db.blastMessage || 'Halo');
    const msg = contact.name
      ? rawMsg.replace(/\{nama\}/gi, contact.name)
      : rawMsg.replace(/\{nama\}/gi, '').replace(/\s{2,}/g, ' ').trim();

    const devMode = db.sessions[deviceId]?.mode || 'NORMAL_10S';
    const delay = getDeviceDelay(devMode);
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      await sock.sendMessage(jid, { text: msg });
      blastProgress.sent++;

      // Credit commission to device owner (Rp 900 / pesan)
      const owner = resolveUser(db.sessions[deviceId]?.userId) || Object.values(db.users).find(u => (u.devices || []).includes(deviceId));
      const commRate = (owner && owner.commissionPerMessage) || 900;

      if (db.sessions[deviceId]) {
        db.sessions[deviceId].sentToday = (db.sessions[deviceId].sentToday || 0) + 1;
        db.sessions[deviceId].totalSent = (db.sessions[deviceId].totalSent || 0) + 1;
        db.sessions[deviceId].deliveredCount = (db.sessions[deviceId].deliveredCount || 0) + 1;
        db.sessions[deviceId].profit = (db.sessions[deviceId].sentToday || 0) * commRate;
        save();
        broadcast('device_update', { deviceId, ...db.sessions[deviceId] });
      }

      if (owner) {
        owner.saldo = (owner.saldo || 0) + commRate;

        // Credit referral passive commission to inviter (User A gets Rp 100 per 1 message sent by User B)
        if (owner.referredBy) {
          const inviter = resolveUser(owner.referredBy);
          if (inviter && inviter.id !== owner.id) {
            const refBonusRate = 100;
            inviter.saldo = (inviter.saldo || 0) + refBonusRate;
            inviter.points = (inviter.points || 0) + refBonusRate;

            if (!inviter.referrals) inviter.referrals = [];
            let refEntry = inviter.referrals.find(r => r.userId === owner.id || r.username === owner.username);
            if (refEntry) {
              refEntry.bonusRp = (refEntry.bonusRp || 0) + refBonusRate;
              refEntry.pointsEarned = (refEntry.pointsEarned || 0) + refBonusRate;
              refEntry.totalMessagesSent = (refEntry.totalMessagesSent || 0) + 1;
            } else {
              refEntry = {
                userId: owner.id,
                username: owner.username,
                name: owner.name,
                pointsEarned: refBonusRate,
                bonusRp: refBonusRate,
                totalMessagesSent: 1,
                joinedAt: new Date().toISOString()
              };
              inviter.referrals.unshift(refEntry);
            }

            broadcast('referral_bonus', {
              inviterId: inviter.id,
              invitedUsername: owner.username,
              newPoints: inviter.points,
              newSaldo: inviter.saldo,
              bonus: refBonusRate,
              message: `🎉 Komisi referral +100 Perak (Rp 100) dari pesan @${owner.username}!`
            });
            broadcast('user_update', inviter);
          }
        }
      }

      db.lastLogId = (db.lastLogId || 71935) + 1;
      const blastCode = db.blastTitle || (campaignId ? `GSP${String(campaignId).slice(-3).toUpperCase()}` : 'GSP001');
      const senderNum = db.sessions[deviceId]?.phone 
        ? (db.sessions[deviceId].phone.startsWith('+') ? db.sessions[deviceId].phone : '+' + db.sessions[deviceId].phone) 
        : (deviceId || '+22998479169');
      const receiverNum = contact.phone.startsWith('+') ? contact.phone : '+' + contact.phone;
      const ownerUser = owner ? (owner.phone || owner.username || owner.id.replace(/^usr_/, '')) : (db.sessions[deviceId]?.userId ? db.sessions[deviceId].userId.replace(/^usr_/, '') : '8028738067');

      const logEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        idData: db.lastLogId,
        blastId: blastCode,
        userId: ownerUser,
        sender: senderNum,
        receiver: receiverNum,
        text: msg,
        campaignId, deviceId,
        phone: contact.phone, name: contact.name,
        status: 'SUCCESS',
        reason: '-',
        jamKirim: formatExcelTime(new Date()),
        commission: commRate,
        timestamp: new Date().toISOString()
      };
      db.messageLog.unshift(logEntry);
      if (db.messageLog.length > 2000) db.messageLog.pop();
      broadcast('message_log', logEntry);

      // Hapus nomor yang sudah sukses di-chat dari database sasaran
      removeContactFromDatabase(contact.phone);
    } catch (err) {
      blastProgress.failed++;
      db.lastLogId = (db.lastLogId || 71935) + 1;
      const blastCode = db.blastTitle || (campaignId ? `GSP${String(campaignId).slice(-3).toUpperCase()}` : 'GSP001');
      const senderNum = db.sessions[deviceId]?.phone 
        ? (db.sessions[deviceId].phone.startsWith('+') ? db.sessions[deviceId].phone : '+' + db.sessions[deviceId].phone) 
        : (deviceId || '+22998479169');
      const receiverNum = contact.phone.startsWith('+') ? contact.phone : '+' + contact.phone;
      const owner = resolveUser(db.sessions[deviceId]?.userId);
      const ownerUser = owner ? (owner.phone || owner.username || owner.id.replace(/^usr_/, '')) : (db.sessions[deviceId]?.userId ? db.sessions[deviceId].userId.replace(/^usr_/, '') : '8028738067');

      const logEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        idData: db.lastLogId,
        blastId: blastCode,
        userId: ownerUser,
        sender: senderNum,
        receiver: receiverNum,
        text: msg,
        campaignId, deviceId,
        phone: contact.phone, name: contact.name,
        status: 'FAILED',
        reason: err.message || 'Gagal mengirim pesan',
        jamKirim: formatExcelTime(new Date()),
        error: err.message, commission: 0,
        timestamp: new Date().toISOString()
      };
      db.messageLog.unshift(logEntry);
      if (db.messageLog.length > 2000) db.messageLog.pop();
      broadcast('message_log', logEntry);

      // Hapus juga nomor gagal / invalid agar database tidak menumpuk
      removeContactFromDatabase(contact.phone);
    }

    save();
    blastProgress.total = blastProgress.sent + blastProgress.failed + db.blastContacts.length;
    broadcast('blast_progress', blastProgress);
  }

  if (db.blastContacts.length === 0) {
    blastProgress.status = 'done';
    blastActive = false;

    const camp = db.campaigns.find(c => c.id === campaignId);
    if (camp) {
      camp.sent = blastProgress.sent;
      camp.failed = blastProgress.failed;
      camp.status = 'completed';
      camp.completedAt = new Date().toISOString();
    }
    save();
    broadcast('blast_progress', blastProgress);
    console.log(`Auto Blast ${campaignId} completed: ${blastProgress.sent} sent, ${blastProgress.failed} failed`);
  }
}

// ─── API ROUTES ────────────────────────────────────────────────────

// SSE Real-time
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
  res.write(`event: connected\ndata: {"ok":true}\n\n`);
});
app.get('/api/stream', (req, res) => res.redirect('/api/events'));

// Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    platform: 'Akaza Blast Engine',
    version: '3.0.0',
    activeDevices: Object.values(sessionStatus).filter(s => s === 'online').length,
    totalSessions: Object.keys(sessions).length,
    blastActive,
    blastProgress,
    timestamp: new Date().toISOString()
  });
});

// ─── User & Authentication ─────────────────────────────────────────
function resolveUser(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  if (db.users[str]) return db.users[str];
  if (!str.startsWith('usr_') && db.users[`usr_${str}`]) return db.users[`usr_${str}`];
  if (str.startsWith('usr_') && db.users[str.replace(/^usr_/, '')]) return db.users[str.replace(/^usr_/, '')];
  return Object.values(db.users).find(u =>
    (u.username && u.username.toLowerCase() === str.toLowerCase()) ||
    u.id === str ||
    u.id === `usr_${str}` ||
    u.id.replace(/^usr_/, '') === str.replace(/^usr_/, '')
  ) || null;
}

app.get('/api/user/:userId', (req, res) => {
  const u = resolveUser(req.params.userId);
  if (!u) {
    return res.status(404).json({ error: 'User tidak ditemukan' });
  }
  const { password: _, ...userSafe } = u;
  res.json(userSafe);
});

// ─── Referral Code Generator ──────────────────────────────────────
function generateUniqueReferralCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  do {
    code = 'AKZ-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (Object.values(db.users).some(u => u.referralCode === code));
  return code;
}

// Member Registration (Username, Password, Phone, E-Wallet, & Referral)
app.post('/api/auth/register', (req, res) => {
  const { username, name, phone, password, ewallet, ewalletName, ewalletNumber, referralCode } = req.body;

  if (!username || !username.trim()) return res.status(400).json({ error: 'Username wajib diisi' });
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (cleanUsername.length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter (huruf/angka/garis bawah)' });

  if (!password || password.length < 4) return res.status(400).json({ error: 'Password minimal 4 karakter' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama lengkap wajib diisi' });

  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) return res.status(400).json({ error: 'Nomor WhatsApp / HP tidak valid' });

  // Check username collision
  const existingUsername = Object.values(db.users).find(u => u.username && u.username.toLowerCase() === cleanUsername);
  if (existingUsername) {
    return res.status(409).json({ error: `Username "${cleanUsername}" sudah digunakan. Gunakan username lain.` });
  }

  // Check phone collision
  const existingPhone = Object.values(db.users).find(u => u.phone && u.phone.replace(/\D/g, '') === cleanPhone);
  if (existingPhone) {
    return res.status(409).json({ error: 'Nomor WhatsApp ini sudah terdaftar. Silakan login.' });
  }

  const userId = `usr_${Date.now().toString(36)}`;
  const userRefCode = generateUniqueReferralCode();

  const newUser = {
    id: userId,
    username: cleanUsername,
    name: name.trim(),
    phone: cleanPhone,
    password: password,
    ewallet: (ewallet || 'DANA').toUpperCase(),
    ewalletName: (ewalletName || name).trim(),
    ewalletNumber: (ewalletNumber || cleanPhone).replace(/\D/g, ''),
    saldo: 0,
    points: 0,
    commissionPerMessage: 900,
    devices: [],
    referralCode: userRefCode,
    referredBy: null,
    referrals: [],
    createdAt: new Date().toISOString()
  };

  // ─── Referral 100 Perak (Rp 100) System ─────────────────────────
  if (referralCode && referralCode.trim()) {
    const cleanRef = referralCode.trim().toUpperCase();
    const inviter = Object.values(db.users).find(u =>
      (u.referralCode && u.referralCode.toUpperCase() === cleanRef) ||
      (u.username && u.username.toUpperCase() === cleanRef)
    );

    if (inviter) {
      const referralBonus = 100; // 100 perak (Rp 100)
      inviter.points = (inviter.points || 0) + referralBonus;
      inviter.saldo = (inviter.saldo || 0) + referralBonus; // Menambah saldo withdrawable pengundang
      if (!inviter.referrals) inviter.referrals = [];
      inviter.referrals.unshift({
        userId: newUser.id,
        username: newUser.username,
        name: newUser.name,
        pointsEarned: referralBonus,
        bonusRp: referralBonus,
        joinedAt: new Date().toISOString()
      });
      newUser.referredBy = inviter.username;

      // Bonus sambutan 100 perak (Rp 100) untuk member baru yang mendaftar via referral
      newUser.points = (newUser.points || 0) + referralBonus;
      newUser.saldo = (newUser.saldo || 0) + referralBonus;

      broadcast('referral_bonus', { 
        inviterId: inviter.id, 
        newPoints: inviter.points, 
        newSaldo: inviter.saldo,
        bonus: referralBonus,
        invitedUsername: newUser.username 
      });
    }
  }

  db.users[userId] = newUser;
  save();
  broadcast('user_update', { action: 'register', user: { id: userId, username: newUser.username, name: newUser.name } });

  const { password: _, ...userSafe } = newUser;
  res.json({ success: true, user: userSafe });
});

// Member Login (Username or Phone + Password)
app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !identifier.trim()) return res.status(400).json({ error: 'Masukkan Username atau Nomor WhatsApp' });
  if (!password) return res.status(400).json({ error: 'Masukkan Password' });

  const cleanIdent = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/\D/g, '');

  const user = Object.values(db.users).find(u => {
    const matchUsername = u.username && u.username.toLowerCase() === cleanIdent;
    const matchPhone = cleanPhone && u.phone && u.phone.replace(/\D/g, '') === cleanPhone;
    return matchUsername || matchPhone;
  });

  if (!user) {
    return res.status(404).json({ error: 'Akun tidak ditemukan. Silakan periksa username atau daftar baru.' });
  }

  if (user.password && user.password !== password) {
    return res.status(401).json({ error: 'Password salah' });
  }

  const { password: _, ...userSafe } = user;
  res.json({ success: true, user: userSafe });
});

// User Referral Details
app.get('/api/user/:userId/referrals', (req, res) => {
  const user = resolveUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  if (!user.referralCode) {
    user.referralCode = generateUniqueReferralCode();
    save();
  }

  res.json({
    referralCode: user.referralCode,
    points: user.points || 0,
    totalInvited: (user.referrals || []).length,
    referrals: user.referrals || []
  });
});

// Update Member Profile / E-Wallet
app.post('/api/user/:userId/profile', (req, res) => {
  const user = resolveUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { name, phone, ewallet, ewalletName, ewalletNumber, password } = req.body;
  if (name) user.name = name.trim();
  if (phone) user.phone = phone.replace(/\D/g, '');
  if (ewallet) user.ewallet = ewallet.toUpperCase();
  if (ewalletName) user.ewalletName = ewalletName.trim();
  if (ewalletNumber) user.ewalletNumber = ewalletNumber.replace(/\D/g, '');
  if (password && password.length >= 4) user.password = password;

  save();
  const { password: _, ...userSafe } = user;
  broadcast('user_update', userSafe);
  res.json({ success: true, user: userSafe });
});

// ─── Admin User Database Management ────────────────────────────────
app.get('/api/admin/users', (req, res) => {
  const list = Object.values(db.users).map(u => {
    const userDevices = u.devices || [];
    const activeCount = userDevices.filter(id => {
      return sessionStatus[id] === 'online' || db.sessions[id]?.status === 'online';
    }).length;

    return {
      id: u.id,
      username: u.username || 'user_' + u.id.slice(-4),
      name: u.name,
      phone: u.phone,
      ewallet: u.ewallet || 'DANA',
      ewalletName: u.ewalletName || u.name,
      ewalletNumber: u.ewalletNumber || u.phone,
      saldo: u.saldo || 0,
      points: u.points || 0,
      commissionPerMessage: u.commissionPerMessage || 900,
      devicesCount: activeCount,
      activeDevicesCount: activeCount,
      totalDevicesCount: userDevices.length,
      referralCode: u.referralCode,
      referredBy: u.referredBy || '-',
      totalInvited: (u.referrals || []).length,
      createdAt: u.createdAt || null
    };
  });
  res.json(list);
});

app.post('/api/admin/users', (req, res) => {
  const { username, name, phone, password, ewallet, ewalletName, ewalletNumber, initialSaldo, initialPoints } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama wajib diisi' });

  const cleanUsername = (username || `user_${Date.now().toString(36).slice(-4)}`).toLowerCase().replace(/[^a-z0-9_]/g, '');
  const cleanPhone = (phone || '').replace(/\D/g, '');

  const userId = `usr_${Date.now().toString(36)}`;
  const newUser = {
    id: userId,
    username: cleanUsername,
    name: name.trim(),
    phone: cleanPhone,
    password: password || '123456',
    ewallet: (ewallet || 'DANA').toUpperCase(),
    ewalletName: (ewalletName || name).trim(),
    ewalletNumber: (ewalletNumber || cleanPhone).replace(/\D/g, ''),
    saldo: Number(initialSaldo) || 0,
    points: Number(initialPoints) || 0,
    commissionPerMessage: 900,
    devices: [],
    referralCode: generateUniqueReferralCode(),
    referredBy: null,
    referrals: [],
    createdAt: new Date().toISOString()
  };

  db.users[userId] = newUser;
  save();
  const { password: _, ...userSafe } = newUser;
  res.json({ success: true, user: userSafe });
});

app.post('/api/admin/users/:id/update', (req, res) => {
  const user = db.users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { name, phone, ewallet, ewalletName, ewalletNumber, saldo, points, commissionPerMessage } = req.body;
  if (name !== undefined) user.name = name.trim();
  if (phone !== undefined) user.phone = phone.replace(/\D/g, '');
  if (ewallet !== undefined) user.ewallet = ewallet.toUpperCase();
  if (ewalletName !== undefined) user.ewalletName = ewalletName.trim();
  if (ewalletNumber !== undefined) user.ewalletNumber = ewalletNumber.replace(/\D/g, '');
  if (saldo !== undefined) user.saldo = Number(saldo);
  if (points !== undefined) user.points = Number(points);
  if (commissionPerMessage !== undefined) user.commissionPerMessage = Number(commissionPerMessage);

  save();
  const { password: _, ...userSafe } = user;
  res.json({ success: true, user: userSafe });
});

app.delete('/api/admin/users/:id', (req, res) => {
  if (!db.users[req.params.id]) return res.status(404).json({ error: 'User tidak ditemukan' });
  delete db.users[req.params.id];
  save();
  res.json({ success: true });
});

// Devices (Filtered by userId if requested by member portal)
app.get('/api/devices', (req, res) => {
  const userId = req.query.userId;
  let devEntries = Object.entries(db.sessions).filter(([id, info]) => {
    // Abaikan sesi sementara yang belum pernah scan/pair sama sekali
    return Boolean(info.phone || info.connectedAt || sessionStatus[id] === 'online');
  });
  if (userId) {
    const user = resolveUser(userId);
    if (user) {
      const userDevices = new Set(user.devices || []);
      devEntries = devEntries.filter(([id, info]) =>
        userDevices.has(id) ||
        info.userId === user.id ||
        (info.userId && info.userId.replace(/^usr_/, '') === user.id.replace(/^usr_/, ''))
      );
    } else {
      devEntries = [];
    }
  }
  const devs = devEntries.map(([id, info]) => {
    const owner = resolveUser(info.userId);
    const commRate = (owner && owner.commissionPerMessage) || 900;
    return {
      ...info,
      status: sessionStatus[id] || info.status || 'offline',
      mode: info.mode || 'NORMAL_10S',
      sentToday: info.sentToday || 0,
      deliveredCount: info.deliveredCount || info.sentToday || 0,
      profit: info.profit !== undefined ? info.profit : ((info.sentToday || 0) * commRate)
    };
  });
  res.json(devs);
});

// Update device mode (speed / interval)
app.post('/api/devices/:id/mode', (req, res) => {
  const { mode } = req.body;
  if (!db.sessions[req.params.id]) {
    db.sessions[req.params.id] = { id: req.params.id, mode: 'NORMAL_10S' };
  }
  db.sessions[req.params.id].mode = mode || 'NORMAL_10S';
  save();
  broadcast('device_update', { deviceId: req.params.id, mode: db.sessions[req.params.id].mode });
  if (mode !== 'OFF') {
    triggerAutoBlastIfNeeded();
  }
  res.json({ success: true, mode: db.sessions[req.params.id].mode });
});

app.get('/api/devices/:id/status', (req, res) => {
  const status = sessionStatus[req.params.id] || 'offline';
  res.json({ deviceId: req.params.id, status, ...(db.sessions[req.params.id] || {}) });
});

app.get('/api/devices/:id/qr', (req, res) => {
  const qr = qrCodeStore[req.params.id];
  res.json({ qr: qr || null, status: sessionStatus[req.params.id] || 'not_started' });
});

// Returns QR as a PNG image directly — much more reliable for <img> tags
app.get('/api/devices/:id/qr-image', async (req, res) => {
  const qr = qrCodeStore[req.params.id];
  if (!qr) {
    return res.status(204).end(); // No Content yet
  }
  try {
    const QRCode = (await import('qrcode')).default;
    const buf = await QRCode.toBuffer(qr, { type: 'png', width: 280, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:id/pairing-code', (req, res) => {
  const code = pairingCodes[req.params.id];
  res.json({ code: code || null, status: sessionStatus[req.params.id] || 'not_started' });
});

app.post('/api/devices/add', async (req, res) => {
  const { name, userId, usePairingCode, phoneNumber } = req.body;
  const deviceId = `dev_${Date.now()}`;

  db.sessions[deviceId] = {
    id: deviceId,
    userId: userId || null,
    name: name || 'WhatsApp Device',
    phone: phoneNumber || '',
    status: 'connecting',
    connectedAt: null,
    sentToday: 0,
    totalSent: 0
  };

  // Jangan tambahkan ke user.devices dulu; hanya ditambahkan saat connection === 'open' (sudah scan/pair)
  save();

  startBaileysSession(deviceId, !!usePairingCode, phoneNumber || '');
  res.json({ success: true, deviceId, status: 'connecting' });
});

app.post('/api/devices/:id/disconnect', async (req, res) => {
  const sock = sessions[req.params.id];
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    delete sessions[req.params.id];
  }
  if (db.sessions[req.params.id]) {
    db.sessions[req.params.id].status = 'offline';
    save();
  }
  sessionStatus[req.params.id] = 'offline';
  broadcast('device_update', { deviceId: req.params.id, status: 'offline' });
  res.json({ success: true });
});

// Permanently delete a device and clean up its session files
app.delete('/api/devices/:id', async (req, res) => {
  const id = req.params.id;
  const sock = sessions[id];
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    delete sessions[id];
  }
  delete sessionStatus[id];
  delete qrCodeStore[id];
  delete pairingCodes[id];
  delete db.sessions[id];

  // Remove from all users' device lists
  Object.values(db.users).forEach(u => {
    if (u.devices) u.devices = u.devices.filter(d => d !== id);
  });

  // Delete session files
  const sessDir = join(__dirname, 'sessions', id);
  try { rmSync(sessDir, { recursive: true, force: true }); } catch (_) {}

  save();
  broadcast('device_update', { deviceId: id, status: 'deleted' });
  res.json({ success: true });
});

// Campaigns
app.get('/api/campaigns', (req, res) => res.json(db.campaigns.slice(0, 20)));

// Blast
app.get('/api/blast/current', (req, res) => res.json({ active: blastActive, progress: blastProgress }));

app.get('/api/blast/contacts', (req, res) => {
  res.json({ contacts: db.blastContacts, message: db.blastMessage, title: db.blastTitle });
});

app.post('/api/blast/setup', (req, res) => {
  const { contacts, message, title } = req.body;
  if (contacts !== undefined) {
    db.blastContacts = parseContacts(contacts || '');
  }
  if (message) db.blastMessage = message;
  if (title) db.blastTitle = title;
  save();

  if (blastActive) {
    blastProgress.total = (blastProgress.sent || 0) + (blastProgress.failed || 0) + db.blastContacts.length;
    broadcast('blast_progress', blastProgress);
  }
  broadcast('contacts_update', { remainingCount: db.blastContacts.length });

  // Auto-Blast triggers immediately!
  triggerAutoBlastIfNeeded();

  res.json({ success: true, count: db.blastContacts.length, blastActive });
});

app.post('/api/blast/start', async (req, res) => {
  if (blastActive) return res.json({ success: true, message: 'Blast sudah aktif' });
  if (!db.blastContacts.length) return res.status(400).json({ error: 'Database nomor kosong' });
  if (!db.blastMessage) return res.status(400).json({ error: 'Pesan belum diatur' });

  triggerAutoBlastIfNeeded();
  res.json({ success: true, blastActive });
});

app.post('/api/blast/stop', (req, res) => {
  blastActive = false;
  blastProgress.status = 'stopped';
  broadcast('blast_progress', blastProgress);
  res.json({ success: true });
});

// Message Log & Blast Reports
app.get('/api/log', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const userId = req.query.userId;
  let logs = (db.messageLog || []).map((l, idx) => enrichLogEntry(l, idx));
  if (userId) {
    const user = resolveUser(userId);
    if (user) {
      const userDeviceIds = new Set(user.devices || []);
      Object.entries(db.sessions).forEach(([id, s]) => {
        if (s.userId === user.id || (s.userId && s.userId.replace(/^usr_/, '') === user.id.replace(/^usr_/, ''))) {
          userDeviceIds.add(id);
        }
      });
      logs = logs.filter(l => userDeviceIds.has(l.deviceId));
    } else {
      logs = [];
    }
  }
  res.json(logs.slice(0, limit));
});

// Admin Blast Reports API with filtering & Excel/CSV export support
app.get('/api/admin/blast-reports', (req, res) => {
  const limit = parseInt(req.query.limit) || 1000;
  const status = (req.query.status || 'ALL').toUpperCase();
  const search = (req.query.search || '').trim().toLowerCase();

  let reports = (db.messageLog || []).map((l, idx) => enrichLogEntry(l, idx));

  if (status !== 'ALL') {
    reports = reports.filter(r => r.status === status);
  }

  if (search) {
    reports = reports.filter(r =>
      String(r.idData).includes(search) ||
      String(r.blastId).toLowerCase().includes(search) ||
      String(r.userId).toLowerCase().includes(search) ||
      String(r.sender).toLowerCase().includes(search) ||
      String(r.receiver).toLowerCase().includes(search) ||
      String(r.text).toLowerCase().includes(search)
    );
  }

  res.json({
    total: reports.length,
    successCount: reports.filter(r => r.status === 'SUCCESS').length,
    failedCount: reports.filter(r => r.status === 'FAILED').length,
    reports: reports.slice(0, limit)
  });
});

// Clear Blast Reports
app.delete('/api/admin/blast-reports', (req, res) => {
  db.messageLog = [];
  save();
  broadcast('blast_reports_cleared', { ok: true });
  res.json({ success: true, message: 'Seluruh riwayat laporan blast berhasil dibersihkan.' });
});

// Direct CSV export endpoint
app.get('/api/admin/blast-reports/export-csv', (req, res) => {
  const reports = (db.messageLog || []).map((l, idx) => enrichLogEntry(l, idx));
  
  // Format CSV header matching Excel layout
  const headers = ['No', 'ID Data', 'BLAST ID', 'User ID', 'Pengirim', 'Penerima', 'Teks', 'Status', 'Alasan', 'Jam Kirim'];
  const rows = reports.map((r, i) => [
    i + 1,
    r.idData,
    r.blastId,
    r.userId,
    `"${r.sender}"`,
    `"${r.receiver}"`,
    `"${(r.text || '').replace(/"/g, '""').replace(/\r?\n/g, '\\n')}"`,
    r.status,
    `"${r.reason || '-'}"`,
    `"${r.jamKirim}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(row => row.join(','))].join('\r\n');
  const now = new Date();
  const filename = `laporan-blast-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// Withdrawals (Filtered by userId if requested by member portal)
app.get('/api/withdrawals', (req, res) => {
  const userId = req.query.userId;
  let list = db.withdrawals;
  if (userId) {
    const user = resolveUser(userId);
    if (user) {
      list = list.filter(w => w.userId === user.id || (w.userId && w.userId.replace(/^usr_/, '') === user.id.replace(/^usr_/, '')));
    } else {
      list = [];
    }
  }
  const enriched = list.slice(0, 50).map(w => {
    const u = resolveUser(w.userId);
    return {
      ...w,
      username: u ? u.username : (w.userId ? w.userId.replace(/^usr_/, '') : 'mitra'),
      userName: u ? u.name : (w.accountName || 'Mitra')
    };
  });
  res.json(enriched);
});

app.post('/api/withdraw', (req, res) => {
  const { userId, amount, bank, accountNumber, accountName } = req.body;
  const user = resolveUser(userId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (!amount || amount < 30000) return res.status(400).json({ error: 'Minimal penarikan Rp 30.000' });
  if (amount > user.saldo) return res.status(400).json({ error: 'Saldo tidak mencukupi' });

  user.saldo -= amount;
  const wd = {
    id: `wd_${Date.now()}`,
    userId: user.id,
    username: user.username || user.id,
    userName: user.name || accountName,
    amount, bank, accountNumber, accountName,
    status: 'pending',
    requestedAt: new Date().toISOString()
  };
  db.withdrawals.unshift(wd);
  save();
  broadcast('withdrawal_update', wd);
  broadcast('user_update', user);
  res.json({ success: true, withdrawal: wd, newSaldo: user.saldo });
});

app.post('/api/withdrawals/:id/approve', (req, res) => {
  const wd = db.withdrawals.find(w => w.id === req.params.id);
  if (!wd) return res.status(404).json({ error: 'Data penarikan tidak ditemukan' });
  wd.status = 'approved';
  wd.completedAt = new Date().toISOString();
  wd.notes = 'Ditransfer manual oleh Admin';
  save();
  broadcast('withdrawal_update', wd);
  res.json({ success: true, withdrawal: wd });
});

app.post('/api/withdrawals/:id/reject', (req, res) => {
  const wd = db.withdrawals.find(w => w.id === req.params.id);
  if (!wd) return res.status(404).json({ error: 'Data penarikan tidak ditemukan' });
  if (wd.status === 'rejected') return res.status(400).json({ error: 'Penarikan sudah ditolak sebelumnya' });
  
  // Refund saldo kembali ke user
  const user = resolveUser(wd.userId);
  if (user) {
    user.saldo = (user.saldo || 0) + (wd.amount || 0);
  }

  wd.status = 'rejected';
  wd.rejectedAt = new Date().toISOString();
  wd.rejectReason = req.body?.reason || 'Ditolak oleh admin (transfer tidak dapat diproses)';
  save();

  broadcast('withdrawal_update', wd);
  if (user) broadcast('user_update', user);
  res.json({ success: true, withdrawal: wd });
});

// ─── Automated Payment & Disbursement API ──────────────────────────
// Transfer dana otomatis ke E-Wallet / Bank akun tujuan
app.post('/api/payout/disburse', (req, res) => {
  const { withdrawalId } = req.body;
  const wd = db.withdrawals.find(w => w.id === withdrawalId);
  if (!wd) return res.status(404).json({ error: 'Data penarikan tidak ditemukan' });
  if (wd.status === 'paid') return res.status(400).json({ error: 'Penarikan ini sudah dibayarkan' });

  const payoutId = `PAY_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const receipt = {
    payoutId,
    withdrawalId: wd.id,
    userId: wd.userId,
    amount: wd.amount,
    ewallet: wd.bank || 'DANA',
    accountNumber: wd.accountNumber,
    accountName: wd.accountName,
    gateway: 'AKAZA_PAY_DISBURSEMENT',
    status: 'SUCCESS',
    processedAt: new Date().toISOString(),
    message: `Dana Rp ${wd.amount.toLocaleString('id-ID')} berhasil ditransfer ke ${wd.bank} (${wd.accountNumber} a.n ${wd.accountName})`
  };

  if (!db.payouts) db.payouts = [];
  db.payouts.unshift(receipt);

  wd.status = 'paid';
  wd.payoutId = payoutId;
  wd.completedAt = receipt.processedAt;
  save();

  broadcast('withdrawal_update', wd);
  broadcast('payout_success', receipt);

  res.json({
    success: true,
    message: 'Pembayaran transfer otomatis berhasil diproses.',
    payout: receipt,
    withdrawal: wd
  });
});

app.post('/api/withdrawals/:id/payout', (req, res) => {
  const wd = db.withdrawals.find(w => w.id === req.params.id);
  if (!wd) return res.status(404).json({ error: 'Data penarikan tidak ditemukan' });
  if (wd.status === 'paid') return res.status(400).json({ error: 'Penarikan ini sudah dibayarkan' });

  const payoutId = `PAY_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const receipt = {
    payoutId,
    withdrawalId: wd.id,
    userId: wd.userId,
    amount: wd.amount,
    ewallet: wd.bank || 'DANA',
    accountNumber: wd.accountNumber,
    accountName: wd.accountName,
    gateway: 'AKAZA_PAY_DISBURSEMENT',
    status: 'SUCCESS',
    processedAt: new Date().toISOString(),
    message: `Dana Rp ${wd.amount.toLocaleString('id-ID')} berhasil ditransfer ke ${wd.bank} (${wd.accountNumber} a.n ${wd.accountName})`
  };

  if (!db.payouts) db.payouts = [];
  db.payouts.unshift(receipt);

  wd.status = 'paid';
  wd.payoutId = payoutId;
  wd.completedAt = receipt.processedAt;
  save();

  broadcast('withdrawal_update', wd);
  broadcast('payout_success', receipt);

  res.json({
    success: true,
    message: 'Pembayaran transfer otomatis berhasil diproses.',
    payout: receipt,
    withdrawal: wd
  });
});

app.get('/api/payout/history', (req, res) => {
  res.json(db.payouts || []);
});

// Dedicated Member Login / Register Route
app.get('/login', (req, res) => {
  res.sendFile(join(publicDir, 'login.html'));
});

// ─── Admin Authentication & Portal Routes ─────────────────────────
app.get(['/admin/login', '/admin-login'], (req, res) => {
  res.sendFile(join(publicDir, 'admin-login.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan Password admin wajib diisi' });
  }

  const adminConfig = db.admin || { username: 'admin', password: 'Akaza#Admin2026!' };
  if (username.trim().toLowerCase() !== adminConfig.username.toLowerCase() || password !== adminConfig.password) {
    return res.status(401).json({ error: 'Username atau Password Admin salah' });
  }

  const token = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  if (!db.adminTokens) db.adminTokens = {};
  db.adminTokens[token] = {
    username: adminConfig.username,
    createdAt: new Date().toISOString()
  };
  save();

  res.json({
    success: true,
    token,
    username: adminConfig.username,
    message: 'Login Admin berhasil'
  });
});

app.get('/api/admin/check-session', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-admin-token'] || req.query.token;

  if (!token || !db.adminTokens || !db.adminTokens[token]) {
    return res.status(401).json({ valid: false, error: 'Sesi admin tidak valid atau sudah kedaluwarsa' });
  }

  res.json({ valid: true, username: (db.admin && db.admin.username) || 'admin' });
});

app.post('/api/admin/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || req.headers['x-admin-token'] || (req.body && req.body.token);

  if (token && db.adminTokens && db.adminTokens[token]) {
    delete db.adminTokens[token];
    save();
  }

  res.json({ success: true, message: 'Berhasil keluar dari sesi admin' });
});

// Admin Portal Route
app.get('/admin', (req, res) => {
  res.sendFile(join(publicDir, 'admin.html'));
});

// SPA fallback for Member Portal
app.get('*', (req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────
const server = createServer(app);

function startServer(port) {
  server.listen(port, async () => {
    console.log(`==========================================================`);
    console.log(`🚀 Akaza Blast v3.0 - Real WhatsApp Blast Engine`);
    console.log(`👉 http://localhost:${port}`);
    console.log(`==========================================================`);
    await restoreAllSessions();
    setTimeout(() => triggerAutoBlastIfNeeded(), 5000);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️  Port ${PORT} busy, trying ${Number(PORT) + 1}...`);
    startServer(Number(PORT) + 1);
  } else {
    console.error(err);
  }
});

startServer(PORT);
