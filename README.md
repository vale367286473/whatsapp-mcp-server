# WhatsApp MCP Server

> **Vuoi installarlo? Condividi questo link con Claude Code e di':**
> *"Installa il WhatsApp MCP da https://github.com/vale367286473/whatsapp-mcp-server e configuralo"*
> Claude leggerà questo README e completerà tutto il setup automaticamente.

Server MCP per controllare WhatsApp Web da Claude Code.
Basato su [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) — simula WhatsApp Web via Puppeteer. Solo per uso personale/test.

---

## Requisiti

- Node.js 18+
- Google Chrome installato
- Account WhatsApp attivo

---

## Setup

### 1. Clona la repo e installa le dipendenze

```bash
git clone https://github.com/vale367286473/whatsapp-mcp-server
cd whatsapp-mcp-server
npm install
```

### 2. Registra il server in Claude Code

**macOS / Linux:**
```bash
claude mcp add whatsapp -s user -- node "/percorso/assoluto/whatsapp-mcp-server/src/index.js"
```

**Windows:**
```powershell
claude mcp add whatsapp -s user -- node "C:\percorso\whatsapp-mcp-server\src\index.js"
```

Sostituisci il percorso con la posizione reale della cartella sul tuo sistema.

### 3. Prima autenticazione (QR code — solo la prima volta)

Il server non può mostrare il QR dentro Claude Code, quindi avvialo una volta manualmente:

```bash
node src/index.js
```

Apri WhatsApp sul telefono → **Impostazioni → Dispositivi collegati → Collega un dispositivo** → scansiona il QR.

Quando vedi `🟢 WhatsApp pronto!` puoi chiudere con `Ctrl+C`.
La sessione è salvata in `.wwebjs_auth/` — non dovrai ripetere il QR.

### 4. Riavvia Claude Code

Da questo momento il server parte automaticamente ad ogni avvio di Claude Code.

---

## Tool disponibili

| Tool | Tipo | Descrizione |
|------|------|-------------|
| `whatsapp_get_status` | Lettura | Stato connessione e info account |
| `whatsapp_get_chats` | Lettura | Lista chat recenti con anteprima |
| `whatsapp_get_messages` | Lettura | Messaggi di una chat specifica |
| `whatsapp_send_message` | Scrittura | Invia a contatto esistente per nome |
| `whatsapp_send_to_number` | Scrittura | Invia a qualsiasi numero internazionale |
| `whatsapp_search_contact` | Lettura | Cerca contatto in rubrica |
| `whatsapp_delete_message` | Scrittura | Elimina un messaggio inviato |

---

## Esempi d'uso in Claude Code

```
"Mostrami le ultime 10 chat"
"Leggi gli ultimi messaggi di Marco"
"Manda un messaggio a Luca che sono in ritardo"
"Invia un messaggio al +39 333 1234567"
"Cerca il numero di Sara nella rubrica"
"Elimina l'ultimo messaggio che ho mandato a Luca"
```

---

## Struttura del progetto

```
whatsapp-mcp-server/
├── src/
│   └── index.js        # Server MCP con tutti i tool
├── package.json
└── README.md
```

---

## Note tecniche

- Trasporto: **stdio** (standard per MCP locale)
- La sessione WhatsApp è salvata in `.wwebjs_auth/` (esclusa da git)
- Il server pulisce automaticamente i lock file di Chrome all'avvio — nessun problema su riavvii bruschi
- I log di debug vanno su `stderr` (non interferisce con il protocollo MCP)
- WhatsApp non supporta sessioni web multiple simultanee

---

## Avvertenze

Questo progetto usa `whatsapp-web.js` che simula WhatsApp Web tramite browser headless — non è un'API ufficiale WhatsApp. Usalo solo su account personali e per scopi legittimi.
