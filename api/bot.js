function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const recipients = data.recipients || [];
    const subject = data.subject;
    const bodyTemplate = data.body;
    const pdfBase64 = data.pdfBase64;
    const pdfName = data.pdfName || "document.pdf";
    const senderName = data.senderName || "Mail Notification"; // Nama Pengirim

    const remainingQuota = MailApp.getRemainingDailyQuota();
    if (recipients.length > remainingQuota) {
      return responseJSON({
        status: "error",
        message: `🚫 *KUOTA GMAIL TIDAK CUKUP!*\n\nSisa Kuota: *${remainingQuota} Email*\nTarget: *${recipients.length} Email*`
      });
    }

    let successCount = 0;
    let failedList = [];

    let blob = null;
    if (pdfBase64) {
      const bytes = Utilities.base64Decode(pdfBase64);
      blob = Utilities.newBlob(bytes, "application/pdf", pdfName);
    }

    for (let i = 0; i < recipients.length; i++) {
      const email = recipients[i].trim();
      if (!email) continue;

      // 1. Spintax Processing
      let parsedBody = parseSpintax(bodyTemplate);
      let parsedSubject = parseSpintax(subject);

      // 2. Anti-Spam Hack: Tambahkan Hidden Random String & Invisible Footprint
      // Ini memaksa setiap pesan memiliki Hash HTML unik sehingga tidak terbaca sebagai Broadcast/Bulk.
      const uniqueId = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      const invisibleFooter = `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Ref: ${uniqueId}</div>`;
      
      const finalHtmlBody = `${parsedBody.replace(/\n/g, '<br>')}<br><br>${invisibleFooter}`;

      // 3. Kirim Email dengan Retry Logic
      const sendResult = sendWithRetry(email, parsedSubject, finalHtmlBody, blob, senderName);

      if (sendResult.success) {
        successCount++;
      } else {
        failedList.push(`${email} (${sendResult.error})`);
      }

      // 4. Anti-Spam Jitter Dynamic: 35 detik s/d 65 detik (Lebih Mirip Manusia)
      if (i < recipients.length - 1) {
        const dynamicDelay = 35000 + Math.floor(Math.random() * 30000); // 35s - 65s
        Utilities.sleep(dynamicDelay);
      }
    }

    return responseJSON({
      status: "success",
      sent: successCount,
      failed: failedList.length,
      failedDetails: failedList,
      remainingQuota: MailApp.getRemainingDailyQuota()
    });

  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

function sendWithRetry(email, subject, body, blob, senderName) {
  const retryDelays = [15000, 30000, 45000];
  let lastError = "";

  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      const mailOptions = {
        to: email,
        subject: subject,
        htmlBody: body,
        name: senderName // Menampilkan Nama Pengirim Asli
      };

      if (blob) {
        mailOptions.attachments = [blob];
      }

      GmailApp.sendEmail(email, subject, "", mailOptions);
      return { success: true };

    } catch (err) {
      lastError = err.message;
      if (attempt < retryDelays.length) {
        Utilities.sleep(retryDelays[attempt]);
      }
    }
  }

  return { success: false, error: lastError };
}

function parseSpintax(text) {
  const matches = text.match(/\{[^{}]+\}/g);
  if (!matches) return text;

  for (let match of matches) {
    const options = match.slice(1, -1).split('|');
    const randomChoice = options[Math.floor(Math.random() * options.length)];
    text = text.replace(match, randomChoice);
  }
  return parseSpintax(text);
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
