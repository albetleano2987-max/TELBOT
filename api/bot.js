const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// State sementara di memory serverless untuk menyimpan session per user
const userState = {};

// Helper: Fungsi Parser Spintax {Pilihan 1|Pilihan 2}
function parseSpintax(text) {
  if (!text) return '';
  let matches;
  const regex = /\{([^{}]+)\}/g;
  while ((matches = regex.exec(text)) !== null) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    regex.lastIndex = 0;
  }
  return text;
}

// Menu Utama (Inline Keyboards & Quick Reply Buttons)
const getMainMenu = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚀 Kirim Email Massal', 'start_email'),
      Markup.button.callback('⚙️ Setel URL GAS', 'set_gas')
    ],
    [
      Markup.button.callback('📊 Cek Status Bot', 'check_status'),
      Markup.button.callback('❓ Panduan Spintax', 'help_info')
    ]
  ]);
};

// Quick Reply Keyboard bawah layar
const getQuickReplyMenu = () => {
  return Markup.keyboard([
    ['🚀 Kirim Email', '⚙️ Setel GAS'],
    ['📊 Status Bot', '❓ Panduan']
  ]).resize();
};

// 1. Perintah /start & /menu
bot.command(['start', 'menu'], (ctx) => {
  const name = ctx.from.first_name || 'User';
  return ctx.reply(
    `✨ *Halo ${name}! Selamat Datang di GandorMail Bot Gateway* 🚀\n\n` +
    `Bot ini siap membantu kamu mengirimkan transmisi email massal ke antrean Google Apps Script (GAS) secara otomatis.\n\n` +
    `Pilih menu di bawah ini untuk memulai:`,
    {
      parse_mode: 'Markdown',
      ...getMainMenu()
    }
  );
});

// Handling Tombol Quick Reply Bawah
bot.hears('🚀 Kirim Email', (ctx) => ctx.reply('Silakan pilih opsi:', getMainMenu()));
bot.hears('⚙️ Setel GAS', (ctx) => triggerSetGas(ctx));
bot.hears('📊 Status Bot', (ctx) => triggerCheckStatus(ctx));
bot.hears('❓ Panduan', (ctx) => triggerHelp(ctx));

// 2. Action Handlers untuk Inline Buttons
bot.action('set_gas', (ctx) => triggerSetGas(ctx));
bot.action('check_status', (ctx) => triggerCheckStatus(ctx));
bot.action('help_info', (ctx) => triggerHelp(ctx));

function triggerSetGas(ctx) {
  const userId = ctx.from.id;
  userState[userId] = { ...userState[userId], step: 'AWAITING_GAS_URL' };
  return ctx.reply(
    `🔗 *PENGATURAN ENDPOINT GAS*\n\n` +
    `Silakan kirimkan URL Web App Google Apps Script kamu.\n` +
    `_Contoh: https://script.google.com/macros/s/XXXXX/exec_`,
    { parse_mode: 'Markdown' }
  );
}

function triggerCheckStatus(ctx) {
  const userId = ctx.from.id;
  const gasUrl = userState[userId]?.gasUrl ? '✅ Terhubung' : '❌ Belum Disetel';
  return ctx.reply(
    `📊 *STATUS SISTEM GANDORMAIL*\n\n` +
    `• *Status Bot:* 🟢 Online (Vercel Serverless)\n` +
    `• *Endpoint GAS:* ${gasUrl}\n` +
    `• *User Telegram ID:* \`${userId}\``,
    { parse_mode: 'Markdown' }
  );
}

function triggerHelp(ctx) {
  return ctx.reply(
    `💡 *PANDUAN SPINTAX & FORMAT GANDORMAIL*\n\n` +
    `1. *Spintax Format:* Gunakan \`{Subjek 1|Subjek 2}\` untuk variasi kata otomatis.\n` +
    `2. *Daftar Target:* Pisahkan email target menggunakan koma (\`,\`) atau baris baru.\n` +
    `3. *Notifikasi:* Bot akan otomatis memberi tahu kamu di Telegram jika seluruh email di antrean telah selesai dikirim! 🎉`,
    { parse_mode: 'Markdown' }
  );
}

// 3. Alur Kirim Email Massal
bot.action('start_email', (ctx) => {
  const userId = ctx.from.id;
  if (!userState[userId]?.gasUrl) {
    userState[userId] = { step: 'AWAITING_GAS_URL_FIRST' };
    return ctx.reply(
      `⚠️ *URL GAS Belum Diatur!*\n\nSilakan masukkan URL Web App Google Apps Script kamu terlebih dahulu:`,
      { parse_mode: 'Markdown' }
    );
  }

  userState[userId].step = 'AWAITING_EMAILS';
  return ctx.reply(
    `📝 *LANGKAH 1 DARI 3: ALAMAT EMAIL TARGET*\n\n` +
    `Kirimkan daftar email target penerima. Kamu bisa memisahkannya dengan koma (,) atau baris baru (enter).\n\n` +
    `_Maksimal 1000 email target per pengiriman._`,
    { parse_mode: 'Markdown' }
  );
});

// Handler Input Teks
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userState[userId];

  if (!state || !state.step) {
    return ctx.reply('Ketik /start atau gunakan menu di bawah untuk mulai.', getQuickReplyMenu());
  }

  // Menerima Input URL GAS
  if (state.step === 'AWAITING_GAS_URL' || state.step === 'AWAITING_GAS_URL_FIRST') {
    const url = ctx.message.text.trim();
    if (!url.startsWith('https://script.google.com/')) {
      return ctx.reply('❌ *URL tidak valid!* Pastikan diawali dengan `https://script.google.com/`', { parse_mode: 'Markdown' });
    }

    userState[userId] = { ...state, gasUrl: url, step: null };
    return ctx.reply(
      `✅ *URL Google Apps Script Berhasil Disimpan!*`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🚀 Mulai Buat Email Sekarang', 'start_email')]
      ])
    );
  }

  // Menerima Email Target
  if (state.step === 'AWAITING_EMAILS') {
    const rawEmails = ctx.message.text;
    const emailList = rawEmails.split(/[\n,]+/).map(e => e.trim()).filter(e => e.includes('@'));

    if (emailList.length === 0) {
      return ctx.reply('❌ Alamat email tidak valid. Silakan coba kirim ulang daftar email target:');
    }

    userState[userId].emails = emailList;
    userState[userId].step = 'AWAITING_SUBJECT';
    return ctx.reply(
      `✅ *${emailList.length} Target Terdeteksi!*\n\n` +
      `📝 *LANGKAH 2 DARI 3: SUBJEK PESAN*\n` +
      `Masukkan Subjek Email (Mendukung Spintax contoh: \`{Penting|Info Eksklusif} Penawaran Spesial\`):`,
      { parse_mode: 'Markdown' }
    );
  }

  // Menerima Subjek Email
  if (state.step === 'AWAITING_SUBJECT') {
    userState[userId].subject = ctx.message.text.trim();
    userState[userId].step = 'AWAITING_BODY';
    return ctx.reply(
      `📝 *LANGKAH 3 DARI 3: ISI PESAN EMAIL*\n\n` +
      `Masukkan Isi Pesan Email (Mendukung Spintax):`,
      { parse_mode: 'Markdown' }
    );
  }

  // Menerima Isi Pesan
  if (state.step === 'AWAITING_BODY') {
    userState[userId].body = ctx.message.text.trim();
    userState[userId].step = 'AWAITING_CONFIRMATION';

    const summary = userState[userId];
    return ctx.reply(
      `📊 *RINGKASAN TRANSMISI EMAIL*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎯 *Total Target:* ${summary.emails.length} Alamat Email\n` +
      `📌 *Subjek:* ${summary.subject}\n` +
      `💬 *Pratinjau Pesan (Spintax Parsed):*\n_${parseSpintax(summary.body)}_\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Kirim paket ini ke Server Queue Google Apps Script sekarang?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Ya, Kirim Sekarang!', 'confirm_send')],
          [Markup.button.callback('❌ Batalkan Transmisi', 'cancel_send')]
        ])
      }
    );
  }
});

// Batal
bot.action('cancel_send', (ctx) => {
  const userId = ctx.from.id;
  if (userState[userId]) userState[userId].step = null;
  return ctx.reply('❌ Transmisi dibatalkan.', getMainMenu());
});

// Konfirmasi Kirim
bot.action('confirm_send', async (ctx) => {
  const userId = ctx.from.id;
  const data = userState[userId];

  if (!data || !data.emails) {
    return ctx.reply('❌ Data transmisi tidak ditemukan. Silakan mulai dari /start.');
  }

  ctx.reply('⏳ *Mengunggah transmisi ke Server Queue GAS...*', { parse_mode: 'Markdown' });

  const payload = {
    emails: data.emails,
    subject: data.subject,
    body: data.body,
    notifyEmail: 'gandorchannel029@gmail.com',
    telegramChatId: userId, // ID Telegram diselipkan agar GAS bisa mengirim callback notifikasi
    attachment: null
  };

  try {
    const response = await fetch(data.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.success) {
      ctx.reply(
        `✅ *BERHASIL MASUK ANTREAN SERVER!* 🎉\n\n` +
        `📦 *Detail:* ${result.message}\n` +
        `🔔 Bot akan langsung memberikan notifikasi di Telegram ini saat seluruh email selesai terkirim!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Kirim Lagi', 'start_email')],
            [Markup.button.callback('🏠 Menu Utama', 'check_status')]
          ])
        }
      );
    } else {
      ctx.reply(`❌ *Gagal dari Server GAS:* ${result.error}`, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    ctx.reply(`❌ *Error Koneksi:* Gagal terhubung ke URL GAS.\n\nDetail: ${err.message}`);
  }

  userState[userId].step = null;
});

// 4. Webhook Endpoint untuk Notifikasi dari Google Apps Script (GAS Callback)
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const body = req.body;

      // Jika request berasal dari Callback Laporan Selesai Google Apps Script
      if (body && body.action === 'GAS_REPORT_FINISHED') {
        const { chatId, totalSent, totalFailed } = body;
        if (chatId) {
          await bot.telegram.sendMessage(
            chatId,
            `🎉 *PENGIRIMAN EMAIL MASSAL SELESAI!*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `✅ *Berhasil Terkirim:* ${totalSent} Email\n` +
            `❌ *Gagal Terkirim:* ${totalFailed} Email\n` +
            `📅 *Waktu:* ${new Date().toLocaleString('id-ID')}\n\n` +
            `Terima kasih telah menggunakan GandorMail Gateway!`,
            { parse_mode: 'Markdown' }
          );
        }
        return res.status(200).json({ success: true });
      }

      // Jika request normal dari Telegram Update
      await bot.handleUpdate(body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('GandorMail Telegram Bot Server Ready!');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error handling update');
  }
};
