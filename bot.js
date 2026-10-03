const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// === GANTI ID GRUP DI SINI SETELAH DAPAT DARI COMMAND /id ===
const TARGET_GROUP = ''; // contoh: '120363xxxxxxxxxx@g.us'

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Billy Bot', 'Chrome', '1.0.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        const qrPath = path.join(process.cwd(), 'qr.png');
        await QRCode.toFile(qrPath, qr, { width: 500, margin: 2 });
        console.log('\n📱 QR CODE TERSIMPAN DI: ' + qrPath + '\n');
      } catch (err) {
        console.error('❌ Gagal simpan QR:', err.message);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Koneksi terputus. Reconnect:', shouldReconnect);
      if (shouldReconnect) setTimeout(() => startBot(), 3000);
      else console.log('🚪 Logged out. Hapus auth_info lalu jalankan ulang.');
    } else if (connection === 'open') {
      console.log('✅ Bot WhatsApp tersambung!\n');
      try { if (fs.existsSync('qr.png')) fs.unlinkSync('qr.png'); } catch (e) {}
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const chatId = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;

    // === COMMAND /id — cek ID grup ===
    if (text.trim() === '/id') {
      await sock.sendMessage(chatId, {
        text: `🆔 *ID Chat*\n\`${chatId}\`\n\n📌 Tipe: ${chatId.endsWith('@g.us') ? 'Grup' : 'Pribadi'}\n\nCopy ID di atas, lalu paste ke \`TARGET_GROUP\` di bot.js`
      }, { quoted: msg });
      return;
    }

    // === COMMAND /setgroup — set grup tujuan otomatis ===
    if (text.trim().startsWith('/setgroup')) {
      // Hanya owner (nomor yang login) yang bisa set
      if (!msg.key.fromMe) {
        await sock.sendMessage(chatId, { text: '❌ Hanya owner bot yang bisa set grup!' }, { quoted: msg });
        return;
      }
      const targetId = text.trim().split(' ')[1];
      if (!targetId || !targetId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Format: /setgroup 120363xxxx@g.us' }, { quoted: msg });
        return;
      }
      fs.writeFileSync('target_group.txt', targetId);
      await sock.sendMessage(chatId, { text: `✅ Target grup diset: ${targetId}` }, { quoted: msg });
      return;
    }

    // === DETEKSI TOKEN BILLY-XXXX ===
    const tokenMatch = text.match(/BILLY-\d{4}/i);
    if (tokenMatch) {
      const token = tokenMatch[0].toUpperCase();

      try {
        const tokenData = db.get('SELECT * FROM tokens WHERE token = ?', [token]);
        if (!tokenData) {
          await sock.sendMessage(chatId, { text: '❌ Token tidak ditemukan!' }, { quoted: msg });
          return;
        }
        if (Date.now() > tokenData.expires_at) {
          await sock.sendMessage(chatId, { text: '⏰ Token expired!' }, { quoted: msg });
          return;
        }
        if (tokenData.status === 'sent') {
          await sock.sendMessage(chatId, { text: '✅ Token sudah pernah dipakai!' }, { quoted: msg });
          return;
        }

        await sock.sendMessage(chatId, { text: '⏳ Memproses...' }, { quoted: msg });

        const response = await axios.get(tokenData.file_url, { responseType: 'arraybuffer', timeout: 120000 });
        const buffer = Buffer.from(response.data);

        // Tentukan tujuan: grup dari file target_group.txt, atau grup tempat token dikirim
        let sendTo = chatId;
        try {
          if (fs.existsSync('target_group.txt')) {
            const savedTarget = fs.readFileSync('target_group.txt', 'utf8').trim();
            if (savedTarget.endsWith('@g.us')) sendTo = savedTarget;
          }
        } catch (e) {}

        const caption = `📸 File dari Billy Bot\n\n🎫 Token: ${token}\n👤 Dari: @${senderJid.split('@')[0]}`;

        if (tokenData.media_type === 'image') {
          await sock.sendMessage(sendTo, { 
            image: buffer, 
            caption: caption,
            mentions: [senderJid]
          }, { quoted: msg });
        } else if (tokenData.media_type === 'video') {
          await sock.sendMessage(sendTo, { 
            video: buffer, 
            caption: caption,
            mentions: [senderJid]
          }, { quoted: msg });
        }

        db.updateTokenStatus(token, 'sent');
        await sock.sendMessage(chatId, { text: `✅ Berhasil! File dikirim ke ${sendTo === chatId ? 'chat ini' : 'grup tujuan'}` }, { quoted: msg });
      } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ Gagal: ' + err.message }, { quoted: msg });
      }
    }
  });
}

(async () => {
  await db.initDB();
  startBot().catch(console.error);
})();
