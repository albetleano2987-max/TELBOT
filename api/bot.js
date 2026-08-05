const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN || '');
const userSessions = {};

const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE', isProcessing: false };
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

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    `⚡ MAILBLAST GEN-Z SYSTEM ⚡\n\n` +
    `Botblast anti-spam pintar dengan Safe Delay (10s-20s) untuk garansi tembus INBOX UTAMA.\n\n` +
    `Silahkan pilih menu di bawah ini:`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🔗 Tempelkan Link Web App Google Apps Script Kamu di sini:', Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();

  if (!session.gasUrl) {
    await clearPrevMsg(ctx, session);
    const sent = await ctx.reply('⚠️ Webhook GAS belum di-set! Klik "⚙️ SETTING WEBHOOK GAS" terlebih dahulu.', mainMenu);
    session.lastMsgId = sent.message_id;
    return;
  }

  session.step = 'AWAIT_RECIPIENTS';
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('📧 Masukkan daftar email target (pisahkan dengan koma):\n\nContoh: email1@gmail.com, email2@gmail.com', Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    `📊 STATUS SESI SAAT INI:\n\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Terhubung' : '❌ Belum Di-set'}\n` +
    `• Target Email: ${session.recipients ? session.recipients.length + ' Alamat' : '0'}\n` +
    `• Nama Pengirim: ${session.senderName || '❌ Belum Di-set'}\n` +
    `• Subject Email: ${session.subject ? '✅ Terisi' : '❌ Kosong'}\n` +
    `• Lampiran PDF: ${session.pdf ? '✅ ' + session.pdf.name : '❌ Tanpa Lampiran'}`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

bot.action('reset_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false };
  ctx.answerCbQuery('Sesi Di-reset!');
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply('🧹 Sesi berhasil dibersihkan kembali.', mainMenu);
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

bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.step !== 'AWAIT_PDF') return;

  const doc = ctx.message.document;
  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}
  await clearPrevMsg(ctx, session);

  if (doc.mime_type !== 'application/pdf') {
    const sent = await ctx.reply('❌ File harus berformat PDF! Silahkan upload ulang:', Markup.inlineKeyboard([
      [Markup.button.callback('❌ BATALKAN', 'cancel')]
    ]));
    session.lastMsgId = sent.message_id;
    return;
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    
    session.pdf = {
      url: fileLink.href,
      name: doc.file_name
    };

    session.step = 'CONFIRMATION';
    await showConfirmation(ctx, session);
  } catch (err) {
    const sentErr = await ctx.reply(`🚨 Gagal mengambil file PDF: ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  }
});

bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;

  try { await ctx.deleteMessage(ctx.message.message_id); } catch(e){}

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      await clearPrevMsg(ctx, session);
      if (!text.startsWith('https://script.google.com/')) {
        const sent = await ctx.reply('❌ URL Tidak Valid! Harus diawali dengan https://script.google.com/');
        session.lastMsgId = sent.message_id;
        return;
      }
      session.gasUrl = text;
      session.step = 'IDLE';
      const sentGas = await ctx.reply('✅ Endpoint Google Apps Script Berhasil Disimpan!', mainMenu);
      session.lastMsgId = sentGas.message_id;
      break;

    case 'AWAIT_RECIPIENTS':
      await clearPrevMsg(ctx, session);
      session.recipients = text.split(',').map(e => e.trim()).filter(e => e.length > 0);
      session.step = 'AWAIT_SENDER_NAME';
      const sentName = await ctx.reply('👤 Masukkan Nama Pengirim (Sender Name):\n\nContoh: HRD PT Makmur');
      session.lastMsgId = sentName.message_id;
      break;

    case 'AWAIT_SENDER_NAME':
      await clearPrevMsg(ctx, session);
      session.senderName = text;
      session.step = 'AWAIT_SUBJECT';
      const sentSub = await ctx.reply('📝 Masukkan Subject Email:\n\n💡 Fitur Spintax: {Halo|Hi|Penting} Penawaran Kerjasama');
      session.lastMsgId = sentSub.message_id;
      break;

    case 'AWAIT_SUBJECT':
      await clearPrevMsg(ctx, session);
      session.subject = text;
      session.step = 'AWAIT_BODY';
      const sentBody = await ctx.reply('💬 Masukkan Isi Pesan Email:\n\n💡 Fitur Spintax: {Selamat Pagi|Halo Kak}, kami dari tim...');
      session.lastMsgId = sentBody.message_id;
      break;

    case 'AWAIT_BODY':
      await clearPrevMsg(ctx, session);
      session.body = text;
      session.step = 'AWAIT_PDF';
      const sentPdf = await ctx.reply('📎 Upload File PDF Lampiran (Maksimal 10MB):\n\nAtau klik tombol Skip jika tanpa lampiran.', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ SKIP LAMPIRAN', 'skip_pdf')],
        [Markup.button.callback('❌ BATALKAN', 'cancel')]
      ]));
      session.lastMsgId = sentPdf.message_id;
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
  const estSeconds = session.recipients.length * 15;
  const estMinutes = Math.ceil(estSeconds / 60);

  const sent = await ctx.reply(
    `🔥 KONFIRMASI PENGIRIMAN EMAIL 🔥\n\n` +
    `🎯 Jumlah Target: ${session.recipients.length} Email\n` +
    `👤 Nama Pengirim: ${session.senderName}\n` +
    `📌 Subject: ${session.subject}\n` +
    `📎 Lampiran: ${session.pdf ? session.pdf.name : 'Tanpa Lampiran'}\n` +
    `⏳ Estimasi Waktu: ~${estMinutes} Menit (Safe Delay 10s-20s/email)\n\n` +
    `🛡️ Mode Anti-Spam & Footprint Aktif! Email dipastikan tembus Inbox Utama.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 KIRIM SEKARANG!', 'execute_blast')],
      [Markup.button.callback('❌ BATALKAN', 'cancel')]
    ])
  );
  session.lastMsgId = sent.message_id;
}

bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);

  if (session.isProcessing) {
    return ctx.answerCbQuery('⚠️ Pengiriman sedang berjalan! Mohon tunggu laporan selesai...', { show_alert: true });
  }

  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  try {
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

    // Kirim pemicu ke GAS dan tunggu konfirmasi awal
    await axios.post(session.gasUrl, payload, { timeout: 30000 });

  } catch (err) {
    const sentErr = await ctx.reply(`🚨 Gagal terhubung ke GAS: ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  } finally {
    session.isProcessing = false;
    session.step = 'IDLE';
  }
});

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
