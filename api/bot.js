const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Storage Session Sementara dalam memory
const userSessions = {};

const getSession = (userId) => {
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE' };
  }
  return userSessions[userId];
};

// ⚡ UI Home Menu Gen-Z
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 Blast Email Massal', 'start_blast')],
  [Markup.button.callback('⚙️ Set Webhook GAS', 'set_gas')],
  [Markup.button.callback('📊 Cek Sesi Active', 'view_session'), Markup.button.callback('🧹 Reset Data', 'reset_session')]
]);

bot.start((ctx) => {
  ctx.replyWithMarkdown(
    `✨ *YOO WHAT'S UP! WELCOME TO MAILBLAST GEN-Z* ⚡\n\n` +
    `Botblast anti-spam ter-kece yang siap bantu kirim 100 email harian lewat Google Apps Script.\n\n` +
    ` Pilih menu di bawah buat mulai, fren:`,
    mainMenu
  );
});

// Handlers Tombol Menu
bot.action('set_gas', (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'AWAIT_GAS_URL';
  ctx.answerCbQuery();
  ctx.reply('🔗 *Drop Link Deployment GAS Kamu:*', Markup.inlineKeyboard([
    [Markup.button.callback('❌ Batal', 'cancel')]
  ]));
});

bot.action('start_blast', (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session.gasUrl) {
    return ctx.reply('⚠️ *Eits! Webhook GAS belum di-set.* Klik "⚙️ Set Webhook GAS" dulu ya!');
  }
  session.step = 'AWAIT_RECIPIENTS';
  ctx.answerCbQuery();
  ctx.reply('📧 *Masukkan target email (pisahkan dengan koma)*\n\n_Contoh: a@gmail.com, b@gmail.com_', Markup.inlineKeyboard([
    [Markup.button.callback('❌ Batal', 'cancel')]
  ]));
});

bot.action('view_session', (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  ctx.replyWithMarkdown(
    `🔍 *STATUS SESI KAMU:*\n` +
    `• GAS URL: ${session.gasUrl ? '✅ Configured' : '❌ Kosong'}\n` +
    `• Target Mail: ${session.recipients ? session.recipients.length + ' Email' : '0'}\n` +
    `• Subject: ${session.subject ? '✅ Ada' : '❌ Kosong'}\n` +
    `• Attachment: ${session.pdf ? '✅ PDF Attached' : '❌ Tanpa Lampiran'}`
  );
});

bot.action('reset_session', (ctx) => {
  userSessions[ctx.from.id] = { step: 'IDLE' };
  ctx.answerCbQuery('Sesi di-reset!');
  ctx.reply('🧹 *Sesi kamu bersih lagi!* Monggo setting ulang.', mainMenu);
});

bot.action('cancel', (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = 'IDLE';
  ctx.answerCbQuery('Dibatalkan');
  ctx.reply('❌ Proses dibatalkan. Kembalikan ke menu utama:', mainMenu);
});

// Handler File Upload (PDF Max 5MB)
bot.on('document', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.step !== 'AWAIT_PDF') return;

  const doc = ctx.message.document;
  if (doc.mime_type !== 'application/pdf') {
    return ctx.reply('❌ *File harus berupa PDF!* Coba upload ulang.');
  }

  if (doc.file_size > 5 * 1024 * 1024) {
    return ctx.reply('❌ *Ukuran file kebesaran!* Maksimal ukuran PDF 5MB.');
  }

  ctx.reply('⏳ *Downloading & Processing PDF...*');
  
  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
  const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
  
  session.pdf = {
    base64: Buffer.from(response.data).toString('base64'),
    name: doc.file_name
  };

  session.step = 'CONFIRMATION';
  showConfirmation(ctx, session);
});

// Router Teks Berdasarkan Step
bot.on('text', async (ctx) => {
  const session = getSession(ctx.from.id);
  const text = ctx.message.text;

  switch (session.step) {
    case 'AWAIT_GAS_URL':
      if (!text.startsWith('https://script.google.com/')) {
        return ctx.reply('❌ *URL GAS Tidak Valid!* Harus diawali `https://script.google.com/`');
      }
      session.gasUrl = text;
      session.step = 'IDLE';
      ctx.reply('✅ *GAS Endpoint Berhasil Disimpan!*', mainMenu);
      break;

    case 'AWAIT_RECIPIENTS':
      session.recipients = text.split(',').map(e => e.trim()).filter(e => e.length > 0);
      session.step = 'AWAIT_SUBJECT';
      ctx.reply('📝 *Masukkan Subject Email:* \n\n💡 *Tips Spintax:* `{Halo|Hi} Penawaran Spesial!`');
      break;

    case 'AWAIT_SUBJECT':
      session.subject = text;
      session.step = 'AWAIT_BODY';
      ctx.reply('💬 *Masukkan Isi Pesan Email:*\n\n💡 *Tips Spintax:* `{Selamat Pagi|Halo Kak}, kami dari...`');
      break;

    case 'AWAIT_BODY':
      session.body = text;
      session.step = 'AWAIT_PDF';
      ctx.reply('📎 *Kirim File PDF Lampiran (Maks 5MB):*\n\n_Atau klik tombol skip jika tanpa lampiran._', Markup.inlineKeyboard([
        [Markup.button.callback('⏭️ Skip Lampiran PDF', 'skip_pdf')],
        [Markup.button.callback('❌ Batal', 'cancel')]
      ]));
      break;
  }
});

bot.action('skip_pdf', (ctx) => {
  const session = getSession(ctx.from.id);
  session.pdf = null;
  session.step = 'CONFIRMATION';
  ctx.answerCbQuery();
  showConfirmation(ctx, session);
});

// Tampilan Konfirmasi Sebelum Blast
function showConfirmation(ctx, session) {
  const estMinutes = Math.round((session.recipients.length * 30) / 60);
  ctx.replyWithMarkdown(
    `🔥 *SIAP BLAST EMAIL? MOHON CEK DATA:* 🔥\n\n` +
    `🎯 *Jumlah Target:* ${session.recipients.length} Email\n` +
    `📌 *Subject:* ${session.subject}\n` +
    `📎 *Lampiran:* ${session.pdf ? session.pdf.name : 'Tanpa Lampiran'}\n` +
    `⏳ *Estimasi Waktu:* ~${estMinutes} Menit (30s/email jitter)\n\n` +
    `_Sistem menggunakan Spintax Anti-Spam dan Delay Jitter otomatis._`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🚀 KIRIM NOW!', 'execute_blast')],
      [Markup.button.callback('❌ Batal Blast', 'cancel')]
    ])
  );
}

// Eksekusi Panggilan ke GAS
bot.action('execute_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  ctx.reply('🚀 *Otw Blast Email!* Bot sedang mengirim paket data ke Apps Script. Mohon tunggu laporan...');

  try {
    const payload = {
      recipients: session.recipients,
      subject: session.subject,
      body: session.body,
      pdfBase64: session.pdf ? session.pdf.base64 : null,
      pdfName: session.pdf ? session.pdf.name : null
    };

    const response = await axios.post(session.gasUrl, payload);
    const result = response.data;

    if (result.status === 'success') {
      ctx.replyWithMarkdown(
        `🎉 *BLAST EMAIL SELESAI! REPORT:* 🎉\n\n` +
        `✅ *Berhasil Terkirim:* ${result.sent} Email\n` +
        `❌ *Gagal:* ${result.failed} Email\n` +
        (result.failed > 0 ? `\n*Detail Gagal:*\n${result.failedDetails.join('\n')}` : '') +
        `\n\n✨ _Anti-spam delay jitter berhasil dijalankan._`,
        mainMenu
      );
    } else {
      ctx.reply(`🚨 *Gagal Kirim:* ${result.message}`, mainMenu);
    }
  } catch (err) {
    ctx.reply(`🚨 *Terjadi Kesalahan Server:* ${err.message}`, mainMenu);
  }

  session.step = 'IDLE';
});

// Handler Vercel Webhook
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Gen-Z Mailer Bot is Running!');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
};
