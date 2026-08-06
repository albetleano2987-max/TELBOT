const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const stream = require('stream');

// Ambil Token dari Environment Variable Vercel
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN || '');

// Memori sementara untuk menyimpan sesi user (hilang jika serverless sleep)
const userSessions = {};

// ====== HELPER FUNCTIONS ======

// Mengambil atau membuat sesi baru untuk user
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
      gasUrl: null 
    };
  }
  return userSessions[userId];
};

// Menghapus pesan sebelumnya agar chat bersih
const clearPrevMsg = async (ctx, session) => {
  if (session && session.lastMsgId) {
    try {
      await ctx.deleteMessage(session.lastMsgId);
    } catch (e) {
      // Abaikan jika pesan sudah dihapus user atau terlalu lama
    }
  }
};

// Fungsi canggih untuk membaca email dari file CSV atau Excel (.xlsx)
const extractEmailsFromFile = async (ctx, docId) => {
  try {
    const fileLink = await ctx.telegram.getFileLink(docId);
    const response = await axios({ method: 'get', url: fileLink.href, responseType: 'stream' });
    const fileName = ctx.message.document.file_name.toLowerCase();
    let emails = [];

    if (fileName.endsWith('.csv')) {
      // --- Proses Baca File CSV ---
      await new Promise((resolve, reject) => {
        response.data.pipe(csv())
          .on('data', (row) => {
            // Asumsi email ada di kolom pertama, atau kolom bernama 'email'
            const value = Object.values(row)[0];
            if (value && value.includes('@')) {
              emails.push(value.trim());
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileName.endsWith('.xlsx')) {
      // --- Proses Baca File Excel (.xlsx) ---
      const chunks = [];
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => chunks.push(chunk));
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
      const buffer = Buffer.concat(chunks);
      
      // Menggunakan SheetJS untuk baca buffer Excel
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0]; // Baca sheet pertama
      const sheet = workbook.Sheets[sheetName];
      // Ubah sheet jadi array 2D
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      
      data.forEach(row => {
        // Asumsi email ada di kolom pertama (index 0)
        if (row && row[0] && String(row[0]).includes('@')) {
          emails.push(String(row[0]).trim());
        }
      });
    }
    
    // Hapus email duplikat
    return [...new Set(emails)];

  } catch (err) {
    console.error("🚨 Gagal membaca file:", err);
    return null;
  }
};

// ====== DEFINISI MENU KEYBOARD ======

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

// ====== HANDLER COMMANDS & ACTIONS ======

// Command /start
bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearPrevMsg(ctx, session);
  
  const sent = await ctx.reply(
    `⚡ <b>MAILBLAST GEN-Z SYSTEM</b> ⚡\n\n` +
    `Bot blast pintar anti-spam dengan Safe Delay (10s-20s) dan support antrean bertahap hingga 1000 email.\n\n` +
    `Silahkan pilih menu di bawah ini:`,
    { parse_mode: 'HTML', ...mainMenu }
  );
  session.lastMsgId = sent.message_id;
});

// Setting URL GAS
bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  
  const sent = await ctx.reply(
    '🔗 <b>Tempelkan Link Web App GAS</b>\n\n' +
    'Masukkan URL Web App dari Google Apps Script kamu (yang berakhiran <code>/exec</code>):',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]) }
  );
  session.lastMsgId = sent.message_id;
});

// Memulai proses Blast
bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();

  if (!session.gasUrl) {
    await clearPrevMsg(ctx, session);
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set! Klik "⚙️ SETTING WEBHOOK GAS" terlebih dahulu.', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }

  session.step = 'AWAIT_RECIPIENTS_FILE'; // Step baru untuk nunggu file
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    '📧 <b>Masukkan Daftar Email Target (Max 1000)</b>\n\n' +
    'Silahkan <b>UPLOAD FILE CSV atau EXCEL</b> (.xlsx) berisi daftar email.\n\n' +
    '<i>💡 Bot akan otomatis menghapus email ganda. Asumsi email berada di kolom pertama.</i>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]) }
  );
  session.lastMsgId = sent.message_id;
});

// ====== HANDLER UNTUK INPUT FILE (PDF, CSV, XLSX) ======

bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  const doc = ctx.message.document;
  
  // Hapus pesan upload user agar bersih
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  if (session.step === 'AWAIT_RECIPIENTS_FILE') {
    // --- Step 1: User upload file target email (.csv/.xlsx) ---
    const fileName = doc.file_name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
      const sent = await ctx.reply('❌ Format file salah! Harus <b>.csv</b> atau <b>.xlsx</b> (Excel). Silahkan upload ulang:', { parse_mode: 'HTML' });
      session.lastMsgId = sent.message_id;
      return;
    }
    
    await clearPrevMsg(ctx, session);
    const statusMsg = await ctx.reply('⏳ Sedang membaca dan memproses file email...');
    
    // Ekstrak email menggunakan fungsi helper
    const emails = await extractEmailsFromFile(ctx, doc.file_id);
    
    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){} // Hapus pesan loading

    if (!emails || emails.length === 0) {
      return ctx.reply('❌ Gagal membaca email. Pastikan file tidak kosong dan email ada di kolom pertama.', mainMenu);
    }
    
    // REVISI LIMIT JADI 1000:
    if (emails.length > 1000) {
      return ctx.reply(`❌ Gagal: Maksimal total email adalah 1000. File kamu berisi ${emails.length} email.`, mainMenu);
    }

    session.recipients = emails; // Simpan daftar email
    session.step = 'AWAIT_SENDER_NAME';
    await clearPrevMsg(ctx, session);
    ctx.reply(`✅ Berhasil membaca <b>${emails.length} email</b> target dari file.\n\n👤 Masukkan Nama Pengirim (Sender Name):`, { parse_mode: 'HTML' });
  
  } else if (session.step === 'AWAIT_PDF') {
    // --- Step 5: User upload PDF lampiran (Like before) ---
    if (doc.mime_type !== 'application/pdf') {
      const sent = await ctx.reply('❌ File harus berformat PDF! Silahkan upload ulang:', Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]));
      session.lastMsgId = sent.message_id;
      return;
    }
    
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      session.pdf = { url: fileLink.href, name: doc.file_name };
      session.step = 'CONFIRMATION';
      await clearPrevMsg(ctx, session);
      showConfirmation(ctx, session);
    } catch (err) {
      ctx.reply(`🚨 Gagal mengambil file PDF: ${err.message}`, mainMenu);
    }
  }
});

// ====== HANDLER UNTUK INPUT TEKS ======

bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;
  
  if (text.startsWith('/')) return; // Abaikan command lain
  
  // Hapus pesan input user
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      if (!text.startsWith('https://script.google.com/')) {
        const sent = await ctx.reply('❌ URL Tidak Valid! Harus diawali dengan https://script.google.com/.');
        session.lastMsgId = sent.message_id;
        return;
      }
      session.gasUrl = text;
      session.step = 'IDLE';
      await clearPrevMsg(ctx, session);
      ctx.reply('✅ Endpoint Google Apps Script Berhasil Disimpan!', mainMenu);
      break;

    case 'AWAIT_SENDER_NAME':
      session.senderName = text;
      session.step = 'AWAIT_SUBJECT';
      await clearPrevMsg(ctx, session);
      ctx.reply('📝 Masukkan Subject Email:\n💡 Fitur Spintax: {Halo|Hi|Penting} Penawaran');
      break;

    case 'AWAIT_SUBJECT':
      session.subject = text;
      session.step = 'AWAIT_BODY';
      await clearPrevMsg(ctx, session);
      ctx.reply('💬 Masukkan Isi Pesan Email:\n💡 Fitur Spintax: {Selamat Pagi|Halo}, kami...');
      break;

    case 'AWAIT_BODY':
      session.body = text;
      session.step = 'AWAIT_PDF';
      await clearPrevMsg(ctx, session);
      ctx.reply('📎 Upload File PDF Lampiran (Max 10MB) atau klik Skip:', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ SKIP LAMPIRAN', 'skip_pdf')],
        [Markup.button.callback('❌ BATALKAN', 'cancel')]
      ]));
      break;
  }
});

// ====== FINALISASI & EKSEKUSI ======

// Tampilkan halaman konfirmasi akhir
async function showConfirmation(ctx, session) {
  const sent = await ctx.reply(
    `🔥 <b>KONFIRMASI PENGIRIMAN EMAIL MASSAL</b> 🔥\n\n` +
    `🎯 Target: <b>${session.recipients.length} Email</b> (Dari File)\n` +
    `👤 Pengirim: ${session.senderName}\n` +
    `📌 Subject: ${session.subject}\n` +
    `📎 Lampiran: ${session.pdf ? session.pdf.name : '❌ (Tanpa Lampiran)'}\n\n` +
    `💡 Bot menggunakan Safe Delay (10s-20s) dan otomatis mengirim bertahap sesuai kuota Gmail harian kamu.`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🚀 KIRIM SEKARANG!', 'execute_blast')],
        [Markup.button.callback('❌ BATALKAN', 'cancel')]
      ])
    }
  );
  session.lastMsgId = sent.message_id;
}

// Eksekusi Pemicu ke GAS (Instan Response Asinkron)
bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);

  if (session.isProcessing) {
    return ctx.answerCbQuery('⚠️ Pengiriman sedang berjalan! Mohon tunggu laporan selesai...', { show_alert: true });
  }

  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  try {
    // Siapkan data untuk dikirim ke GAS
    const payload = {
      chatId: ctx.from.id,
      botToken: BOT_TOKEN,
      recipients: session.recipients,
      senderName: session.senderName,
      subject: session.subject,
      body: session.body,
      pdfUrl: session.pdf ? session.pdf.url : null,
      pdfName: session.pdf ? session.pdf.name : null
    };

    // Kirim payload ke GAS dengan timeout 0 (Asinkron kilat)
    // GAS harus pakai kode doPost versi palsutimeout agar respon <1 detik
    const res = await axios.post(session.gasUrl, payload, { timeout: 0 });

    if (res.data && res.data.status !== 'success') {
      const sentErr = await ctx.reply(`🚨 GAS nolak antrean: ${res.data.message}`, mainMenu);
      session.lastMsgId = sentErr.message_id;
    } else {
      ctx.reply(`✅ <b>Diterima!</b> GAS akan memproses antrean ${session.recipients.length} email secara bertahap di background.\n\nLaporan akhir akan dikirim otomatis ke chat ini.`, { parse_mode: 'HTML', ...mainMenu });
    }

  } catch (err) {
    const sentErr = await ctx.reply(`🚨 Gagal terhubung ke GAS: ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  } finally {
    // Reset sesi agar bisa blast lagi
    session.isProcessing = false;
    session.step = 'IDLE';
  }
});

// ====== COMMON ACTIONS HANDLERS ======

bot.action('skip_pdf', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null;
  session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  await showConfirmation(ctx, session);
});

bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  
  const sent = await ctx.reply(
    `📊 <b>STATUS SESI SAAT INI:</b>\n\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Terhubung' : '❌ Belum Di-set'}\n` +
    `• Target: ${session.recipients.length} Email (Siap)\n` +
    `• Sender: ${session.senderName || '❌'}\n` +
    `• Subject: ${session.subject ? '✅' : '❌'}\n` +
    `• PDF: ${session.pdf ? '✅ ' + session.pdf.name : '❌'}`,
    { parse_mode: 'HTML', ...mainMenu }
  );
  session.lastMsgId = sent.message_id;
});

bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  // Simpan GAS URL, reset sisanya
  const gasUrlBack = session.gasUrl;
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false, recipients: [], senderName: '', subject: '', body: '', pdf: null, gasUrl: gasUrlBack };
  
  ctx.answerCbQuery('Sesi Di-reset!');
  await clearPrevMsg(ctx, session);
  const sent = await ctx.reply('🧹 Sesi (selain GAS URL) berhasil dibersihkan kembali.', mainMenu);
  userSessions[ctx.from.id].lastMsgId = sent.message_id;
});

bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  await clearPrevMsg(ctx, session);
  const sent = await ctx.reply('❌ Proses dibatalkan.', mainMenu);
  session.lastMsgId = sent.message_id;
});

// ====== VERCEL SERVERLESS HANDLER ======

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (req.body) {
        await bot.handleUpdate(req.body);
      }
      res.status(200).send('OK');
    } else {
      res.status(200).send('Telegram Emailer Bot is Active!');
    }
  } catch (err) {
    console.error('SERVERLESS ERROR:', err);
    res.status(200).send('Error Handled');
  }
};
