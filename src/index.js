import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";
import { z } from "zod";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDataPath = path.join(__dirname, "..", ".wwebjs_auth");

// Rimuovi tutti i lock file di Chrome rimasti da sessioni precedenti
function cleanLocks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanLocks(full);
    } else if (["lockfile", "LOCK", "SingletonLock", "SingletonCookie", "DevToolsActivePort"].includes(entry.name)) {
      try { fs.unlinkSync(full); } catch {}
    }
  }
}
cleanLocks(path.join(authDataPath, "session"));

// ─────────────────────────────────────────────
// WhatsApp Client Setup
// ─────────────────────────────────────────────

const waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: authDataPath }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

let isReady = false;

waClient.on("qr", (qr) => {
  // Il QR viene stampato nel terminale — scansionalo con WhatsApp
  process.stderr.write("\n📱 Scansiona il QR con WhatsApp > Dispositivi collegati:\n\n");
  qrcode.generate(qr, { small: true }, (code) => {
    process.stderr.write(code + "\n");
  });
});

waClient.on("authenticated", () => {
  process.stderr.write("✅ Autenticato! La sessione verrà salvata.\n");
});

waClient.on("ready", () => {
  isReady = true;
  process.stderr.write("🟢 WhatsApp pronto!\n");
});

waClient.on("disconnected", (reason) => {
  isReady = false;
  process.stderr.write(`🔴 Disconnesso: ${reason}\n`);
});

waClient.initialize();

// ─────────────────────────────────────────────
// Helper: controlla se il client è pronto
// ─────────────────────────────────────────────

function checkReady() {
  if (!isReady) {
    throw new Error(
      "WhatsApp non ancora connesso. Aspetta che il client sia pronto (scansiona il QR se è il primo avvio)."
    );
  }
}

function errorResponse(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `❌ Errore: ${msg}` }] };
}

// ─────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────

const server = new McpServer({
  name: "whatsapp-mcp-server",
  version: "1.0.0",
});

// ── TOOL: stato connessione ──────────────────
server.registerTool(
  "whatsapp_get_status",
  {
    title: "Stato WhatsApp",
    description: "Restituisce lo stato della connessione WhatsApp e info sull'account collegato.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => {
    if (!isReady) {
      return {
        content: [{ type: "text", text: "🔴 WhatsApp non connesso. Avvia il server e scansiona il QR." }],
      };
    }
    try {
      const info = waClient.info;
      const text = `🟢 Connesso\n👤 Nome: ${info.pushname}\n📱 Numero: ${info.wid.user}\n📲 Piattaforma: ${info.platform}`;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: lista chat ─────────────────────────
server.registerTool(
  "whatsapp_get_chats",
  {
    title: "Lista Chat",
    description: `Restituisce le chat recenti di WhatsApp con nome, ultimo messaggio e timestamp.
    
Utile per capire con chi parlare prima di inviare messaggi.
Restituisce un massimo di N chat (default 20).`,
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("Numero massimo di chat da restituire"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ limit }) => {
    try {
      checkReady();
      const chats = await waClient.getChats();
      const sliced = chats.slice(0, limit ?? 20);

      const lines = sliced.map((chat, i) => {
        const ts = chat.lastMessage
          ? new Date(chat.lastMessage.timestamp * 1000).toLocaleString("it-IT")
          : "—";
        const preview = chat.lastMessage?.body?.slice(0, 60) ?? "(nessun messaggio)";
        return `${i + 1}. ${chat.name}\n   📅 ${ts}\n   💬 ${preview}`;
      });

      return {
        content: [{ type: "text", text: `📋 Ultime ${sliced.length} chat:\n\n${lines.join("\n\n")}` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: leggi messaggi ─────────────────────
server.registerTool(
  "whatsapp_get_messages",
  {
    title: "Leggi Messaggi",
    description: `Legge i messaggi recenti di una chat specifica cercandola per nome contatto o numero.

Args:
  - contact_name: nome del contatto o parte di esso (es. "Marco", "Raul")
  - limit: quanti messaggi leggere (default 20)

Restituisce mittente, testo e timestamp di ogni messaggio.`,
    inputSchema: {
      contact_name: z.string().min(1).describe("Nome del contatto o numero di telefono (es. +39...)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Numero di messaggi da leggere"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ contact_name, limit }) => {
    try {
      checkReady();
      const chats = await waClient.getChats();
      const chat = chats.find(
        (c) =>
          c.name.toLowerCase().includes(contact_name.toLowerCase()) ||
          c.id.user.includes(contact_name.replace(/\D/g, ""))
      );

      if (!chat) {
        return {
          content: [{ type: "text", text: `❌ Nessuna chat trovata per "${contact_name}". Usa whatsapp_get_chats per vedere le chat disponibili.` }],
        };
      }

      const messages = await chat.fetchMessages({ limit: limit ?? 20 });

      const lines = messages.map((msg) => {
        const ts = new Date(msg.timestamp * 1000).toLocaleString("it-IT");
        const who = msg.fromMe ? "Tu" : chat.name;
        const body = msg.body || "(media/allegato)";
        return `[${ts}] ${who}: ${body}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `💬 Ultimi ${messages.length} messaggi con ${chat.name}:\n\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: invia messaggio ────────────────────
server.registerTool(
  "whatsapp_send_message",
  {
    title: "Invia Messaggio",
    description: `Invia un messaggio WhatsApp a un contatto cercandolo per nome.

ATTENZIONE: questo tool invia un messaggio reale. Usarlo con cautela.

Args:
  - contact_name: nome del contatto (deve già essere in una chat esistente)
  - message: testo del messaggio da inviare

Restituisce conferma di invio con timestamp.`,
    inputSchema: {
      contact_name: z.string().min(1).describe("Nome del contatto (deve esistere nella lista chat)"),
      message: z.string().min(1).max(4096).describe("Testo del messaggio da inviare"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ contact_name, message }) => {
    try {
      checkReady();
      const chats = await waClient.getChats();
      const chat = chats.find((c) =>
        c.name.toLowerCase().includes(contact_name.toLowerCase())
      );

      if (!chat) {
        return {
          content: [{ type: "text", text: `❌ Contatto "${contact_name}" non trovato. Usa whatsapp_get_chats per vedere le chat disponibili.` }],
        };
      }

      await chat.sendMessage(message);
      const ts = new Date().toLocaleString("it-IT");

      return {
        content: [{ type: "text", text: `✅ Messaggio inviato a ${chat.name} alle ${ts}:\n"${message}"` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: cerca contatto ─────────────────────
server.registerTool(
  "whatsapp_search_contact",
  {
    title: "Cerca Contatto",
    description: `Cerca un contatto nella rubrica WhatsApp per nome o numero.

Restituisce nome, numero e se è registrato su WhatsApp.`,
    inputSchema: {
      query: z.string().min(1).describe("Nome o numero da cercare"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ query }) => {
    try {
      checkReady();
      const contacts = await waClient.getContacts();
      const results = contacts.filter(
        (c) =>
          c.name?.toLowerCase().includes(query.toLowerCase()) ||
          c.number?.includes(query.replace(/\D/g, ""))
      );

      if (!results.length) {
        return {
          content: [{ type: "text", text: `❌ Nessun contatto trovato per "${query}".` }],
        };
      }

      const lines = results.slice(0, 10).map((c) => {
        const wa = c.isWAContact ? "✅ Su WhatsApp" : "❌ Non su WhatsApp";
        return `👤 ${c.name || "(senza nome)"} — +${c.number} — ${wa}`;
      });

      return {
        content: [{ type: "text", text: `🔍 Risultati per "${query}":\n\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: invia messaggio a numero ──────────
server.registerTool(
  "whatsapp_send_to_number",
  {
    title: "Invia a Numero",
    description: `Invia un messaggio WhatsApp a un numero di telefono specifico (anche se non è in rubrica).

Args:
  - phone: numero internazionale senza + (es. "393751234567" per +39 375 123 4567)
  - message: testo del messaggio

Utile per contatti non salvati in rubrica.`,
    inputSchema: {
      phone: z.string().regex(/^\d{7,15}$/, "Inserisci solo cifre, senza + (es. 393751234567)").describe("Numero internazionale senza + (es. 393751234567)"),
      message: z.string().min(1).max(4096).describe("Testo del messaggio"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ phone, message }) => {
    try {
      checkReady();
      const chatId = `${phone}@c.us`;
      await waClient.sendMessage(chatId, message);
      const ts = new Date().toLocaleString("it-IT");

      return {
        content: [{ type: "text", text: `✅ Messaggio inviato a +${phone} alle ${ts}:\n"${message}"` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ── TOOL: elimina messaggio ──────────────────
server.registerTool(
  "whatsapp_delete_message",
  {
    title: "Elimina Messaggio",
    description: `Elimina un messaggio inviato da te in una chat WhatsApp.

Per default elimina l'ultimo messaggio che hai inviato al contatto.
Puoi specificare una parte del testo per eliminare un messaggio specifico.

Args:
  - contact_name: nome del contatto o chat
  - message_preview: (opzionale) parte del testo del messaggio da eliminare
  - for_everyone: se true elimina per tutti, se false solo per te (default: true)`,
    inputSchema: {
      contact_name: z.string().min(1).describe("Nome del contatto"),
      message_preview: z.string().optional().describe("Parte del testo del messaggio da eliminare (opzionale, default: ultimo messaggio inviato)"),
      for_everyone: z.boolean().default(true).describe("Elimina per tutti (true) o solo per te (false)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async ({ contact_name, message_preview, for_everyone }) => {
    try {
      checkReady();
      const chats = await waClient.getChats();
      const chat = chats.find((c) =>
        c.name.toLowerCase().includes(contact_name.toLowerCase()) ||
        c.id.user.includes(contact_name.replace(/\D/g, ""))
      );

      if (!chat) {
        return {
          content: [{ type: "text", text: `❌ Chat "${contact_name}" non trovata.` }],
        };
      }

      const messages = await chat.fetchMessages({ limit: 50 });
      const sentMessages = messages.filter((m) => m.fromMe);

      if (!sentMessages.length) {
        return {
          content: [{ type: "text", text: `❌ Nessun messaggio inviato da te trovato in questa chat.` }],
        };
      }

      let target;
      if (message_preview) {
        target = sentMessages.reverse().find((m) =>
          m.body.toLowerCase().includes(message_preview.toLowerCase())
        );
        if (!target) {
          return {
            content: [{ type: "text", text: `❌ Nessun messaggio trovato con il testo "${message_preview}".` }],
          };
        }
      } else {
        target = sentMessages[sentMessages.length - 1];
      }

      await target.delete(for_everyone ?? true);
      const scope = (for_everyone ?? true) ? "per tutti" : "solo per te";

      return {
        content: [{ type: "text", text: `🗑️ Messaggio eliminato ${scope}:\n"${target.body}"` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// ─────────────────────────────────────────────
// Avvio server MCP via stdio
// ─────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("🚀 WhatsApp MCP Server avviato (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`❌ Errore fatale: ${err.message}\n`);
  process.exit(1);
});
