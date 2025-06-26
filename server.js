const { google } = require("googleapis");
const gmail = google.gmail("v1");
const { Buffer } = require("buffer");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const express = require("express");
const open = (...args) => import("open").then((mod) => mod.default(...args));
const app = express();
const PORT = 8080;
require("dotenv").config();

const TOKEN_PATH = path.join(__dirname, "token.json");

const loadToken = () => {
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  }
  return null;
};

const saveToken = (token) => {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
};

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const tokenData = loadToken();
if (tokenData) oauth2Client.setCredentials(tokenData);

oauth2Client.on("tokens", (tokens) => {
  const updated = { ...(tokenData || {}), ...tokens };
  saveToken(updated);
});

const getRecentMessages = async () => {
  console.log("👉 Đã vào getRecentMessage");
  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: 'from:tommision123@gmail.com subject:"Kết quả bệnh nhân"',
      maxResults: 5,
      auth: oauth2Client,
    });

    console.log("📨 Đã lấy danh sách email:", res.data.messages?.length || 0);
    return res.data.messages || [];
  } catch (err) {
    console.error("❌ Lỗi khi gọi gmail.users.messages.list:", err);
    return [];
  }
};

const extractBodyAndAttachments = async (
  parts,
  messageId,
  attachments = []
) => {
  let bodyData = "";
  for (const part of parts) {
    if (part.parts) {
      const nested = await extractBodyAndAttachments(
        part.parts,
        messageId,
        attachments
      );
      if (!bodyData && nested.bodyData) bodyData = nested.bodyData;
    } else {
      if (
        (part.mimeType === "text/plain" || part.mimeType === "text/html") &&
        part.body?.data
      ) {
        if (!bodyData) bodyData = part.body.data;
      }
      if (part.filename && part.body?.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: part.body.attachmentId,
          auth: oauth2Client,
        });
        attachments.push({
          filename: part.filename,
          content: Buffer.from(attachment.data.data, "base64"),
          contentType: part.mimeType,
        });
      }
    }
  }
  return { bodyData, attachments };
};

const getEmailContent = async (messageId) => {
  console.log("👉 Đã vào get EmailContent");
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
    auth: oauth2Client,
  });

  const payload = msg.data.payload;
  const headers = payload.headers || [];
  const subject = headers.find((h) => h.name === "Subject")?.value || "";
  const attachments = [];
  const { bodyData } = await extractBodyAndAttachments(
    [payload],
    messageId,
    attachments
  );

  if (!bodyData) {
    console.warn(`⚠️ Không tìm thấy nội dung trong message ${messageId}`);
    return { subject, body: "", patientEmail: null, attachments };
  }

  const decodedBody = Buffer.from(bodyData, "base64").toString("utf-8");
  const emailMatch = decodedBody.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/
  );
  const patientEmail = emailMatch ? emailMatch[0] : null;

  return { subject, body: decodedBody, patientEmail, attachments };
};

const forwardEmail = async (to, subject, originalBody, attachments = []) => {
  try {
    const { token: accessToken } = await oauth2Client.getAccessToken();

    if (!accessToken) {
      throw new Error("❌ Không thể lấy accessToken từ Google OAuth2");
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "tanhuynhatnguyen.2003@gmail.com",
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        refreshToken: oauth2Client.credentials.refresh_token,
        accessToken: accessToken,
      },
    });

    await transporter.sendMail({
      from: "Santafe Health <tanhuynhatnguyen.2003@gmail.com>",
      to,
      subject: "Santafe Health Clinic - Kết quả của bạn",
      text: `Đây là email được chuyển tiếp tự động:\n\n${originalBody
        .replace(/đây là saleForce/gi, "")
        .trim()}`,
      attachments,
    });

    console.log(
      `✅ Đã gửi tới ${to} kèm đính kèm (${attachments.length} file).`
    );
  } catch (err) {
    console.error("❌ Gặp lỗi khi gửi mail:", err);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
    // Có thể gửi email cho bạn hoặc log ra
    console.log(`🔁 Token hết hạn. Vui lòng đăng nhập lại tại: ${authUrl}`);

    // Hoặc nếu có 1 email admin, bạn có thể gửi thẳng link tới họ
    await sendNotificationToAdmin(authUrl);
  }
};

// Scopes – bạn có thể thay đổi theo mục đích
const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const sendNotificationToAdmin = async (authUrl) => {
  // 👉 Nếu lỗi do token hết hạn, gửi email hoặc log link đăng nhập mới
  console.log("Bắt đầu gửi mail...");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.NOTIFY_EMAIL,
      pass: process.env.NOTIFY_PASSWORD, // dùng app password nếu 2FA
    },
  });

  await transporter.sendMail({
    from: `"Santafe Bot" <${process.env.NOTIFY_EMAIL}>`,
    // from: `"Santafe Bot" <tanhuynhatnguyen.2003@gmail.com>`,
    to: "tanhuynhatnguyen.2003@gmail.com",
    subject: "🔒 Token Google hết hạn",
    html: `Token đã hết hạn. Vui lòng đăng nhập lại bằng link sau: <br><a href="${authUrl}">${authUrl}</a>`,
  });

  console.log("📧 Đã gửi email thông báo token hết hạn.");
};

const ensureLabelExists = async (labelName) => {
  const res = await gmail.users.labels.list({
    userId: "me",
    auth: oauth2Client,
  });
  const existingLabel = res.data.labels.find((l) => l.name === labelName);
  if (existingLabel) return existingLabel.id;

  const newLabel = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
    auth: oauth2Client,
  });

  return newLabel.data.id;
};

const addLabelToMessage = async (messageId, labelId) => {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
    auth: oauth2Client,
  });
};

const checkAndNotifyIfNoToken = async () => {
  const refreshToken = oauth2Client.credentials.refresh_token;

  if (!refreshToken) {
    // const authUrl = oauth2Client.generateAuthUrl({
    //   access_type: "offline",
    //   scope: SCOPES,
    // });
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });

    console.warn("⚠️ Không có refresh token. Gửi email yêu cầu đăng nhập lại.");
    await sendNotificationToAdmin(authUrl);
    throw new Error("❌ Thiếu refresh token. Dừng xử lý.");
  }
};

const main = async () => {
  console.log("👉 Đã vào main()");
  await checkAndNotifyIfNoToken();

  const labelId = await ensureLabelExists("ForwardedByBot");
  const messages = await getRecentMessages();
  if (messages.length === 0)
    return console.log("📭 Không có email nào phù hợp.");

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      auth: oauth2Client,
    });

    if ((detail.data.labelIds || []).includes(labelId)) continue;

    const { subject, body, patientEmail, attachments } = await getEmailContent(
      msg.id
    );
    if (patientEmail) {
      await forwardEmail(patientEmail, subject, body, attachments);
      await addLabelToMessage(msg.id, labelId);
    } else {
      console.log(`⚠️ Không tìm thấy email bệnh nhân trong message ${msg.id}`);
    }
  }
};

// app.get("/auth", (req, res) => {
//   const url = oauth2Client.generateAuthUrl({
//     access_type: "offline",
//     scope: SCOPES,
//     prompt: "consent",
//   });

//   res.redirect(url);
// });

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ Không tìm thấy mã code.");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveToken(tokens);

    res.send("✅ Lấy token thành công! Bạn có thể đóng tab này.");
    console.log("📦 Đã lưu token:", tokens);
  } catch (err) {
    console.error("❌ Lỗi khi lấy token:", err);
    res.send("Lỗi khi lấy token.");
  }
});

// cron.schedule("*/5 * * * *", async () => {
//   console.log("⏰ [CRON] Kiểm tra và forward email...");
//   try {
//     await main();
//   } catch (err) {
//     console.error("❌ Lỗi khi chạy CRON:", err);
//     const authUrl = oauth2Client.generateAuthUrl({
//       access_type: "offline",
//       scope: SCOPES,
//       prompt: "consent",
//     });
//     await sendNotificationToAdmin(authUrl);
//   }
// });

app.get("/run-cron", async (req, res) => {
  try {
    await main();
    res.send("✅ Cron đã chạy thành công");
  } catch (error) {
    console.error("❌ Lỗi khi chạy CRON:", err);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
    await sendNotificationToAdmin(authUrl);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Express đang chạy tại http://localhost:${PORT}`);
});
