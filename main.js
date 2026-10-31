import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OWNER_NUMBER = '255658178812';
const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`;
const PREFIX = '!';
const ROOT = process.cwd();
const AUTH_DIR = path.join(ROOT, 'auth');
const DATA_DIR = path.join(ROOT, 'data');

// WOLFE_RENDER_HEALTH_SERVER
const PORT = Number(process.env.PORT || 10000);

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'WOLFE BOT ACTIVE' }));
}).listen(PORT, '0.0.0.0', () => {
  console.log('WOLFE HTTP SERVER listening on port ' + PORT);
});

if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(async () => {
    try {
      const response = await fetch(
        new URL('/health', process.env.RENDER_EXTERNAL_URL),
        { signal: AbortSignal.timeout(15000) }
      );
      console.log('WOLFE AUTO-PING:', response.status);
    } catch (error) {
      console.log('AUTO-PING ERROR:', error.message);
    }
  }, 5 * 60 * 1000);

  console.log('WOLFE AUTO-PING: every 5 minutes');
}
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const readJSON = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJSON = (file, data) => {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
};

let clients = readJSON(CLIENTS_FILE, []);
let state = readJSON(STATE_FILE, {
  autoview: true,
  autoreact: true,
  emoji: '💜',
  viewed: [],
  reacted: []
});

if (!Array.isArray(clients)) clients = [];
if (!Array.isArray(state.viewed)) state.viewed = [];
if (!Array.isArray(state.reacted)) state.reacted = [];

const sockets = new Map();
const starting = new Set();
const removed = new Set();
const messageCache = new Map();
const typingTimers = new Map(); // WOLFE_INSTANT_TYPING_60S

const log = pino({ level: 'silent' });

function normalizeNumber(input) {
  let number = String(input || '').replace(/\D/g, '');

  if (number.startsWith('0')) {
    number = '255' + number.slice(1);
  }

  return number;
}

function saveState() {
  writeJSON(STATE_FILE, state);
}

function rememberMessage(msg) {
  const key = msg.key;
  if (!key?.id || key.remoteJid === 'status@broadcast') return;

  const body = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption;

  if (!body) return;

  const cacheKey = `${key.remoteJid}:${key.id}`;
  messageCache.set(cacheKey, {
    body,
    chat: key.remoteJid,
    sender: key.participant || key.remoteJid,
    time: Date.now()
  });

  while (messageCache.size > 1000) {
    messageCache.delete(messageCache.keys().next().value);
  }
}

async function handleStatus(sock, msg, isOwner) {
  if (!isOwner || msg.key.remoteJid !== 'status@broadcast') return;

  const key = msg.key;
  if (!key.id) return;

  const statusId = `${key.participant || ''}:${key.id}`;

  if (state.autoview && !state.viewed.includes(statusId)) {
    try {
      await sock.readMessages([key]);
      state.viewed.push(statusId);
      state.viewed = state.viewed.slice(-5000);
      saveState();
    } catch (error) {
      console.error('Status view failed:', error.message);
    }
  }

  if (state.autoreact && !state.reacted.includes(statusId)) {
    try {
      await sock.sendMessage('status@broadcast', {
        react: {
          text: state.emoji || '💜',
          key
        }
      });

      state.reacted.push(statusId);
      state.reacted = state.reacted.slice(-5000);
      saveState();
    } catch (error) {
      console.error('Status reaction failed:', error.message);
    }
  }
}

async function handleOwnerCommand(sock, msg, text) {
  const chat = msg.key.remoteJid;
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  const reply = async (body) => {
    await sock.sendMessage(chat, { text: body });
  };

  switch (command) {
    case '!help':
      return reply(
`👑 WOLFE TZ BOT

!alive — Bot status
!status — Settings
!autoview on/off — Auto-view
!autoreact on/off — Auto-react
!setemoji 💜 — Reaction emoji
!addclient 255XXXXXXXXX — Add client
!clients — List clients
!delclient 255XXXXXXXXX — Remove client

Owner: ${OWNER_NUMBER}`
      );

    case '!alive':
      return reply('🟢 WOLFE TZ BOT ONLINE\nOwner controls active.');

    case '!status':
      return reply(
`🟢 WOLFE TZ BOT
Owner: ${OWNER_NUMBER}
Auto-view: ${state.autoview ? 'ON' : 'OFF'}
Auto-react: ${state.autoreact ? 'ON' : 'OFF'}
Emoji: ${state.emoji}
Clients: ${clients.length}`
      );

    case '!autoview': {
      const value = args[0]?.toLowerCase();
      if (!['on', 'off'].includes(value)) {
        return reply('Tumia: !autoview on au !autoview off');
      }
      state.autoview = value === 'on';
      saveState();
      return reply(`👁️ Auto-view ${value.toUpperCase()}`);
    }

    case '!autoreact': {
      const value = args[0]?.toLowerCase();
      if (!['on', 'off'].includes(value)) {
        return reply('Tumia: !autoreact on au !autoreact off');
      }
      state.autoreact = value === 'on';
      saveState();
      return reply(`💜 Auto-react ${value.toUpperCase()}`);
    }

    case '!setemoji': {
      const emoji = args[0];
      if (!emoji || emoji.length > 16) {
        return reply('Tumia: !setemoji 💜');
      }
      state.emoji = emoji;
      saveState();
      return reply(`Reaction emoji imewekwa: ${emoji}`);
    }

    case '!clients':
      return reply(
        clients.length
          ? '👥 REGISTERED CLIENTS\n' +
            clients.map((n, i) => `${i + 1}. ${n}`).join('\n')
          : 'Hakuna clients bado. Tumia !addclient 255XXXXXXXXX'
      );

    case '!addclient': {
      const number = normalizeNumber(args[0]);

      if (!number || number.length < 10 || number.length > 15) {
        return reply('Tumia: !addclient 255XXXXXXXXX');
      }

      if (number === OWNER_NUMBER) {
        return reply('Hiyo ni namba ya owner tayari.');
      }

      if (clients.includes(number)) {
        return reply(`Client ${number} tayari yupo.`);
      }

      clients.push(number);
      writeJSON(CLIENTS_FILE, clients);
      removed.delete(number);

      await reply(
`✅ Client ${number} ameongezwa.
Aunganishe akaunti yake mwenyewe kwa pairing code itakayoonekana kwenye terminal.
Usishiriki code hiyo na mtu mwingine.`
      );

      startSocket(number, true);
      return;
    }

    case '!delclient': {
      const number = normalizeNumber(args[0]);

      if (!clients.includes(number)) {
        return reply('Client huyo hajapatikana. Tumia !clients');
      }

      clients = clients.filter(n => n !== number);
      writeJSON(CLIENTS_FILE, clients);
      removed.add(number);

      const socket = sockets.get(number);
      if (socket) {
        sockets.delete(number);
        try {
          socket.end();
        } catch {}
      }

      return reply(
`🗑️ Client ${number} ameondolewa kwenye list na kusimamishwa.
Auth files zimehifadhiwa kwenye kifaa hiki; zifute mwenyewe tu ukiamua kutenganisha session kabisa.`
      );
    }

    default:
      return reply('Command haijatambulika. Tumia !help');
  }
}

async function startSocket(id, isOwner = false) {
  if (starting.has(id) || sockets.has(id)) return;
  if (!isOwner && !clients.includes(id)) return;
  if (removed.has(id)) return;

  starting.add(id);

  try {
    const authPath = isOwner
      ? path.join(AUTH_DIR, 'owner')
      : path.join(AUTH_DIR, `client-${id}`);

    fs.mkdirSync(authPath, { recursive: true });

    const { state: authState, saveCreds } =
      await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
      auth: authState,
      logger: log,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });

    sockets.set(id, sock);

    sock.ev.on('creds.update', saveCreds);

    let ownerPairingRequested = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr && isOwner && !authState.creds.registered && !ownerPairingRequested) {
        ownerPairingRequested = true;
        console.log('👑 WOLFE: WhatsApp pairing is ready. Requesting owner code...');
        setTimeout(async () => {
          if (sockets.get(id) !== sock || authState.creds.registered) return;
          try {
            const code = await sock.requestPairingCode(OWNER_NUMBER);
            console.log('\n🔐 OWNER PAIRING CODE: ' + code);
            console.log('WhatsApp > Linked devices > Link a device > Link with phone number.\n');
          } catch (error) {
            console.error('Owner pairing code failed:', error.message);
          }
        }, 1000);
      }

      if (connection === 'open') {
        console.log(`🟢 ${isOwner ? 'OWNER' : 'CLIENT ' + id} ONLINE`);
      }

      if (connection === 'close') {
        if (sockets.get(id) === sock) sockets.delete(id);

        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        console.log(
          `🔴 ${isOwner ? 'OWNER' : 'CLIENT ' + id} DISCONNECTED (${code ?? 'unknown'})`
        );

        if (loggedOut) {
          console.log('Session ime-logout (401). Imesimamisha reconnect ya moja kwa moja; unganisha upya kwa pairing baada ya kuthibitisha hali ya WhatsApp.');
        } else if (!removed.has(id) &&
            (isOwner || clients.includes(id))) {
          setTimeout(() => startSocket(id, isOwner), 10000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || !msg.key) continue;

        // WOLFE_INSTANT_TYPING_60S
        const chatJid = msg.key.remoteJid;
        if (msg.key.fromMe !== true && chatJid !== "status@broadcast" && !msg.message.protocolMessage) {
          const typingKey = id + ":" + chatJid;
          try { await sock.sendPresenceUpdate("composing", chatJid); } catch {}
          const previousTimer = typingTimers.get(typingKey);
          if (previousTimer) clearTimeout(previousTimer);
          const timer = setTimeout(async () => {
            try {
              if (sockets.get(id) === sock) await sock.sendPresenceUpdate("paused", chatJid);
            } catch {}
            typingTimers.delete(typingKey);
          }, 60000);
          timer.unref();
          typingTimers.set(typingKey, timer);
        }
        await handleStatus(sock, msg, isOwner).catch(() => {});
        rememberMessage(msg);

        const protocol = msg.message.protocolMessage;
        if (protocol?.type === 0 && isOwner) {
          const deletedKey = protocol.key;
          const cached = deletedKey?.id
            ? messageCache.get(`${deletedKey.remoteJid}:${deletedKey.id}`)
            : null;

          if (cached) {
            try {
              await sock.sendMessage(OWNER_JID, {
                text:
`🗑️ MESSAGE DELETED
Chat: ${cached.chat}
Sender: ${cached.sender}
Content: ${cached.body}`
              });
              messageCache.delete(
                `${deletedKey.remoteJid}:${deletedKey.id}`
              );
            } catch {}
          }
          continue;
        }

        if (!isOwner) continue;

        const remoteJid = msg.key.remoteJid;
        const senderJid = msg.key.participant || remoteJid;
        // Owner commands may arrive using a linked-device/LID identity.
        const fromOwner = msg.key.fromMe === true ||
          senderJid === OWNER_JID;

        if (!fromOwner || remoteJid === 'status@broadcast') continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';

        if (!text.startsWith(PREFIX)) continue;

        try {
          await handleOwnerCommand(sock, msg, text);
        } catch (error) {
          console.error('Command error:', error.message);
          try {
            await sock.sendMessage(remoteJid, {
              text: '❌ Command imeshindwa. Angalia terminal logs.'
            });
          } catch {}
        }
      }
    });

    if (!authState.creds.registered && !isOwner) {
      setTimeout(async () => {
        if (sockets.get(id) !== sock || removed.has(id)) return;

        try {
          const code = await sock.requestPairingCode(id);
          console.log(`\n🔐 PAIRING CODE FOR CLIENT ${id}: ${code}\n`);
        } catch (error) {
          console.error(
            `Pairing code failed for ${id}: ${error.message}`
          );
        }
      }, 2500);
    }
  } catch (error) {
    sockets.delete(id);
    console.error(`Failed to start ${id}:`, error.message);

    if (isOwner || clients.includes(id)) {
      setTimeout(() => startSocket(id, isOwner), 8000);
    }
  } finally {
    starting.delete(id);
  }
}

console.log('====================================');
console.log('       WOLFE TZ BOT STARTING');
console.log(`       OWNER: ${OWNER_NUMBER}`);
console.log('====================================');

await startSocket(OWNER_NUMBER, true);

for (const number of clients) {
  await startSocket(number, false);
}
