/**
 * Spintax & Contact Processing Utility for WhatsApp Blast
 */

export const SpintaxEngine = {
  /**
   * Resolves Spintax string like "{Halo|Hai|Selamat Siang} {nama}, apa kabar?"
   * Supports nested spintax: "{Halo|Hai {kak|gan}}"
   */
  resolve(text) {
    if (!text) return '';
    const spintaxRegex = /\{([^{}]+)\}/g;
    
    let result = text;
    while (spintaxRegex.test(result)) {
      result = result.replace(spintaxRegex, (match, choices) => {
        const options = choices.split('|');
        const picked = options[Math.floor(Math.random() * options.length)];
        return picked.trim();
      });
    }
    return result;
  },

  /**
   * Replace contact variables like {nama}, {name}, {phone}, {var1}
   */
  interpolate(template, recipient = {}) {
    if (!template) return '';
    let message = template;
    
    const replacements = {
      nama: recipient.name || recipient.nama || 'Kakak',
      name: recipient.name || recipient.nama || 'Kakak',
      phone: recipient.phone || '',
      nomor: recipient.phone || '',
      var1: recipient.var1 || '',
      var2: recipient.var2 || '',
      ...recipient
    };

    for (const [key, value] of Object.entries(replacements)) {
      const reg = new RegExp(`\\{${key}\\}`, 'gi');
      message = message.replace(reg, value);
    }

    return this.resolve(message);
  },

  /**
   * Standardizes phone numbers to WhatsApp international format (e.g. 62812...)
   */
  cleanPhoneNumber(raw, defaultCc = '55') {
    if (!raw) return '';
    let cleaned = String(raw).replace(/[^0-9]/g, '');
    if (!cleaned) return '';
    let cc = defaultCc || '55';
    try {
      if (typeof window !== 'undefined') {
        cc = window._currentSettingsCountryCode ||
             document.getElementById('admin-country-code')?.value ||
             document.getElementById('country-code-select')?.value ||
             defaultCc || '55';
        if (cc === 'custom') {
          cc = document.getElementById('admin-country-code-custom')?.value?.replace(/\D/g, '') || defaultCc || '55';
        }
      }
    } catch (_) {}
    cc = String(cc).replace(/\D/g, '') || '55';

    if (cc && cc !== '62' && cleaned.startsWith('62' + cc)) {
      cleaned = cleaned.slice(2);
    }

    if (cleaned.startsWith('0')) {
      cleaned = cc + cleaned.slice(1);
    } else if (!cleaned.startsWith(cc)) {
      const hasKnownCc = ['62', '55', '44', '60', '65', '91', '81', '82', '84', '86', '7', '1', '351', '34', '54', '57', '52', '234', '27', '33', '49', '39', '966', '971'].some(k => cleaned.startsWith(k));
      if (!hasKnownCc && cleaned.length <= 10) {
        cleaned = cc + cleaned;
      }
    }
    return cleaned;
  },

  /**
   * Parse contact raw text or CSV rows
   * Accepts:
   * 08123456789, Budi
   * 62898765432, Siti, Var1
   */
  parseContacts(rawText) {
    if (!rawText) return [];
    const lines = rawText.split('\n');
    const contacts = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      // Split by comma, tab, or semicolon
      const parts = trimmed.split(/[,;\t]+/).map(p => p.trim());
      const rawPhone = parts[0];
      const name = parts[1] || `Kontak #${index + 1}`;
      const var1 = parts[2] || '';
      
      const phone = this.cleanPhoneNumber(rawPhone);
      if (phone.length >= 10 && phone.length <= 15) {
        contacts.push({
          id: `c_${Date.now()}_${index}`,
          phone,
          name,
          var1
        });
      }
    });

    return contacts;
  }
};
