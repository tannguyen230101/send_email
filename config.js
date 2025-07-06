require("dotenv").config();

const Configs ={
    port: process.env.PORT,
    gmailApi: process.env.GMAIL_API,
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectURI: process.env.REDIRECT_URI,
    server: process.env.SERVER,
    notifyEmail: process.env.NOTIFY_EMAIL,
    notifyPassword: process.env.NOTIFY_PASSWORD,
    receiveEmail: process.env.RECEIVE_EMAIL,
    outlookEmail: process.env.OUTLOOK_EMAIL,
    outlookPassword: process.env.OUTLOOK_PASSWORD,

    tenantID: process.env.TENANT_ID,
    appID: process.env.APP_ID,
    objectID: process.env.OBJECT_ID,
    valueSecret: process.env.VALUE_SECRET,
    saleForceEmail: process.env.SALEFORCE_EMAIL,
}

module.exports = Configs;