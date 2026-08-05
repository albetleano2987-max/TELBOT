const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Respon perintah /start
bot.start((ctx) => ctx.reply('Halo! Bot kamu sudah aktif di Vercel 🚀'));

// Respon perintah /help
bot.help((ctx) => ctx.reply('Ada yang bisa dibantu?'));

// Respon teks biasa
bot.on('text', (ctx) => ctx.reply(`Kamu bilang: ${ctx.message.text}`));

// Handler untuk Vercel Serverless Function
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot Server is Running!');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error handling update');
  }
};
