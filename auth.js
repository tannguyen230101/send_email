const express = require("express");
const fs = require("fs");
const open = (...args) => import("open").then((mod) => mod.default(...args));
const path = require("path");
const app = express();
const PORT = 8080;
require("dotenv").config();
const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const saveToken = (token) => {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
};

const TOKEN_PATH = path.join(__dirname, "token.json");

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // để lấy refresh_token
    scope: SCOPES,
    prompt: "consent", // luôn hiện lại màn hình cho phép
  });

  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;

  if (!code) return res.send("Không tìm thấy code");

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveToken(tokens);
    // 👉 Lưu token ra file
    fs.writeFileSync(
      path.join(__dirname, "token.json"),
      JSON.stringify(tokens)
    );

    console.log("\n📌 Access Token:", tokens.access_token);
    console.log("🔁 Refresh Token:", tokens.refresh_token);
    console.log(
      "🕓 Expiry Date:",
      new Date(tokens.expiry_date).toLocaleString()
    );

    res.send("✅ Đăng nhập thành công! Token đã được lưu.");
  } catch (err) {
    console.error("❌ Lỗi khi lấy token:", err);
    res.send("Lỗi khi lấy token, xem terminal để biết thêm chi tiết.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  console.log(`➡️ Mở trình duyệt: http://localhost:${PORT}/auth`);
  // open(`http://localhost:${PORT}/auth`);
});
