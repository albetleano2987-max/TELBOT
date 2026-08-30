const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwSTMAlj5SC51IuBwQU2UQ0tL6w4zlAYz9UYkxSQ13xiOFXHlNGowFKwq8vNbhWMh5S/exec';[cite: 2]

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
      gasUrl: DEFAULT_GAS_URL,[cite: 2]
      lastMsgId: null 
    };
  } else {
    if (!userSessions[userId].gasUrl) {
      userSessions[userId].gasUrl = DEFAULT_GAS_URL;[cite: 2]
    }
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

const checkAccessMiddleware = async (ctx, next) => {
  const userId = ctx.from ? ctx.from.id : null;
  if (!userId) return;

  if (String(userId) === "7619665121") return next();

  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('req_') || data.startsWith('acc_user_')) return next();
  }

  const session = getSession(userId);
  try {
    const res = await axios.post(session.gasUrl, { action: 'check_access', telegramId: userId }, { timeout: 10000 });
    if (res.data && res.data.allowed) return next(); 
  } catch (e) {}

  await clearBotMsg(ctx, session);
  const sent = await ctx.reply(
    '⛔ <b>AKSES DITOLAK</b>\n\nBot ini privat. Klik tombol di bawah untuk meminta akses.',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('📩 Minta Akses ke Admin', `req_${userId}`)]])
    }
  );
  session.lastMsgId = sent.message_id;
};

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 MULAI BLAST', 'start_blast'), Markup.button.callback('🛑 STOP BLAST', 'stop_blast')],
  [Markup.button.callback('🔋 Cek Kuota Gmail', 'check_quota'), Markup.button.callback('⚙️ Setting Webhook', 'set_gas')],
  [Markup.button.callback('📊 Cek Sesi', 'view_session'), Markup.button.callback('🧹 Reset Data', 'reset_session')],
  [Markup.button.url('👤 Owner (@andiigndr29)', 'https://instagram.com/andiigndr29')]
]);

bot.use(checkAccessMiddleware);

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearUserMsg(ctx);
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('<b>Don\'t Spam Bot !</b>', { parse_mode: 'HTML', ...mainMenu });
  session.lastMsgId = sent.message_id;
});

bot.action(/^req_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const user = ctx.from;
  await ctx.answerCbQuery('Permintaan terkirim!').catch(() => {});
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: "7619665121",
      text: `🔔 <b>PERMINTAAN AKSES BARU</b>\n\n👤 Nama: ${user.first_name || '-'}\n🆔 ID: <code>${userId}</code>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '✅ ACC SEKARANG', callback_data: `acc_user_${userId}` }]] }
    });
  } catch (err) {}
  await ctx.editMessageText('⏳ Permintaan akses sudah dikirim ke Admin.', { parse_mode: 'HTML' }).catch(() => {});
});

bot.action(/^acc_user_(.+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const session = getSession(ctx.from.id);
  await ctx.answerCbQuery('Memproses ACC...').catch(() => {});
  try {
    const res = await axios.post(session.gasUrl, { action: 'approve_user', telegramId: targetId }, { timeout: 15000 });
    if (res.data && res.data.status === 'success') {
      await ctx.editMessageText(`✅ <b>SUKSES!</b> User ID <code>${targetId}</code> di-ACC.`, { parse_mode: 'HTML' });
      try { await ctx.telegram.sendMessage(targetId, '🎉 <b>Akses disetujui!</b> Ketik /start.', { parse_mode: 'HTML' }); } catch (e) {}
    } else {
      await ctx.reply(`❌ Gagal: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    await ctx.reply(`🚨 Error: ${err.message}`);
  }
});

bot.action('set_gas', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('🔗 <b>Kirim Link Web App GAS (/exec):</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]) });
  session.lastMsgId = sent.message_id;
});

bot.action('start_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  session.step = 'AWAIT_RECIPIENTS_TEXT';
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('📧 <b>Kirim daftar email target (atau copy-paste banyak email sekaligus, pisahkan dengan koma/enter):</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]) });
  session.lastMsgId = sent.message_id;
});

bot.action('stop_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  try {
    const response = await axios.post(session.gasUrl, { action: 'stop_blast', botToken: BOT_TOKEN, chatId: ctx.from.id }, { timeout: 15000 });
    const sent = await ctx.reply(`🛑 ${response.data.message || 'Berhasil dihentikan.'}`, mainMenu);
    session.lastMsgId = sent.message_id;
  } catch (err) {
    const sent = await ctx.reply(`🚨 Gagal: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  }
});

bot.action('check_quota', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  try {
    const response = await axios.post(session.gasUrl, { action: 'check_quota', botToken: BOT_TOKEN, chatId: ctx.from.id }, { timeout: 15000 });
    const sent = await ctx.reply(`🔋 Sisa kuota Gmail hari ini: <b>${response.data.quota !== undefined ? response.data.quota : '0'} email</b>`, { parse_mode: 'HTML', ...mainMenu });
    session.lastMsgId = sent.message_id;
  } catch (err) {
    const sent = await ctx.reply(`🚨 Gagal: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  }
});

bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  await clearUserMsg(ctx);

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      session.gasUrl = text;
      session.step = 'IDLE';
      await clearBotMsg(ctx, session);
      const sentGas = await ctx.reply('✅ Webhook GAS Disimpan!', mainMenu);
      session.lastMsgId = sentGas.message_id;
      break;
    case 'AWAIT_RECIPIENTS_TEXT':
      const emails = text.split(/[\n,]+/).map(e => e.trim()).filter(e => e.includes('@'));
      if (emails.length === 0) {
        await clearBotMsg(ctx, session);
        const sent = await ctx.reply('❌ Tidak ada email valid. Coba lagi:', Markup.inlineKeyboard([[Markup.button.callback('❌ Batalkan', 'cancel')]]));
        session.lastMsgId = sent.message_id;
        return;
      }
      session.recipients = emails;
      session.step = 'AWAIT_SENDER_NAME';
      await clearBotMsg(ctx, session);
      const sentName = await ctx.reply(`✅ Berhasil memuat <b>${emails.length} email</b>.\n\n👤 Masukkan Nama Pengirim:`, { parse_mode: 'HTML' });
      session.lastMsgId = sentName.message_id;
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
      session.step = 'CONFIRMATION';
      await clearBotMsg(ctx, session);
      await showConfirmation(ctx, session);
      break;
  }
});

async function showConfirmation(ctx, session) {
  const sent = await ctx.reply(`🔥 <b>KONFIRMASI PENGIRIMAN</b> 🔥\n\n🎯 Target: <b>${session.recipients.length} Email</b>\n👤 Pengirim: ${session.senderName}\n📌 Subject: ${session.subject}`, {
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
    const payload = { chatId: ctx.from.id, botToken: BOT_TOKEN, recipients: session.recipients, senderName: session.senderName, subject: session.subject, body: session.body };
    await axios.post(session.gasUrl, payload, { timeout: 0 });
    const sent = await ctx.reply('✅ <b>Antrean Diterima!</b> Email sedang dikirim bertahap.', { parse_mode: 'HTML', ...mainMenu });
    session.lastMsgId = sent.message_id;
  } catch (err) {
    const sent = await ctx.reply(`🚨 Gagal: ${err.message}`, mainMenu);
    session.lastMsgId = sent.message_id;
  } finally {
    session.isProcessing = false;
    session.step = 'IDLE';
  }
});

bot.action('view_session', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply(`📊 <b>STATUS:</b>\n\n• Target: ${session.recipients.length} Email\n• Sender: ${session.senderName || '❌'}`, { parse_mode: 'HTML', ...mainMenu });
  session.lastMsgId = sent.message_id;
});

bot.action('reset_session', async (ctx) => {
  userSessions[ctx.from.id] = { step: 'IDLE', isProcessing: false, recipients: [], senderName: '', subject: '', body: '', gasUrl: DEFAULT_GAS_URL, lastMsgId: null };[cite: 2]
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery('Di-reset!');
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('🧹 Bersih.', mainMenu);
  session.lastMsgId = sent.message_id;
});

bot.action('cancel', async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  await clearBotMsg(ctx, session);
  const sent = await ctx.reply('❌ Dibatalkan.', mainMenu);
  session.lastMsgId = sent.message_id;
});

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      if (req.body) await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    } else {
      return res.status(200).send('Bot Active & Running!');
    }
  } catch (err) {
    return res.status(200).send('OK');
  }
};
