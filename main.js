import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import http from "http";

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WOLFE BOT IS ACTIVE 24/7!\n");
}).listen(PORT, () => {
    console.log("🌍 Auto ping server inasikiliza kwenye port " + PORT);
});

setInterval(() => {
    const appUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT;
    http.get(appUrl, (res) => {
        console.log("ping: Status Code " + res.statusCode + " - Bot ipo macho!");
    }).on("error", (err) => {});
}, 600000);

async function startBot() {
    if (!fs.existsSync("wolfe_session")) {
        fs.mkdirSync("wolfe_session", { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState("wolfe_session");
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered && process.env.TARGET_PHONE_NUMBER) {
        const phoneNumber = process.env.TARGET_PHONE_NUMBER.replace(/[^0-9]/g, "");
        setTimeout(async () => {
            try {
                console.log("Inaomba Pairing Code kutoka WhatsApp...");
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n========================================");
                console.log("📌 PAIRING CODE YAKO HAPA: " + code);
                console.log("========================================\n");
            } catch (err) {
                console.error("Imeshindwa kuomba Pairing Code:", err);
            }
        }, 8000);
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log("✅ Bot imeunganishwa mafanikio na WhatsApp!");
        } else if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log("Connection imefungwa. Status:", statusCode, "Kuunganisha tena...", shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        if (m.key && m.key.remoteJid === "status@broadcast") {
            try {
                await sock.readMessages([m.key]);
                await sock.sendMessage("status@broadcast", { 
                    react: { text: "💜", key: m.key } 
                }, { statusJidList: [m.key.participant] });
            } catch (e) {}
        }
    });
}

startBot();
