const express = require("express");
const { Client } = require("@microsoft/microsoft-graph-client");
const dotenv = require("dotenv");
const axios = require("axios");
dotenv.config();
const fs = require("fs");
const path = require("path");
const Configs = require("./config");
const nodemailer = require("nodemailer");

const TOKEN_PATH = path.join(__dirname, "ms_token.json");

const saveToken = (token) => {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
};

const loadToken = () => {
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  }
  return null;
};

const app = express();

let accessToken = null;
let refreshToken = null;

// Đọc token từ file khi khởi động
if (fs.existsSync(TOKEN_PATH)) {
  //   const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  const tokenData = loadToken();
  accessToken = tokenData.access_token;
  refreshToken = tokenData.refresh_token;
}

const getAuthUrl = () => {
  const params = new URLSearchParams({
    client_id: Configs.appID,
    response_type: "code",
    redirect_uri: Configs.redirectURI,
    response_mode: "query",
    scope: ["offline_access", "Mail.ReadWrite", "Mail.Send"].join(" "),
  });
  return `https://login.microsoftonline.com/${Configs.tenantID}/oauth2/v2.0/authorize?${params}`;
};

const getTokenFromCode = async (code) => {
  const res = await axios.post(
    `https://login.microsoftonline.com/${Configs.tenantID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: Configs.appID,
      client_secret: Configs.valueSecret,
      code,
      redirect_uri: Configs.redirectURI,
      grant_type: "authorization_code",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  accessToken = res.data.access_token;
  refreshToken = res.data.refresh_token;
};

const refreshAccessToken = async () => {
  if (!refreshToken) {
    await sendNotificationToAdmin();
    throw new Error("❌ Chưa có refresh token.");
  }

  const res = await axios.post(
    `https://login.microsoftonline.com/${Configs.tenantID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: Configs.appID,
      client_secret: Configs.valueSecret,
      refresh_token: refreshToken,
      redirect_uri: Configs.redirectURI,
      grant_type: "refresh_token",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  accessToken = res.data.access_token;
  refreshToken = res.data.refresh_token;

  // ✅ Ghi lại token mới
  //   fs.writeFileSync(
  //     TOKEN_PATH,
  //     JSON.stringify(
  //       {
  //         access_token: accessToken,
  //         refresh_token: refreshToken,
  //       },
  //       null,
  //       2
  //     )
  //   );
  saveToken({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  console.log("🔄 Đã làm mới access token thành công.");
};

const getGraphClient = async () => {
  if (!accessToken) throw new Error("⚠️ Chưa có access token");
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
};

const getEmails = async () => {
  const client = await getGraphClient();
  const res = await client
    .api("/me/mailFolders/Inbox/messages")
    .select("id,subject,body,from,receivedDateTime,hasAttachments")
    .orderby("receivedDateTime desc")
    .top(25)
    .get();

  const emails = res.value.filter(
    (email) =>
      email.from?.emailAddress?.address.toLowerCase() ===
      `${Configs.saleForceEmail}`
  );

  return emails.slice(0, 10);
};


const getAttachments = async (messageId) => {
  const client = await getGraphClient();
  const res = await client.api(`/me/messages/${messageId}/attachments`).get();

  // Chỉ lấy loại file (không lấy attachment dạng item như email embedded)
  return res.value
    .filter((att) => att["@odata.type"] === "#microsoft.graph.fileAttachment")
    .map((att) => ({
      name: att.name,
      contentBytes: att.contentBytes,
      contentType: att.contentType,
    }));
};

const createLabelIfNotExist = async () => {
  const client = await getGraphClient();
  const folders = await client.api(`/me/mailFolders`).get();

  const existing = folders.value.find(
    (f) => f.displayName === "ForwardedByBot"
  );
  if (existing) return existing.id;

  const created = await client.api(`/me/mailFolders`).post({
    displayName: "ForwardedByBot",
  });

  return created.id;
};

const moveEmailToLabel = async (messageId, folderId) => {
  const client = await getGraphClient();
  await client
    .api(`/me/messages/${messageId}/move`)
    .post({ destinationId: folderId });
};

const extractEmail = (content) => {
  const match = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : null;
};

const forwardEmail = async (to, subject, bodyText, attachments = []) => {
  const client = await getGraphClient();

  await client.api(`/me/sendMail`).post({
    message: {
      subject: `Santafe Health Clinic - ${subject}`,
      body: {
        contentType: "HTML",
        content: bodyText,
      },
      toRecipients: [{ emailAddress: { address: to } }],
      attachments: attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.name,
        contentBytes: att.contentBytes,
        contentType: att.contentType,
      })),
    },
  });
};

app.get("/auth", (req, res) => {
  const authUrl = getAuthUrl();
  //   console.log("🔗 Redirect URI:", REDIRECT_URI);
  //   console.log("📎 Auth URL:", getAuthUrl());
  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  try {
    await getTokenFromCode(code);
    fs.writeFileSync(
      TOKEN_PATH,
      JSON.stringify(
        {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        null,
        2
      )
    );
    res.send("✅ Đăng nhập thành công. Bạn có thể chạy /run-cron");
  } catch (err) {
    console.error("❌ Lỗi khi lấy token:", err);
    res.send("Lỗi khi lấy token.");
  }
});

app.get("/run-cron", (req, res) => {
  res.send("⏳ Cron đang chạy nền...");

  setTimeout(async () => {
    try {
      if (!accessToken) await refreshAccessToken();

      const labelId = await createLabelIfNotExist();
      const emails = await getEmails();

      for (const email of emails) {
        const content = email.body.content || "";
        const patientEmail = extractEmail(content);

        if (patientEmail) {
          const attachments = email.hasAttachments
            ? await getAttachments(email.id)
            : [];

          await forwardEmail(patientEmail, email.subject, content, attachments);
          await moveEmailToLabel(email.id, labelId);
          console.log(`✅ Đã forward và chuyển thư: ${email.subject}`);
        } else {
          console.log(`⚠️ Không tìm thấy email bệnh nhân: ${email.subject}`);
        }
      }

      console.log("✅ Cron xử lý xong.");
    } catch (err) {
      console.error("❌ Lỗi khi chạy cron:", err.message);
      await sendNotificationToAdmin();
    }
  }, 100); // chạy async sau 100ms
});


const sendNotificationToAdmin = async () => {
  // 👉 Nếu lỗi do token hết hạn, gửi email hoặc log link đăng nhập mới
  console.log("Bắt đầu gửi mail...");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: Configs.notifyEmail,
      pass: Configs.notifyPassword, // dùng app password nếu 2FA
    },
  });

  await transporter.sendMail({
    from: `"Santafe Bot" <${Configs.notifyEmail}>`,
    to: `${Configs.outlookEmail}`,
    subject: "🔒 [Santafe] Yêu cầu xác thực lại Outlook Token",
    html: `<p>Chào bạn,</p>
<p>Token Outlook của hệ thống đã hết hạn hoặc bị lỗi.</p>
<p>Vui lòng xác thực lại bằng cách nhấn vào liên kết dưới đây:</p>
<p><a href="${Configs.server}/auth">${Configs.server}/auth</a></p>
<p>Trân trọng,<br>Hệ thống Santafe Bot</p>`,
  });

  console.log("📧 Đã gửi email thông báo token hết hạn.");
};

app.listen(3000, () => {
  // console.log("🚀 Server đang chạy tại http://localhost:3000");
  res.send("✅ Server đang chạy. Đã deploy version mới.");
});
