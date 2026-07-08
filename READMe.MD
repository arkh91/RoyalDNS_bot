# Royal DNS — regional server files

This is the complete, current set of files needed to stand up **one regional
DNS VPS** (DoH server + local key management, no Telegram bot). The bot
(`main.js`) is included too, but only runs on the **main VPS** — see the note
at the bottom.

## Files

| File | Purpose |
|---|---|
| `setup.sh` | Run once on a fresh Ubuntu server. Asks for domain + two ports (DoH, admin API), installs Node/MySQL/deps, opens the firewall, requests the TLS cert, and installs systemd services + a daily renewal timer. Prints a summary banner with the admin token and ready-to-run curl examples. |
| `tls.js` | Issues/renews a single-hostname Let's Encrypt certificate (HTTP-01, no wildcard needed). |
| `keys.js` | `createKey` / `removeKey` / `isKeyValid` / `listKeys` / `purgeExpiredKeys` — the core key lifecycle, backed by MySQL. |
| `doh-server.js` | The actual DoH listener. Every customer hits `https://yourdomain:port/<key>` — the key in the path is what authorizes them. |
| `admin-api.js` | Bearer-token-protected HTTP API (`/create`, `/remove`, `/list`) for the main VPS to manage keys on this server remotely, instead of SSHing in. |
| `db.js` | Thin MySQL pool wrapper matching what `keys.js` expects. |
| `manage-keys.js` | CLI to create/remove/list keys locally on this VPS — useful for testing, or if you'd rather not go through the API. |
| `main.js` | The Telegram bot. **Only runs on the main VPS**, not on regional servers. |
| `tokens.example.js` | Template for `tokens.js` (holds the real bot token — never share the real one). |
| `test/test-dns.sh`, `test/test-dns.js` | Smoke tests: cert validity, key rejection/acceptance, latency. |
| `ANDROID_SETUP.md` | What to send Android/Intra users, and why there's no true one-tap link. |

## Deploying a new regional VPS

```
# 1. Copy every file above onto the fresh server (same directory, e.g. /root)
# 2. Make your own tokens.js and callbacks.json if this box will ever run the bot —
#    skip both if it's regional-only (doh-server + manage-keys don't need them)
cp tokens.example.js tokens.js   # only if running the bot here
vi tokens.js                     # paste the real token, only if running the bot here
echo '{"callbackToServer": {}, "callbackToInternationalServer": {}}' > callbacks.json  # same

# 3. Run setup
chmod +x setup.sh
sudo ./setup.sh
# → asks for domain, port, MySQL creds
# → installs everything, opens firewall, gets a cert, starts royaldns-server

# 4. If this box should NOT run the bot (regional servers), stop it:
systemctl stop royaldns-bot
systemctl disable royaldns-bot

# 5. Test
node manage-keys.js create <telegram-id> 30
./test/test-dns.sh <domain> <port> <the-key-from-step-5>
```

## Main VPS vs. regional VPS

- **Regional VPS** (this set, minus the bot): runs `royaldns-server`
  (`doh-server.js`) and `royaldns-admin` (`admin-api.js`). `royaldns-bot`
  should be stopped/disabled here.
- **Main VPS**: runs `royaldns-bot` (`main.js`), which is what customers talk
  to on Telegram. To issue/revoke a key on a specific regional server, the
  bot calls that server's admin API — e.g. when the bot's country-selection
  step picks "Germany", it calls the German regional VPS's `/create`
  endpoint with the bearer token for that server. Each regional server has
  its own token (from its own `setup.sh` run) — the main VPS needs to keep a
  small mapping of `country → { domain, port, token }` to know which server
  to call. That mapping isn't built yet; it lives wherever `main.js` decides
  which regional server a customer's chosen country maps to.

## Admin API reference

All three endpoints require `Authorization: Bearer <token>` (from the setup
banner or `.env`'s `ADMIN_TOKEN`), except `/health`.

```
POST /create   { "telegramId": 123456789, "days": 30 }   → { key, expiresAt, dohUrl }
POST /remove   { "key": "...", "hard": false }           → { removed: true, key, hard }
GET  /list                                                → [{ key_value, telegram_id, expires_at, status, ... }]
GET  /health                                              → { status: "ok" }  (no auth needed)
```

`/remove` returns HTTP 404 (not a silent 200) if the key doesn't exist, so
the calling bot can tell "revoked" from "already gone".


# File separation — Main VPS vs Regional VPS

## Main VPS:

```
mkdir -p main-vps && cp main.js regions.example.js tokens.example.js setup-main.sh main-vps/
```

## Regional:

```
mkdir -p regional && cp tls.js keys.js doh-server.js admin-api.js db.js manage-keys.js setup.sh ANDROID_SETUP.md regional/ && cp -r test regional/
```

## Reference

| File | Main VPS | Regional VPS |
|---|---|---|
| `main.js` | ✅ | ❌ ignore |
| `regions.js` (new, below) | ✅ | ❌ ignore |
| `tokens.js` | ✅ | ❌ ignore |
| `callbacks.json` | ✅ | ❌ ignore |
| `tls.js`, `keys.js`, `doh-server.js`, `admin-api.js`, `db.js` | ❌ ignore | ✅ |
| `manage-keys.js` | ❌ ignore | ✅ |
| `setup.sh`, `test/*` | ❌ ignore | ✅ |

Note: `regions.js`, `tokens.js`, and `callbacks.json` aren't copied by the
command above since they don't exist yet as real files — they're created
from templates (`regions.example.js`, `tokens.example.js`) or from scratch
(`callbacks.json`), each holding secrets/config specific to your setup. See
`README.md` for the exact commands to create them inside `main-vps/`.
