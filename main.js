import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import Boom from "@hapi/boom";
import fs from "fs";
import http from "http";
import readline from "readline";

const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("WOLFE TZ BOT IS ACTIVE 24/7 ✅\n");
}).listen(PORT, () => {
    console.log(`WOLFE health server listening on port ${PORT}`);
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session");

    const sock = makeWASocket({
        auth: state,
        browser: ["Chrome (Linux)", "Chrome", "120.0.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        getMessage: async (key) => ({
            conversation: "WOLFE TZ BOT ACTIVE"
        })
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
        // Tunasubiri sekunde 5 ili seva ikae sawa kabla ya kuomba pairing code
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const phoneNumber = await askQuestion("Weka namba yako ya WhatsApp (mfano 2556XXXXXXXX): ");
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\n📌 NAMBA YAKO YA KUPAIR (PAIRING CODE): ${code}\n`);
    }

    const messageStore = new Map();

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            if (!msg.message) continue;
            messageStore.set(msg.key.id, msg);

            const remoteJid = msg.key.remoteJid;
            const pushName = msg.pushName || "Mtumiaji";
            const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

            if (remoteJid && !remoteJid.endsWith("@g.us") && remoteJid !== "status@broadcast") {
                await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
            }

            if (remoteJid === "status@broadcast") {
                try {
                    await sock.readMessages([msg.key]);
                    await sock.sendMessage(remoteJid, {
                        react: {
                            text: "💜",
                            key: msg.key
                        }
                    });
                } catch (e) {}
                continue;
            }

            if (textMessage.toLowerCase() === ".menu" || textMessage.toLowerCase() === "!menu") {
                const menuText = `╭━━━〔 *WOLFE TZ BOT MENU* 〕━━━╮\n┃\n┃  👋 Habari, *${pushName}*!\n┃  🤖 Bot yako iko hewani 24/7.\n┃\n┃  ⚙️ *FEATURES ZILIZOWASHWA:*\n┃  ✅ *Anti-Delete*\n┃  👀 *Auto Status View*\n┃  💜 *Auto Status React*\n┃  ✍️ *Auto Typing Indicator*\n┃  🌐 *Auto-Ping Server*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`;
                await sock.sendMessage(remoteJid, { text: menuText }, { quoted: msg });
            }
        }
    });

    sock.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            if (update.update && update.update.message === null) {
                const deletedMsg = messageStore.get(update.key.id);
                if (deletedMsg) {
                    const sender = deletedMsg.pushName || "Mtu fulani";
                    const content = deletedMsg.message.conversation || deletedMsg.message.extendedTextMessage?.text || "Media/File";
                    
                    const alertText = `🚨 *ANTI-DELETE DETECTED* 🚨\n\n👤 *Imefutwa na:* ${sender}\n💬 *Ujumbe ulikuwa:* ${content}`;
                    await sock.sendMessage("255658178812@s.whatsapp.net", { text: alertText });
                }
            }
        }
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const statusCode = (lastDisconnect?.error instanceof Boom.Boom) ? lastDisconnect.error.output.statusCode : null;
            console.log(`Connection imefungwa. Code: ${statusCode}`);
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                fs.rmSync("session", { recursive: true, force: true });
            }
            startBot();
        } else if (connection === "open") {
            console.log("✅ WOLFE TZ BOT IMESHEHESHWA FEATURES ZOTE NA PORT 10000!");
            rl.close();
        }
    });
}

startBot();
