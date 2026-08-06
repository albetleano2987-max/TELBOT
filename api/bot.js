const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const stream = require('stream');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN || '');
const userSessions = {};

// ====== HELPER FUNCTIONS ======
const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE', isProcessing: false, recipients: [], senderName: '', subject: '', body: '', pdf: null, gasUrl: null };
  }
  return userSessions[userId];
};

const clearPrevMsg = async (ctx, session) => {
  if (session && session.lastMsgId) {
    try {
      await ctx.deleteMessage(session.lastMsgId);
    } catch (e) {}
  }
};

// Fungsi untuk membaca email dari file CSV/Excel
const extractEmailsFromFile = async (ctx, docId) => {
  try {
    const fileLink = await ctx.telegram.getFileLink(docId);
    const response = await axios({ method: 'get', url: fileLink.href, responseType: 'stream' });
    const fileName = ctx.message.document.file_name.toLowerCase();
    let emails = [];

    if (fileName.endsWith('.csv')) {
      // Baca CSV
      await new Promise((resolve, reject) => {
        response.data.pipe(csv())
          .on('data', (row) => {
            // Asumsi email ada di kolom pertama, atau kolom bernama 'email'
            const value = Object.values(row)[0];
            if (value && value.includes('@')) emails.push(value.trim());
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileName.endsWith('.xlsx')) {
      // Baca Excel
      const chunks = [];
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => chunks.push(chunk));
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
      const buffer = Buffer.concat(chunks);
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
      
      data.forEach(row => {
        if (row && row[0] && String(row[0]).includes('@')) {
          emails.push(String(row[0]).trim());
        }
      });
    }
    return [...new Set(emails)]; // Hapus duplikat
  } catch (err) {
    console.error("Gagal baca file:", err);
    return null;
  }
};

// ====== MAIN MENUS ======
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

// ====== START & ACTIONS ======
bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearPrevMsg(ctx, session);
  const sent = await ctx.reply(
    `⚡ MAILBLAST GEN-Z SYSTEM ⚡\n\n` +
    `Botblast pintar anti-spam dengan Safe Delay (10s-20s) untuk garansi tembus INBOX UTAMA.\n\n` +
    `Silahkan pilih menu:`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  const sent = await ctx.reply('🔗 Tempelkan Link Web App Google Apps Script Kamu (/exec):', Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]));
  session.lastMsgId = sent.message_id;
});

// MEMULAI BLAST - Perubahan Teks Instruksi
bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();

  if (!session.gasUrl) {
    await clearPrevMsg(ctx, session);
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }

  session.step = 'AWAIT_RECIPIENTS_FILE'; // Step baru
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    '📧 <b>Masukkan Daftar Email Target (Max 500)</b>\n\n' +
    'Silahkan <b>UPLOAD FILE CSV atau EXCEL</b> (.xlsx) berisi daftar email.\n\n' +
    '<i>Asumsi: Email berada di kolom pertama.</i>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]) }
  );
  session.lastMsgId = sent.message_id;
});

// Handler Files (PDF Lampiran & CSV/Excel Target)
bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  const doc = ctx.message.document;
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  if (session.step === 'AWAIT_RECIPIENTS_FILE') {
    // Proses File Target Email
    if (!doc.file_name.endsWith('.csv') && !doc.file_name.endsWith('.xlsx')) {
      const sent = await ctx.reply('❌ File harus .csv atau .xlsx! Upload ulang:');
      session.lastMsgId = sent.message_id;
      return;
    }
    
    await clearPrevMsg(ctx, session);
    ctx.reply('⏳ Sedang membaca file email...');
    const emails = await extractEmailsFromFile(ctx, doc.file_id);
    if (!emails || emails.length === 0) return ctx.reply('❌ Gagal membaca email dari file atau file kosong.', mainMenu);
    if (emails.length > 500) return ctx.reply(`❌ Gagal: Maksimal total email adalah 500. File kamu berisi ${emails.length} email.`, mainMenu);

    session.recipients = emails;
    session.step = 'AWAIT_SENDER_NAME';
    await clearPrevMsg(ctx, session);
    ctx.reply(`✅ Berhasil membaca ${emails.length} email target.\n\n👤 Masukkan Nama Pengirim (Sender Name):`);
  
  } else if (session.step === 'AWAIT_PDF') {
    // Proses PDF Lampiran (Seperti biasa)
    if (doc.mime_type !== 'application/pdf') return ctx.reply('❌ Harus PDF!');
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      session.pdf = { url: fileLink.href, name: doc.file_name };
      session.step = 'CONFIRMATION';
      showConfirmation(ctx, session);
    } catch (err) { ctx.reply(`🚨 PDF Error: ${err.message}`); }
  }
});

// Handler Text Input (Sender Name, Subject, Body)
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;
  if (text.startsWith('/')) return; // Ignore commands
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      if (!text.startsWith('https://script.google.com/')) return ctx.reply('❌ URL Salah!');
      session.gasUrl = text; session.step = 'IDLE';
      ctx.reply('✅ GAS URL Disimpan!', mainMenu);
      break;
    case 'AWAIT_SENDER_NAME':
      session.senderName = text; session.step = 'AWAIT_SUBJECT';
      ctx.reply('📝 Masukkan Subject Email:\n💡 Gunakan {Hi|Halo} Spintax');
      break;
    case 'AWAIT_SUBJECT':
      session.subject = text; session.step = 'AWAIT_BODY';
      ctx.reply('💬 Masukkan Isi Pesan:\n💡 Gunakan {Pagi|Siang} Spintax');
      break;
    case 'AWAIT_BODY':
      session.body = text; session.step = 'AWAIT_PDF';
      ctx.reply('📎 Upload File PDF Lampiran (Max 10MB) atau klik SKIP:', Markup.inlineKeyboard([[Markup.button.callback('⏭️ SKIP LAMPIRAN', 'skip_pdf')], [Markup.button.callback('❌ BATALKAN', 'cancel')]]));
      break;
  }
});

bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.isProcessing) return ctx.answerCbQuery('⚠️ Sedang berjalan...');
  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  try {
    const payload = { chatId: ctx.from.id, botToken: BOT_TOKEN, recipients: session.recipients, senderName: session.senderName, subject: session.subject, body: session.body, pdfUrl: session.pdf ? session.pdf.url : null, pdfName: session.pdf ? session.pdf.name : null };
    await axios.post(session.gasUrl, payload, { timeout: 0 }); // Asinkron
    ctx.reply(`✅ Diterima! GAS akan memproses antrean email secara bertahap.\nLaporan akhir dikirim otomatis ke sini.`, mainMenu);
  } catch (err) { ctx.reply(`🚨 GAS Error: ${err.message}`); }
  finally { session.isProcessing = false; session.step = 'IDLE'; }
});

// Common Actions
bot.action('skip_pdf', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null; session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  showConfirmation(ctx, session);
});

bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  ctx.reply(`📊 Sesi:\nGAS URL: ${session.gasUrl ? '✅' : '❌'}\nRecipients: ${session.recipients.length}\nPDF: ${session.pdf ? session.pdf.name : '❌'}`, mainMenu);
});

bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false, recipients: [], senderName: '', subject: '', body: '', pdf: null, gasUrl: session.gasUrl };
  ctx.answerCbQuery('Sesi Di-reset!');
  ctx.reply('🧹 Sesi (selain GAS URL) dibersihkan.', mainMenu);
});

bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  ctx.reply('❌ Proses dibatalkan.', mainMenu);
});

async function showConfirmation(ctx, session) {
  await ctx.reply(
    `🔥 KONFIRMASI PENGIRIMAN EMAIL MASSAL 🔥\n\n` +
    `🎯 Target: ${session.recipients.length} Email (Dari File)\n` +
    `👤 Pengirim: ${session.senderName}\n` +
    `📌 Subject: ${session.subject}\n` +
    `📎 Lampiran: ${session.pdf ? session.pdf.name : '❌'}\n\n` +
    `💡 Mode Safe Delay & Anti-Spam Aktif.`,
    Markup.inlineKeyboard([[Markup.button.callback('🚀 KIRIM SEKARANG!', 'execute_blast')], [Markup.button.callback('❌ BATALKAN', 'cancel')]])
  );
}

module.exports = async (req, res) => {
  try { if (req.method === 'POST') { if (req.body) await bot.handleUpdate(req.body); res.status(200).send('OK'); } else res.status(200).send('Active!'); }
  catch (err) { res.status(200).send('Error'); }
};
