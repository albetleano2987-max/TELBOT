const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);
const userSessions = {};

const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE', isProcessing: false };
  }
  return userSessions[userId];
};

// Helper untuk hapus pesan lama agar chat rapi
const clearPrevMsg = async (ctx, session) => {
  if (session.lastMsgId) {
    try {
      await ctx.deleteMessage(session.lastMsgId);
    } catch (e) {
      // Mengabaikan error jika pesan sudah terhapus
    }
  }
};

// Tombol Font Tebal (Mathematical Bold)
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 𝑩𝑳𝑨𝑺𝑻 𝑬𝑑𝑨𝑰𝑳 𝑴𝑨𝑺𝑺𝑨𝑳', 'start_blast')],
  [Markup.button.callback('⚙️ 𝑺𝑬𝑻𝑻𝑰𝑵𝑮 𝑾𝑬𝑩𝑯𝑑𝑑𝑑 𝑮𝑨𝑺', 'set_gas')],
  [Markup.button.callback('📊 𝑪𝑬 any 𝑺𝑬𝑺𝑰', 'view_session'), Markup.button.callback('🧹 𝑹𝑬𝑺𝑬𝑻 𝑫𝑨𝑻𝑨', 'reset_session')]
]);

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

// Setting GAS URL
bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🔗 *Drop Link Deployment Web App GAS Kamu:*', Markup.inlineKeyboard([
    [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

// Mula Blast
bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();

  if (!session.gasUrl) {
    await clearPrevMsg(ctx, session);
    const sent = await ctx.reply('⚠️ *Eits! Webhook GAS belum di-set.* Klik "⚙️ 𝑺𝑬𝑻𝑻𝑰𝑵𝑮 𝑾𝑬𝑩𝑯𝑑𝑑𝑑 𝑮𝑨𝑺" dulu ya!', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }

  session.step = 'AWAIT_RECIPIENTS';
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('📧 *Masukkan target email (pisahkan dengan koma)*\n\n_Contoh: email1@gmail.com, email2@gmail.com_', Markup.inlineKeyboard([
    [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

// Cek Sesi Active
bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.replyWithMarkdown(
    `🔍 *STATUS SESI KAMU:*\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Configured' : '❌ Kosong'}\n` +
    `• Target Mail: ${session.recipients ? session.recipients.length + ' Email' : '0'}\n` +
    `• Subject: ${session.subject ? '✅ Ada' : '❌ Kosong'}\n` +
    `• Attachment: ${session.pdf ? '✅ PDF Attached' : '❌ Tanpa Lampiran'}`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

// Reset Sesi
bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false };
  ctx.answerCbQuery('Sesi di-reset!');
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🧹 *Sesi kamu bersih lagi!* Monggo setting ulang.', mainMenu);
  userSessions[ctx.from.id].lastMsgId = sent.message_id;
});

// Batal
bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('❌ *Proses dibatalkan.* Kembalikan ke menu utama:', mainMenu);
  session.lastMsgId = sent.message_id;
});

// Handling Input Dokumen PDF
bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.step !== 'AWAIT_PDF') return;

  const doc = ctx.message.document;
  
  // Hapus pesan teks user & pesan bot sebelumnya
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}
  await clearPrevMsg(ctx, session);

  if (doc.mime_type !== 'application/pdf') {
    const sent = await ctx.reply('❌ *File harus berupa PDF!* Upload ulang:', Markup.inlineKeyboard([
      [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
    ]));
    session.lastMsgId = sent.message_id;
    return;
  }

  if (doc.file_size > 5 * 1024 * 1024) {
    const sent = await ctx.reply('❌ *File Kebesaran!* Maksimal 5MB. Upload ulang:', Markup.inlineKeyboard([
      [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
    ]));
    session.lastMsgId = sent.message_id;
    return;
  }

  const processingMsg = await ctx.reply('⏳ *Downloading & Processing PDF...*');
  
  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  
  session.pdf = {
    base64: Buffer.from(response.data).toString('base64'),
    name: doc.file_name
  };

  try { await ctx.deleteMessage(processingMsg.message_id); } catch(e){}
  session.step = 'CONFIRMATION';
  await showConfirmation(ctx, session);
});

// Text Input Router
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;

  // Auto bersihkan pesan inputan user agar chat bersih
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
      session.step = 'AWAIT_SUBJECT';
      const sentRec = await ctx.reply('📝 *Masukkan Subject Email:* \n\n💡 *Tips Spintax:* `{Halo|Hi} Penawaran Spesial!`');
      session.lastMsgId = sentRec.message_id;
      break;

    case 'AWAIT_SUBJECT':
      await clearPrevMsg(ctx, session);
      session.subject = text;
      session.step = 'AWAIT_BODY';
      const sentSub = await ctx.reply('💬 *Masukkan Isi Pesan Email:*\n\n💡 *Tips Spintax:* `{Selamat Pagi|Halo Kak}, kami dari...`');
      session.lastMsgId = sentSub.message_id;
      break;

    case 'AWAIT_BODY':
      await clearPrevMsg(ctx, session);
      session.body = text;
      session.step = 'AWAIT_PDF';
      const sentBody = await ctx.reply('📎 *Kirim File PDF Lampiran (Maks 5MB):*\n\n_Atau klik tombol skip jika tanpa lampiran._', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ 𝑺𝑑𝑰𝑵 𝑳𝑨𝑑𝑷𝑰𝑑𝑨𝑵', 'skip_pdf')],
        [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
      ]));
      session.lastMsgId = sentBody.message_id;
      break;
  }
});

bot.action('skip_pdf', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null;
  session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  await showConfirmation(ctx, session);
});

async function showConfirmation(ctx, session) {
  const estMinutes = Math.round((session.recipients.length * 30) / 60);
  const sent = await ctx.replyWithMarkdown(
    `🔥 *SIAP BLAST EMAIL? MOHON CEK DATA:* 🔥\n\n` +
    `🎯 *Jumlah Target:* ${session.recipients.length} Email\n` +
    `📌 *Subject:* ${session.subject}\n` +
    `📎 *Lampiran:* ${session.pdf ? session.pdf.name : 'Tanpa Lampiran'}\n` +
    `⏳ *Estimasi Waktu:* ~${estMinutes} Menit (≥30s/email)\n\n` +
    `_Sistem menggunakan Spintax Anti-Spam dan Delay Jitter otomatis._`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 𝑑𝑰𝑑𝑰𝑑 𝑵𝑶𝑑!', 'execute_blast')],
      [Markup.button.callback('❌ 𝑩𝑨𝑻𝑨𝑳𝑲𝑨𝑵', 'cancel')]
    ])
  );
  session.lastMsgId = sent.message_id;
}

// Logika Eksekusi Kirim Email (Anti-Double Click & Lock State)
bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);

  // Mencegah Double Click
  if (session.isProcessing) {
    return ctx.answerCbQuery('⚠️ Email sedang dalam proses pengiriman! Mohon tunggu...', { show_alert: true });
  }

  session.isProcessing = true; // Lock State
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const statusMsg = await ctx.reply('🚀 *MEMPROSES PENGIRIMAN EMAIL...*\n\n_Mohon tunggu, sistem sedang mengirim request ke Google Apps Script dan memproses antrean email._');

  try {
    const payload = {
      recipients: session.recipients,
      subject: session.subject,
      body: session.body,
      pdfBase64: session.pdf ? session.pdf.base64 : null,
      pdfName: session.pdf ? session.pdf.name : null
    };

    // Timeout 10 menit untuk menampung proses Apps Script
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
      const sentErr = await ctx.replyWithMarkdown(`🚨 *GAGAL MEMPROSES:* \n\n${result.message}`, mainMenu);
      session.lastMsgId = sentErr.message_id;
    }

  } catch (err) {
    try { await ctx.deleteMessage(statusMsg.message_id); } catch(e){}
    const sentErr = await ctx.reply(`🚨 *Terjadi kesalahan sistem/timeout:* ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  } finally {
    session.isProcessing = false; // Unlock State
    session.step = 'IDLE';
  }
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Telegram Emailer Bot Active!');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
};
