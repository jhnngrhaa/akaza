# 🚀 Akaza Blast - Platform WhatsApp Blast & Passive Income Sharing

Platform web modern untuk pengiriman pesan WhatsApp massal otomatis (WhatsApp Blast) dengan rotasi multi-device, fitur personalisasi pesan Spintax anti-banned, dan sistem ekosistem bagi hasil komisi pasif.

---

## 🌟 Fitur Utama Platform

### 1. 📱 Portal User (Pemilik WhatsApp / Mitra Penghasil Komisi)
- **Koneksi Perangkat Fleksibel**:
  - **Scan QR Code**: Tautkan WhatsApp Web dengan pembaruan dinamis otomatis setiap 30 detik.
  - **Kode Pairing (Pairing Code)**: Tautkan perangkat hanya dengan nomor telepon (tanpa perlu scan kamera).
- **Komisi Per Pesan**:
  - Otomatis mendapatkan saldo komisi (**Rp 50 / pesan**) untuk setiap pesan siaran yang berhasil terkirim melalui perangkat.
- **Dompet Saldo & Penarikan Dana (Withdraw)**:
  - Tarik saldo ke akun penarikan (**DANA, SeaBank, GoPay**).
  - Riwayat mutasi saldo dan status transfer real-time.
- **Sistem Referral**:
  - Bagikan kode & link referral unik.
  - Dapatkan bonus komisi pasif tambahan (**Rp 10 / pesan**) dari setiap pesan yang didistribusikan oleh mitra downline.

### 2. 🚀 Portal Partner (Pengiklan / Pengirim WhatsApp Blast)
- **Editor Kampanye Siaran**:
  - Input target manual atau upload berkas kontak **CSV / TXT**.
  - **Spintax Engine**: Variasi kata otomatis seperti `{Halo|Hai|Selamat Siang} {nama}` untuk mencegah deteksi spam WhatsApp.
  - **Jeda Acak (Random Delay Anti-Banned)**: Slider jeda 2-10 detik antar pengiriman.
- **Live WhatsApp Phone Mockup**:
  - Pratinjau langsung bagaimana pesan akan tampil di layar HP penerima sebelum dikirim.
  - Tombol tes acak variasi Spintax.
- **Monitoring Siaran Real-Time**:
  - Progress bar interaktif (persentase, jumlah terkirim, gagal, total).
  - Terminal log visual warna-warni (hijau, biru, kuning, merah).
  - Kontrol Jeda (Pause), Lanjutkan (Resume), dan Batalkan (Cancel).
- **Manajemen Template Pesan**:
  - Simpan dan gunakan kembali pesan promosi, konfirmasi pesanan, dan tagihan.

### 3. 🏛️ Portal Administrator & Finance
- **Pusat Approval Penarikan Saldo**:
  - Verifikasi rekening dan setujui / tolak permintaan penarikan saldo mitra.
- **Monitoring Pool Device**:
  - Pantau kesehatan dan kesiapan seluruh nomor WhatsApp yang terhubung di platform.

---

## 🛠️ Cara Menjalankan Aplikasi

Aplikasi telah dilengkapi dengan runtime Node.js portabel yang sudah terkonfigurasi.

### Cara 1: Menggunakan File Batch (Paling Praktis)
Cukup klik ganda atau jalankan:
```powershell
.\start.bat
```

### Cara 2: Menjalankan Manual via Terminal
```powershell
.\.bin\node-v20.18.0-win-x64\node.exe server\server.js
```

Buka peramban (browser) dan akses:
👉 **`http://localhost:3000`**

---

## 📁 Struktur Direktori

```
blast/
├── .bin/                          # Runtime Node.js LTS portabel
├── public/                        # Frontend Web Application
│   ├── css/
│   │   └── style.css              # Sistem desain modern, dark mode, dan glassmorphism
│   ├── js/
│   │   ├── app.js                 # Controller utama antarmuka & navigasi
│   │   ├── spintax.js             # Parser spintax & contact formatter
│   │   └── whatsappEngine.js      # Simulator multi-device, antrean blast, & kalkulasi komisi
│   └── index.html                 # Halaman portal tunggal responsif
├── server/                        # Backend REST API
│   ├── package.json
│   ├── data.json                  # Database file persistence
│   └── server.js                  # Express backend & API handler
├── start.bat                      # Peluncur instan satu klik
└── README.md                      # Dokumentasi lengkap
```
