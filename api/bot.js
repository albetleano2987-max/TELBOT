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

// Menu Utama yang Diupdate
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('🚀 BLAST EMAIL MASSAL', 'start_blast')],
  [Markup.button.callback('📖 TUTORIAL LENGKAP', 'view_tutorial')],
  [Markup.button.callback('⚙️ SETTING WEBHOOK GAS', 'set_gas')],
  [Markup.button.callback('📊 CEK SESI', 'view_session'), Markup.button.callback('🧹 RESET DATA', 'reset_session')]
]);

bot.start(async (ctx) => {
  const session = getSession(ctx.from.id);
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    `⚡ MAILBLAST GEN-Z SYSTEM (PRO) ⚡\n\n` +
    `Botblast anti-spam pintar dengan Smart-Quota (Maks 500 email) & Safe Delay (10s-20s).\n\n` +
    `Sistem otomatis menjadwalkan sisa email jika kuota harian Gmail habis.\n\n` +
    `Silahkan pilih menu di bawah ini:`,
    mainMenu
  );
  session.lastMsgId = sent.message_id;
});

// Fitur Tutorial (Mudah Dipahami)
bot.action('view_tutorial', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  const sent = await ctx.reply(
    `📖 <b>TUTORIAL PENGGUNAAN BOTBLAST</b> 📖\n\n` +
    `Bot ini dirancang untuk mengirim email massal dengan aman dan efisien. Ikuti panduan langkah demi langkah ini:\n\n` +
    `<b>Langkah 1: Setup Awal (Wajib Sekali)</b>\n` +
    `1. Buat Google Apps Script (GAS) Web App.\n` +
    `2. Salin URL Web App GAS kamu (harus berakhiran <code>/exec</code>).\n` +
    `3. Klik ⚙️ <b>SETTING WEBHOOK GAS</b> di bot ini dan tempelkan URL tersebut.\n` +
    `4. Pastikan kamu sudah me-run fungsi perizinan manual di GAS sekali.\n\n` +
    `<b>Langkah 2: Proses Blast Email</b>\n` +
    `1. Klik 🚀 <b>BLAST EMAIL MASSAL</b>.\n` +
    `2. Masukkan daftar email target (dipisahkan koma). Maksimal 500 email per antrean.\n` +
    `3. Masukkan Nama Pengirim (Sender Name).\n` +
    `4. Masukkan Subject Email (Bisa pakai Spintax).\n` +
    `5. Masukkan Isi Pesan Email (Bisa pakai Spintax).\n` +
    `6. Upload file PDF jika ada (Maks 10MB), atau skip.\n\n` +
    `<b>Langkah 3: Konfirmasi & Pengiriman</b>\n` +
    `1. Cek detail antrean pada menu konfirmasi.\n` +
    `2. Pilih 🚀 <b>KIRIM SEKARANG!</b> untuk pengiriman instan, atau ⏱️ <b>JADWALKAN BLAST</b> untuk pengiriman terjadwal.\n` +
    `3. Bot akan mengirim antrean awal sesuai sisa kuota harian Gmail kamu.\n` +
    `4. Jika kuota habis, sisa antrean akan otomatis dijadwalkan ulang 24 jam kemudian. Bot akan mengirim laporan otomatis setelah selesai.\n\n` +
    `💡 <b>Tips Anti-Spam:</b> Gunakan fitur Spintax {Kata1|Kata2|Kata3} pada subjek dan isi pesan untuk membuat setiap email berbeda.`,
    { parse_mode: 'HTML' }
  );
  
  // Kirim menu utama lagi setelah tutorial
  const sentMenu = await ctx.reply('Silahkan pilih menu kembali:', mainMenu);
  session.lastMsgId = sentMenu.message_id;
});

// Setting GAS Endpoint
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

// Start Blast Email Process
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

  const sent = await ctx.reply('📧 Masukkan daftar email target (pisahkan dengan koma):\n\nContoh: email1@gmail.com, email2@gmail.com\n\n(Maksimal 500 email)', Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel')]
  ]));
  session.lastMsgId = sent.message_id;
});

// Cek Sesi
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

// Reset Data Sesi
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

// Handler Lampiran PDF (Direct URL, tanpa Base64 overhead)
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
      
      if (session.recipients.length > 500) {
        const sentErr = await ctx.reply('❌ Total email melebihi maksimal (500)! Silahkan masukkan ulang daftar email:', Markup.inlineKeyboard([
          [Markup.button.callback('❌ BATALKAN', 'cancel')]
        ]));
        session.lastMsgId = sentErr.message_id;
        session.recipients = null;
        return;
      }
      
      session.step = 'AWAIT_SENDER_NAME';
      const sentName = await ctx.reply('👤 Masukkan Nama Pengirim (Sender Name):\n\nContoh: HRD PT Makmur');
      session.lastMsgId = sentName.message_id;
      break;

    case 'AWAIT_SENDER_NAME':
      await clearPrevMsg(ctx, session);
      session.senderName = text;
      session.step = 'AWAIT_SUBJECT';
      const sentSub = await ctx.reply('📝 Masukkan Subject Email:\n\n💡 Fitur Spintax: {Halo|Hi|PentingPenawaran Kerjasama Penjualan Sepatu}');
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

    case 'AWAIT_SCHEDULE_TIME':
      await clearPrevMsg(ctx, session);
      // Validasi format waktu (misal: 2023-12-31 09:00)
      const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
      if (!dateRegex.test(text)) {
        const sentErr = await ctx.reply('❌ Format waktu salah! Masukkan dalam format: TTTT-BB-HH JJ:MM\n\nContoh: 2023-12-31 09:00');
        session.lastMsgId = sentErr.message_id;
        return;
      }

      // Simpan waktu jadwal
      session.scheduledTime = text;
      session.step = 'CONFIRMATION';
      await showConfirmation(ctx, session);
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

// Pintu Masuk Menuju Fitur Penjadwalan
bot.action('schedule_blast', async (ctx) => {
  const session = getSession(ctx.from.id);
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);
  
  session.step = 'AWAIT_SCHEDULE_TIME';
  const sent = await ctx.reply('⏱️ Masukkan waktu pengiriman dalam format TTTT-BB-HH JJ:MM (Contoh: 2023-12-31 09:00):');
  session.lastMsgId = sent.message_id;
});

async function showConfirmation(ctx, session) {
  const estSeconds = session.recipients.length * 15;
  const estMinutes = Math.ceil(estSeconds / 60);

  const sent = await ctx.reply(
    `🔥 KONFIRMASI PENGIRIMAN EMAIL 🔥\n\n` +
    `🎯 Jumlah Target: ${session.recipients.length} Email (Maks 500)\n` +
    `👤 Nama Pengirim: ${session.senderName}\n` +
    `📌 Subject: ${session.subject}\n` +
    `📎 Lampiran: ${session.pdf ? session.pdf.name : 'Tanpa Lampiran'}\n\n` +
    (session.scheduledTime ? `🗓️ Waktu Jadwal: <b>${session.scheduledTime}</b>` : `⏳ Estimasi Waktu: ~${estMinutes} Menit (Safe Delay 10s-20s/email)`) +
    `🛡️ Mode Anti-Spam & Smart-Quota Aktif! Email dipastikan aman tembus Inbox Utama.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🚀 KIRIM SEKARANG!', 'execute_blast_now')],
          [Markup.button.callback('⏱️ JADWALKAN BLAST', 'schedule_blast')],
          [Markup.button.callback('❌ BATALKAN', 'cancel')]
        ]
      }
    }
  );
  session.lastMsgId = sent.message_id;
}

bot.action('execute_blast_now', async (ctx) => {
  await executeBlastInternal(ctx, null);
});

bot.action('view_tutorial_exec', async (ctx) => {
  executeBlastInternal(ctx, null);
});

async function executeBlastInternal(ctx, scheduledTime = null) {
  const session = getSession(ctx.from.id);

  if (session.isProcessing) {
    return ctx.answerCbQuery('⚠️ Pengiriman sedang berjalan! Mohon tunggu laporan selesai...', { show_alert: true });
  }

  session.isProcessing = true;
  ctx.answerCbQuery();
  await clearPrevMsg(ctx, session);

  try {
    const payload = {
      action: 'queue_blast', // Tentukan action untuk router di GAS
      chatId: ctx.from.id,
      botToken: BOT_TOKEN,
      recipients: session.recipients,
      senderName: session.senderName,
      subject: session.subject,
      body: session.body,
      pdfUrl: session.pdf ? session.pdf.url : null,
      pdfName: session.pdf ? session.pdf.name : null,
      scheduledTime: scheduledTime // Jika null, kirim instan
    };

    // Respon dari GAS sekarang kilat (< 1 detik) karena asinkron
    await axios.post(session.gasUrl, payload, { timeout: 10000 });

  } catch (err) {
    const sentErr = await ctx.reply(`🚨 Gagal terhubung ke GAS: ${err.message}`, mainMenu);
    session.lastMsgId = sentErr.message_id;
  } finally {
    session.isProcessing = false;
    session.step = 'IDLE';
    session.scheduledTime = null; // Reset jadwal
  }
}

// Handler khusus untuk tombol tutorial yang bisa dieksekusi ulang
bot.on('callback_query', async (ctx) => {
  const session = getSession(ctx.from.id);
  const callbackData = ctx.callbackQuery.data;

  // Lanjutkan eksekusi dari tutorial konfirmasi ke executeBlastInternal
  if (callbackData === 'execute_blast_tutorial') {
    executeBlastInternal(ctx, null);
  } else if (callbackData === 'schedule_blast_tutorial') {
    // Tampilkan tutorial penjadwalan sederhana
    ctx.answerCbQuery();
    await ctx.reply('⏱️ Tutorial Jadwal: Pilih tombol Jadwalkan di menu konfirmasi, lalu masukkan waktu dalam format TTTT-BB-HH JJ:MM.');
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
