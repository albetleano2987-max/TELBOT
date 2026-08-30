const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const csv = require('csv-parser');
const xlsx = require('xlsx');

const BOT_TOKEN = process.env.BOT_TOKEN;
// Link GAS terbaru kamu yang sudah terhubung
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwjNy1kGa3ZbwkAvL5p_ZmDQY6WyKZrf5egStHCDcWNx0Dn6K6AJYdqOOp9bPFR3XNA/exec';

const bot = new Telegraf(BOT_TOKEN || '');
const userSessions = {};

const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { 
      step: 'IDLE', 
      isProcessing: false, 
      recipients: [], 
      senderName: '', 
      subject: '', 
      body: '', 
      pdf: null, 
      gasUrl: DEFAULT_GAS_URL, 
      lastMsgId: null 
    };
  }
  return userSessions[userId];
};

const clearBotMsg = async (ctx, session) => {
  if (session && session.lastMsgId) {
    try { await ctx.deleteMessage(session.lastMsgId); session.lastMsgId = null; } catch (e) {}
  }
};

const clearUserMsg = async (ctx) => {
  if (ctx.message) {
    try { await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}
  }
};

// Middleware Pengecekan Akses (Whitelist via GAS) dengan Bypass Admin Mutlak (ID: 7619665121)
const checkAccessMiddleware = async (ctx, next) => {
  const userId = ctx.from ? ctx.from.id : null;
  if (!userId) return;

  // BYPASS MUTLAK UNTUK ADMIN UTAMA
  if (String(userId) === "7619665121") {
    return next();
  }

  // Bypass untuk command callback ACC dari admin
  if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('acc_user_')) {
    return next();
  }

  const session = getSession(userId);

  if (!session.gasUrl) {
    await ctx.reply('⚠️ Bot belum dikonfigurasi oleh Admin.');
    return;
  }

  // Cek ke Google Apps Script apakah user ini sudah di-ACC
  try {
    const res = await axios.post(session.gasUrl, { action: 'check_access', telegramId: userId }, { timeout: 10000 });
    if (res.data && res.data.allowed) {
      return next(); 
    }
  } catch (e) {}

  // Jika belum di-ACC, tampilkan tombol Minta Akses
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply(
    '⛔ <b>AKSES DITOLAK</b>\n\nBot ini bersifat privat dan hanya bisa digunakan oleh user yang sudah di-ACC oleh Admin. Silakan klik tombol di bawah untuk meminta akses.',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('📩 Minta Akses ke Admin', `req_${userId}`)]])
    }
  );
  session.lastMsgId = sent.message_id;
};

const extractEmailsFromFile = async (ctx, docId) => {
  try {
    const fileLink = await ctx.telegram.getFileLink(docId);
    const response = await axios({ method: 'get', url: fileLink.href, responseType: 'stream' });
    const fileName = ctx.message.document.file_name.toLowerCase();
    let emails = [];

    if (fileName.endsWith('.csv')) {
      await new Promise((resolve, reject) => {
        response.data.pipe(csv())
          .on('data', (row) => { const val = Object.values(row)[0]; if (val && val.includes('@')) emails.push(val.trim()); })
          .on('end', resolve).on('error', reject);
      });
    } else if (fileName.endsWith('.xlsx')) {
      const chunks = [];
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => chunks.push(chunk));
        response.data.on('end', resolve).on('error', reject);
      });
      const buffer = Buffer.concat(chunks);
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      data.forEach(row => { if (row && row[0] && String(row[0]).includes('@')) emails.push(String(row[0]).trim()); });
    }
    return [...new Set(emails)];
  } catch (err) { return null; }
};

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 MULAI BLAST', 'start_blast'), Markup.button.callback('🛑 STOP BLAST', 'stop_blast')],
  [Markup.button.callback('📂 Download Script', 'get_gas_file'), Markup.button.callback('📖 Cara Pasang', 'tutorial_gas')],
  [Markup.button.callback('🔋 Cek Kuota Gmail', 'check_quota'), Markup.button.callback('⚙️ Setting Webhook', 'set_gas')],
  [Markup.button.callback('📊 Cek Sesi', 'view_session'), Markup.button.callback('🧹 Reset Data', 'reset_session')],
  [Markup.button.url('👤 Owner (@andiigndr29)', 'https://instagram.com/andiigndr29')]
]);

// Terapkan middleware keamanan
bot.use(checkAccessMiddleware);

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearUserMsg(ctx);
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('<b>Don\'t Spam Bot !</b>', { parse_mode: 'HTML', ...mainMenu });
  session.lastMsgId = sent.message_id;
});

// Request Akses oleh User (Menggunakan HTTP API langsung agar aman di Serverless Vercel)
bot.action(/^req_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const user = ctx.from;
  
  await ctx.answerCbQuery('Permintaan terkirim!').catch(() => {});

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: "7619665121",
      text: `🔔 <b>PERMINTAAN AKSES BARU</b>\n\n👤 Nama: ${user.first_name || '-'} ${user.last_name || ''}\n🔗 Username: @${user.username || 'Tidak ada'}\n🆔 ID: <code>${userId}</code>`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ ACC SEKARANG', callback_data: `acc_user_${userId}` }]
        ]
      }
    });
  } catch (err) {
    console.error("Gagal kirim via HTTP API:", err.message);
  }

  await ctx.editMessageText('⏳ Permintaan akses sudah dikirim ke Admin. Mohon tunggu persetujuan.', { parse_mode: 'HTML' }).catch(() => {});
});

// Admin ACC User
bot.action(/^acc_user_(.+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery('Memproses ACC...');

  if (!session.gasUrl) {
    return ctx.reply('⚠️ Webhook GAS belum diset.');
  }

  try {
    const res = await axios.post(session.gasUrl, { action: 'approve_user', telegramId: targetId }, { timeout: 10000 });
    if (res.data && res.data.status === 'success') {
      await ctx.editMessageText(`✅ <b>SUKSES!</b> User dengan ID <code>${targetId}</code> berhasil di-ACC dan kini bisa menggunakan bot.`, { parse_mode: 'HTML' });
      try {
        await ctx.telegram.sendMessage(targetId, '🎉 <b>Hore! Akses kamu telah disetujui oleh Admin.</b>\n\nSilakan ketik /start untuk mulai menggunakan bot.', { parse_mode: 'HTML' });
      } catch (e) {}
    } else {
      await ctx.reply('❌ Gagal meng-ACC user di server GAS.');
    }
  } catch (err) {
    await ctx.reply(`🚨 Error koneksi ke GAS: ${err.message}`);
  }
});

bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('🔗 <b>Tempelkan Link Web App GAS (/exec):</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]) });
  session.lastMsgId = sent.message_id;
});

bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  if (!session.gasUrl) {
    await clearBotMsg(ctx, session);
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }
  session.step = 'AWAIT_RECIPIENTS_FILE';
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('📧 <b>Upload File CSV / EXCEL (.xlsx) Isi Email Target (Max 1000):</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]) });
  session.lastMsgId = sent.message_id;
});

bot.action('stop_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  if (!session.gasUrl) {
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }
  await clearBotMsg(ctx, session);
  const loadingMsg = await ctx.reply('⏳ Mengirim sinyal stop ke GAS...');
  try {
    const response = await axios.post(session.gasUrl, { action: 'stop_blast', botToken: BOT_TOKEN, chatId: ctx.from.id }, { timeout: 15000 });
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    const sent = await ctx.reply(`🛑 <b>SINYAL STOP DIKIRIM</b>\n\n${response.data.message || 'Antrean berhasil dibatalkan.'}`, { parse_mode: 'HTML', ...mainMenu });
    session.lastMsgId = sent.message_id;
  } catch (err) {
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    const sent = await ctx.reply(`🚨 Gagal menghentikan blast: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  }
});

bot.action('check_quota', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  if (!session.gasUrl) {
    await clearBotMsg(ctx, session);
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }
  await clearBotMsg(ctx, session);
  const loadingMsg = await ctx.reply('⏳ Mengecek sisa kuota Gmail ke GAS...');
  try {
    const response = await axios.post(session.gasUrl, { action: 'check_quota', botToken: BOT_TOKEN, chatId: ctx.from.id }, { timeout: 15000 });
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    const sent = await ctx.reply(`🔋 <b>INFO KUOTA GMAIL</b>\n\nSisa kuota kirim hari ini: <b>${response.data.quota !== undefined ? response.data.quota : 'Tidak diketahui'} email</b>`, { parse_mode: 'HTML', ...mainMenu });
    session.lastMsgId = sent.message_id;
  } catch (err) {
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    const sent = await ctx.reply(`🚨 Gagal mengecek kuota: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  }
});

bot.action('get_gas_file', async (ctx) => {
  const session = getSession(ctx.from.id);
  try { await ctx.answerCbQuery('Mengirim file script GAS...'); } catch (e) {}
  await clearBotMsg(ctx, session);

  const fileBuffer = Buffer.from("Gunakan script Code.gs lengkap yang sudah disediakan.", 'utf-8');
  await ctx.replyWithDocument({ source: fileBuffer, filename: 'Code.gs' }, {
    caption: '📂 <b>FILE SCRIPT GAS DENGAN WHITELIST</b>',
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali ke Menu', 'back_to_menu')]])
  });
  session.lastMsgId = null;
});

bot.action('tutorial_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply(
    '📖 <b>CARA SETUP WEBHOOK GAS</b> 📖\n\n' +
    '1️⃣ Buka <u>script.google.com</u> lalu buat New Project.\n' +
    '2️⃣ Masukkan kode <b>Code.gs</b> terbaru.\n' +
    '3️⃣ Deploy sebagai Web app (Execute as: Me, Access: Anyone).\n' +
    '4️⃣ Salin URL Web app ke bot.', 
    {
      parse_mode: 'HTML', disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Kembali', 'back_to_menu')]])
    }
  );
  session.lastMsgId = sent.message_id;
});

bot.action('back_to_menu', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('<b>Don\'t Spam Bot !</b>', { parse_mode: 'HTML', ...mainMenu });
  session.lastMsgId = sent.message_id;
});

bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  const doc = ctx.message.document;
  await clearUserMsg(ctx);
  if (session.step === 'AWAIT_RECIPIENTS_FILE') {
    const fileName = doc.file_name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
      await clearBotMsg(ctx, session);
      const sent = await ctx.reply('❌ Format salah! Upload file .csv / .xlsx:', Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]));
      session.lastMsgId = sent.message_id;
      return;
    }
    await clearBotMsg(ctx, session);
    const loadingMsg = await ctx.reply('⏳ Membaca file email...');
    const emails = await extractEmailsFromFile(ctx, doc.file_id);
    try { await ctx.deleteMessage(loadingMsg.message_id); } catch(e){}
    if (!emails || emails.length === 0) {
      const sent = await ctx.reply('❌ File kosong atau gagal dibaca.', mainMenu);
      session.lastMsgId = sent.message_id;
      return;
    }
    if (emails.length > 1000) {
      const sent = await ctx.reply(`❌ Maksimal 1000 email. File berisi ${emails.length} email.`, mainMenu);
      session.lastMsgId = sent.message_id;
      return;
    }
    session.recipients = emails;
    session.step = 'AWAIT_SENDER_NAME';
    const sent = await ctx.reply(`✅ Berhasil membaca <b>${emails.length} email</b>.\n\n👤 Masukkan Nama Pengirim:`, { parse_mode: 'HTML' });
    session.lastMsgId = sent.message_id;
  } else if (session.step === 'AWAIT_PDF') {
    if (doc.mime_type !== 'application/pdf') {
      await clearBotMsg(ctx, session);
      const sent = await ctx.reply('❌ File harus PDF! Upload ulang:', Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]));
      session.lastMsgId = sent.message_id;
      return;
    }
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      session.pdf = { url: fileLink.href, name: doc.file_name };
      session.step = 'CONFIRMATION';
      await clearBotMsg(ctx, session);
      await showConfirmation(ctx, session);
    } catch (err) {
      const sent = await ctx.reply(`🚨 Gagal membaca PDF: ${err.message}`, mainMenu);
      session.lastMsgId = sent.message_id;
    }
  }
});

bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  await clearUserMsg(ctx);
  switch (session.step) {
    case 'AWAIT_GAS_URL':
      if (!text.startsWith('https://script.google.com/')) {
        await clearBotMsg(ctx, session);
        const sent = await ctx.reply('❌ URL tidak valid!');
        session.lastMsgId = sent.message_id;
        return;
      }
      session.gasUrl = text;
      session.step = 'IDLE';
      await clearBotMsg(ctx, session);
      const sentGas = await ctx.reply('✅ Webhook GAS Berhasil Disimpan!', mainMenu);
      session.lastMsgId = sentGas.message_id;
      break;
    case 'AWAIT_SENDER_NAME':
      session.senderName = text;
      session.step = 'AWAIT_SUBJECT';
      await clearBotMsg(ctx, session);
      const sentSub = await ctx.reply('📝 Masukkan Subject Email:');
      session.lastMsgId = sentSub.message_id;
      break;
    case 'AWAIT_SUBJECT':
      session.subject = text;
      session.step = 'AWAIT_BODY';
      await clearBotMsg(ctx, session);
      const sentBody = await ctx.reply('💬 Masukkan Isi Pesan Email:');
      session.lastMsgId = sentBody.message_id;
      break;
    case 'AWAIT_BODY':
      session.body = text;
      session.step = 'AWAIT_PDF';
      await clearBotMsg(ctx, session);
      const sentPdf = await ctx.reply('📎 Upload File PDF Lampiran atau klik Skip:', Markup.inlineKeyboard([[Markup.button.callback('⏭️ Skip Lampiran', 'skip_pdf')], [Markup.button.callback('❌ Batalkan', 'cancel')]]));
      session.lastMsgId = sentPdf.message_id;
      break;
  }
});

async function showConfirmation(ctx, session) {
  const sent = await ctx.reply(`🔥 <b>KONFIRMASI PENGIRIMAN EMAIL</b> 🔥\n\n🎯 Target: <b>${session.recipients.length} Email</b>\n👤 Pengirim: ${session.senderName}\n📌 Subject: ${session.subject}\n📎 Lampiran: ${session.pdf ? session.pdf.name : '❌'}`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('🚀 Kirim Sekarang!', 'execute_blast')], [Markup.button.callback('❌ Batalkan', 'cancel')]])
  });
  session.lastMsgId = sent.message_id;
}

bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.isProcessing) return ctx.answerCbQuery('⚠️ Sedang diproses...');
  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  try {
    const payload = { chatId: ctx.from.id, botToken: BOT_TOKEN, recipients: session.recipients, senderName: session.senderName, subject: session.subject, body: session.body, pdfUrl: session.pdf ? session.pdf.url : null, pdfName: session.pdf ? session.pdf.name : null };
    await axios.post(session.gasUrl, payload, { timeout: 0 });
    const sent = await ctx.reply('✅ <b>Antrean Diterima!</b>\n\nGAS akan mengirimkan email secara bertahap.', { parse_mode: 'HTML', ...mainMenu });
    session.lastMsgId = sent.message_id;
  } catch (err) {
    const sent = await ctx.reply(`🚨 Gagal: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  } finally {
    session.isProcessing = false;
    session.step = 'IDLE';
  }
});

bot.action('skip_pdf', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null;
  session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  await showConfirmation(ctx, session);
});

bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply(`📊 <b>STATUS SESI:</b>\n\n• GAS URL: ${session.gasUrl ? '✅ Terhubung' : '❌ Belum'}\n• Target: ${session.recipients.length} Email\n• Sender: ${session.senderName || '❌'}\n• Subject: ${session.subject ? '✅' : '❌'}\n• PDF: ${session.pdf ? '✅ ' + session.pdf.name : '❌'}`, { parse_mode: 'HTML', ...mainMenu });
  session.lastMsgId = sent.message_id;
});

bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  const gasUrlBack = session.gasUrl;
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false, recipients: [], senderName: '', subject: '', body: '', pdf: null, gasUrl: gasUrlBack, lastMsgId: null };
  ctx.answerCbQuery('Sesi Di-reset!');
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('🧹 Data sesi dibersihkan.', mainMenu);
  userSessions[ctx.from.id].lastMsgId = sent.message_id;
});

bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('❌ Proses dibatalkan.', mainMenu);
  session.lastMsgId = sent.message_id;
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (req.body) await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot Active!');
    }
  } catch (err) {
    res.status(200).send('Handled');
  }
};
