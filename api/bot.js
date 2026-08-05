
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Halo! Bot aktif di Vercel.'));
bot.help((ctx) => ctx.reply('Ketik sesuatu untuk tes.'));
bot.on('text', (ctx) => ctx.reply(`Pesan kamu: ${ctx.message.text}`));

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Bot Status: Online');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send('Error');
  }
};
