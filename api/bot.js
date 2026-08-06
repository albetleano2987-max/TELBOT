const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const csv = require('csv-parser');
const xlsx = require('xlsx');

const BOT_TOKEN = process.env.BOT_TOKEN;
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
      gasUrl: null,
      lastMsgId: null
    };
  }
  return userSessions[userId];
};

// Fungsi pembersih pesan bot lama
const clearBotMsg = async (ctx, session) => {
  if (session && session.lastMsgId) {
    try {
      await ctx.deleteMessage(session.lastMsgId);
      session.lastMsgId = null;
    } catch (e) {}
  }
};

// Fungsi pembersih pesan user
const clearUserMsg = async (ctx) => {
  if (ctx.message) {
    try {
      await ctx.deleteMessage(ctx.message.message_id);
    } catch (e) {}
  }
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
          .on('data', (row) => {
            const value = Object.values(row)[0];
            if (value && value.includes('@')) emails.push(value.trim());
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileName.endsWith('.xlsx')) {
      const chunks = [];
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => chunks.push(chunk));
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
      const buffer = Buffer.concat(chunks);
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      
      data.forEach(row => {
        if (row && row[0] && String(row[0]).includes('@')) {
          emails.push(String(row[0]).trim());
        }
      });
    }
    return [...new Set(emails)];
  } catch (err) {
    return null;
  }
};

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearUserMsg(ctx);
  await clearBotMsg(ctx, session);
  
  const sent = await ctx.reply(
    `⚡ <b>MAILBLAST GEN-Z SYSTEM</b> ⚡\n\n` +
    `Bot blast anti-spam dengan Auto Reschedule & UI Clean Mode.\n\n` +
    `Silahkan pilih menu:`,
    { parse_mode: 'HTML', ...mainMenu }
  );
  session.lastMsgId = sent.message_id;
});

bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  
  const sent = await ctx.reply(
    '🔗 <b>Tempelkan Link Web App GAS (/exec):</b>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]) }
  );
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

  const sent = await ctx.reply(
    '📧 <b>Upload File CSV / EXCEL (.xlsx) Isi Email Target (Max 1000):</b>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]) }
  );
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
      const sent = await ctx.reply('❌ Format salah! Upload file .csv / .xlsx:', Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]));
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
      const sent = await ctx.reply('❌ File harus PDF! Upload ulang:', Markup.inlineKeyboard([[Markup.button.callback('❌ BATALKAN', 'cancel')]]));
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
      const sentPdf = await ctx.reply('📎 Upload File PDF Lampiran atau klik Skip:', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ SKIP LAMPIRAN', 'skip_pdf')],
        [Markup.button.callback('❌ BATALKAN', 'cancel')]
      ]));
      session.lastMsgId = sentPdf.message_id;
      break;
  }
});

async function showConfirmation(ctx, session) {
  const sent = await ctx.reply(
    `🔥 <b>KONFIRMASI PENGIRIMAN EMAIL</b> 🔥\n\n` +
    `🎯 Target: <b>${session.recipients.length} Email</b>\n` +
    `👤 Pengirim: ${session.senderName}\n` +
    `📌 Subject: ${session.subject}\n` +
    `📎 Lampiran: ${session.pdf ? session.pdf.name : '❌'}\n`,
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

bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);

  if (session.isProcessing) return ctx.answerCbQuery('⚠️ Sedang diproses...');

  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);

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

    await axios.post(session.gasUrl, payload, { timeout: 0 });

    const sent = await ctx.reply(`✅ <b>Antrean Diterima!</b>\n\nGAS akan mengirimkan email secara bertahap (per batch) sampai sisa kuota hari ini habis.`, { parse_mode: 'HTML', ...mainMenu });
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
  
  const sent = await ctx.reply(
    `📊 <b>STATUS SESI:</b>\n\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Terhubung' : '❌ Belum'}\n` +
    `• Target: ${session.recipients.length} Email\n` +
    `• Sender: ${session.senderName || '❌'}\n` +
    `• Subject: ${session.subject ? '✅' : '❌'}\n` +
    `• PDF: ${session.pdf ? '✅ ' + session.pdf.name : '❌'}`,
    { parse_mode: 'HTML', ...mainMenu }
  );
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
