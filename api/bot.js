const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

// Ambil token dari Environment Variable Vercel
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("CRITICAL ERROR: BOT_TOKEN is missing in Vercel Environment Variables!");
}

const bot = new Telegraf(BOT_TOKEN || '');
const userSessions = {};

// Helper untuk mendapatkan atau membuat session user
const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE', isProcessing: false };
  }
  return userSessions[userId];
};

// Helper hapus pesan lama
const clearPrevMsg = async (ctx, session) => {
  if (session && session.lastMsgId) {
    try {
      await ctx.deleteMessage(session.lastMsgId);
    } catch (e) {
      // Abaikan jika pesan sudah terhapus
    }
  }
};

// Menu Utama (Menggunakan Font Tebal Standar yang 100% Aman)
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

// Command /start
bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearPrevMsg(ctx, session);

  const sent = await ctx.replyWithMarkdown(
    `✨ *YOO WHAT'S UP! WELCOME TO MAILBLAST GEN-Z* ⚡\n\n` +
    `Botblast anti-spam ter-kece yang siap bantu kirim 100 email harian via Google Apps Script.\n\n` +
    `Pilih menu di bawah buat mulai, fren:`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

// Setting GAS Webhook URL
bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🔗 *Drop Link Deployment Web App GAS Kamu:*', Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

// Mulai Alur Blast Email
bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();

  if (!session.gasUrl) {
    await clearPrevMsg(ctx, session);
    const sent = await ctx.reply('⚠️ *Eits! Webhook GAS belum di-set.* Klik "⚙️ SETTING WEBHOOK GAS" dulu ya!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }

  session.step = 'AWAIT_RECIPIENTS';
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('📧 *Masukkan target email (pisahkan dengan koma)*\n\n_Contoh: email1@gmail.com, email2@gmail.com_', Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

// Cek Status Sesi
bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.replyWithMarkdown(
    `🔍 *STATUS SESI KAMU:*\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Configured' : '❌ Kosong'}\n` +
    `• Target Mail: ${session.recipients ? session.recipients.length + ' Email' : '0'}\n` +
    `• Sender Name: ${session.senderName || '❌ Belum Di-set'}\n` +
    `• Subject: ${session.subject ? '✅ Ada' : '❌ Kosong'}\n` +
    `• Attachment: ${session.pdf ? '✅ PDF Attached' : '❌ Tanpa Lampiran'}`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

// Reset Sesi Data User
bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false };
  ctx.answerCbQuery('Sesi di-reset!');
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🧹 *Sesi kamu bersih lagi!* Monggo setting ulang.', mainMenu);
  userSessions[ctx.from.id].lastMsgId = sent.message_id;
});

// Batal Proses
bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('❌ *Proses dibatalkan.* Kembalikan ke menu utama:', mainMenu);
  session.lastMsgId = sent.message_id;
});

// Upload Document / PDF Handler
bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.step !== 'AWAIT_PDF') return;

  const doc = ctx.message.document;
  
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}
  await clearPrevMsg(ctx, session);

  if (doc.mime_type !== 'application/pdf') {
    const sent = await ctx.reply('❌ *File harus berupa PDF!* Upload ulang:', Markup.inlineKeyboard([
      [Markup.button.callback('❌ BATALKAN', 'cancel')]
    ]));
    session.lastMsgId = sent.message_id;
    return;
  }

  if (doc.file_size > 5 * 1024 * 1024) {
    const sent = await ctx.reply('❌ *File Kebesaran!* Maksimal ukuran PDF 5MB. Upload ulang:', Markup.inlineKeyboard([
      [Markup.button.callback('❌ BATALKAN', 'cancel')]
    ]));
    session.lastMsgId = sent.message_id;
    return;
  }

  const processingMsg = await ctx.reply('⏳ *Downloading & Processing PDF...*');
  
  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    
    session.pdf = {
      base64: Buffer.from(response.data).toString('base64'),
      name: doc.file_name
    };

    try { await ctx.deleteMessage(processingMsg.message_id); } catch(e){}
    session.step = 'CONFIRMATION';
    await showConfirmation(ctx, session);
  } catch (err) {
    try { await ctx.deleteMessage(processingMsg.message_id); } catch(e){}
    const sentErr = await ctx.reply(`🚨 *Gagal memproses file PDF:* ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  }
});

// Text Input Step-by-Step Wizard Router
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;

  // Hapus teks user agar chat room tetap rapi
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      await clearPrevMsg(ctx, session);
      if (!text.startsWith('https://script.google.com/')) {
        const sent = await ctx.reply('❌ *URL GAS Tidak Valid!* Harus diawali `https://script.google.com/`');
        session.lastMsgId = sent.message_id;
        return;
      }
      session.gasUrl = text;
      session.step = 'IDLE';
      const sentGas = await ctx.reply('✅ *GAS Endpoint Berhasil Disimpan!*', mainMenu);
      session.lastMsgId = sentGas.message_id;
      break;

    case 'AWAIT_RECIPIENTS':
      await clearPrevMsg(ctx, session);
      session.recipients = text.split(',').map(e => e.trim()).filter(e => e.length > 0);
      session.step = 'AWAIT_SENDER_NAME';
      const sentName = await ctx.reply('👤 *Masukkan Nama Pengirim (Sender Name):*\n\n_Contoh: HRD PT Makmur / Admin Support_');
      session.lastMsgId = sentName.message_id;
      break;

    case 'AWAIT_SENDER_NAME':
      await clearPrevMsg(ctx, session);
      session.senderName = text;
      session.step = 'AWAIT_SUBJECT';
      const sentSub = await ctx.reply('📝 *Masukkan Subject Email:*\n\n💡 *Tips Spintax:* `{Halo|Hi} Penawaran Spesial!`');
      session.lastMsgId = sentSub.message_id;
      break;

    case 'AWAIT_SUBJECT':
      await clearPrevMsg(ctx, session);
      session.subject = text;
      session.step = 'AWAIT_BODY';
      const sentBodyPrompt = await ctx.reply('💬 *Masukkan Isi Pesan Email:*\n\n💡 *Tips Spintax:* `{Selamat Pagi|Halo Kak}, kami dari...`');
      session.lastMsgId = sentBodyPrompt.message_id;
      break;

    case 'AWAIT_BODY':
      await clearPrevMsg(ctx, session);
      session.body = text;
      session.step = 'AWAIT_PDF';
      const sentPdfPrompt = await ctx.reply('📎 *Kirim File PDF Lampiran (Maks 5MB):*\n\n_Atau klik tombol skip jika tanpa lampiran._', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ SKIP LAMPIRAN', 'skip_pdf')],
        [Markup.button.callback('❌ BATALKAN', 'cancel')]
      ]));
      session.lastMsgId = sentPdfPrompt.message_id;
      break;
  }
});

// Skip Lampiran PDF
bot.action('skip_pdf', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null;
  session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  await showConfirmation(ctx, session);
});

// Tampilan Ringkasan & Konfirmasi
async function showConfirmation(ctx, session) {
  const estMinutes = Math.round((session.recipients.length * 45) / 60);
  const sent = await ctx.replyWithMarkdown(
    `🔥 *SIAP BLAST EMAIL? MOHON CEK DATA:* 🔥\n\n` +
    `🎯 *Jumlah Target:* ${session.recipients.length} Email\n` +
    `👤 *Nama Pengirim:* ${session.senderName}\n` +
    `📌 *Subject:* ${session.subject}\n` +
    `📎 *Lampiran:* ${session.pdf ? session.pdf.name : 'Tanpa Lampiran'}\n` +
    `⏳ *Estimasi Waktu:* ~${estMinutes} Menit (35s-65s/email Jitter)\n\n` +
    `_Sistem menggunakan Spintax Anti-Spam dan Delay Jitter otomatis._`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 KIRIM NOW!', 'execute_blast')],
      [Markup.button.callback('❌ BATALKAN', 'cancel')]
    ])
  );
  session.lastMsgId = sent.message_id;
}

// Handler Eksekusi Pengiriman Email ke GAS Webhook
bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);

  if (session.isProcessing) {
    return ctx.answerCbQuery('⚠️ Email sedang dalam proses pengiriman! Mohon tunggu...', { show_alert: true });
  }

  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const statusMsg = await ctx.reply('🚀 *MEMPROSES PENGIRIMAN EMAIL...*\n\n_Mohon tunggu, sistem sedang memproses pengiriman paket data ke Apps Script._');

  try {
    const payload = {
      recipients: session.recipients,
      senderName: session.senderName || "Admin Notification",
      subject: session.subject,
      body: session.body,
      pdfBase64: session.pdf ? session.pdf.base64 : null,
      pdfName: session.pdf ? session.pdf.name : null
    };

    const response = await axios.post(session.gasUrl, payload, { timeout: 600000 });
    const result = response.data;

    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){}

    if (result.status === 'success') {
      let reportText = `🎉 *LAPORAN BLAST EMAIL SELESAI!* 🎉\n\n` +
        `✅ *Berhasil Terkirim:* ${result.sent} Email\n` +
        `❌ *Gagal Terkirim:* ${result.failed} Email\n` +
        `📊 *Sisa Kuota Harian Google:* ${result.remainingQuota} Email\n`;

      if (result.failed > 0 && result.failedDetails) {
        reportText += `\n*Detail Email Gagal:*\n` + result.failedDetails.map(d => `• ${d}`).join('\n');
      }

      const sentReport = await ctx.replyWithMarkdown(reportText, mainMenu);
      session.lastMsgId = sentReport.message_id;

    } else {
      const sentErr = await ctx.replyWithMarkdown(`${result.message}`, mainMenu);
      session.lastMsgId = sentErr.message_id;
    }

  } catch (err) {
    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){}
    const sentErr = await ctx.reply(`🚨 *Terjadi kesalahan sistem/timeout:* ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  } finally {
    session.isProcessing = false;
    session.step = 'IDLE';
  }
});

// Handler Serverless Vercel Webhook (Anti Crash Error 500)
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
    res.status(200).send('Error Handled'); // Mengembalikan 200 agar Vercel tidak crash ke 500
  }
};
