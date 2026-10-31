import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false
    };

    if (!sock.authState.creds.registered && process.env.TARGET_PHONE_NUMBER) {
        const phoneNumber = process.env.TARGET_PHONE_NUMBER.replace(/[^0-9]/g, "");
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n========================================");
                console.log("📌 PAIRING CODE YAKO HAPA: " + code);
                console.log("========================================\n");
            } catch (err) {
                console.error("Imeshindwa kuomba Pairing Code:", err);
            }
        }, 3000);
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log("✅ Bot imeunganishwa mafanikio na WhatsApp!");
        } else if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection imefungwa. Kuunganisha tena...", shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("creds.update", saveCreds);
}

startBot();
