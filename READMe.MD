Royal DNS — server files

There are two roles, each with its own setup script and its own set of
files. Don't mix them onto the same box unless you really mean to.

No regional server has a database of any kind. Keys live in a local
JSON file on each regional server (fast, zero database attack surface, and
fine given DNS query volume here). The only database in the whole
system is a local MySQL instance on the main VPS — and even that one never
accepts a connection from anywhere but itself; it's purely a bookkeeping
record of every key ever issued, not what decides whether a key is valid
right now.

Regional DNS server (one per country/location)

Run setup.sh here. Files it needs:

FilePurposesetup.shRun once. Asks for domain + two ports (DoH, admin API), installs Node/deps (no MySQL), opens the firewall, requests the TLS cert, installs royaldns-server + royaldns-admin systemd services + a daily renewal timer.tls.jsIssues/renews a single-hostname Let's Encrypt certificate (HTTP-01, no wildcard needed).keys.jscreateKey / removeKey / isKeyValid / listKeys / purgeExpiredKeys — reads/writes a local JSON file (./data/keys-data.json). No database. Writes are serialized in-process to avoid lost updates from concurrent requests.doh-server.jsThe actual DoH listener. Every customer hits https://yourdomain:port/<key> — the key in the path is what authorizes them, checked against the local file on every query.admin-api.jsBearer-token-protected HTTP API (/create, /remove, /list) that the main VPS calls remotely.manage-keys.jsCLI to create/remove/list keys locally on this VPS — same file, same functions admin-api.js uses, just from the command line.test/test-dns.sh, test/test-dns.jsSmoke tests: cert validity, key rejection/acceptance, latency.ANDROID_SETUP.mdWhat to send Android/Intra users, and why there's no true one-tap link.

Ignore on a regional server: main.js, setup-main.sh, db.js, tokens.js/tokens.example.js, callbacks.json, regions.js/regions.example.js.

Main VPS (one, runs the bot)

Run setup-main.sh here instead. Files it needs:

FilePurposesetup-main.shRun once. Installs Node + the packages main.js/db.js need, AND a local-only MySQL for bookkeeping. Never opens a firewall port for it — nothing outside this box ever needs to reach it.main.jsThe Telegram bot. Calls each regional server's admin-api.js over HTTPS to actually create/remove keys, then logs the result into the local bookkeeping DB.db.jsMySQL wrapper for the local issued_keys bookkeeping table (support/audit records — not what enforces key validity).tokens.example.js → copy to tokens.jsHolds the real Telegram bot token. Never share the real one.regions.example.js → copy to regions.jsMaps each country button (speed_ger, speed_usa, etc.) to that regional server's { domain, adminPort, adminToken }. Fill in one entry per regional server you've actually set up — anything left out just makes the bot tell customers that country is "temporarily unavailable" instead of crashing.callbacks.jsonMinimum viable: {"callbackToServer": {}, "callbackToInternationalServer": {}}.

Ignore on the main VPS: setup.sh, tls.js, keys.js, doh-server.js, admin-api.js, manage-keys.js, test/*.

Deploying the main VPS

# 1. Copy the main-VPS files (see table above) onto the fresh server
cp tokens.example.js tokens.js
vi tokens.js       # paste your real Telegram bot token
cp regions.example.js regions.js
vi regions.js      # fill in as you add regional servers below
echo '{"callbackToServer": {}, "callbackToInternationalServer": {}}' > callbacks.json

# 2. Run setup
chmod +x setup-main.sh
sudo ./setup-main.sh

# 3. Test
journalctl -u royaldns-bot -f

Deploying a new regional VPS

# 1. Copy the regional files (see table above) onto the fresh server
chmod +x setup.sh
sudo ./setup.sh
# → asks for domain and two ports only — no database questions at all
# → installs everything, opens firewall, gets a cert, starts both services
# → prints a banner with the admin token

# 2. Copy this server's domain/adminPort/adminToken from its banner into
#    the main VPS's regions.js (under the right country key), then restart
#    the bot: systemctl restart royaldns-bot

# 3. Test
node manage-keys.js create <telegram-id> 30
./test/test-dns.sh <domain> <doh-port> <the-key-from-step-3>

Admin API reference (regional servers)

All endpoints require Authorization: Bearer <token> (from that server's
setup banner or .env's ADMIN_TOKEN), except /health.

POST /create   { "telegramId": 123456789, "days": 30 }   → { key, expiresAt, dohUrl }
POST /remove   { "key": "...", "hard": false }           → { removed: true, key, hard }
GET  /list                                                → [{ key_value, telegram_id, expires_at, status, ... }]
GET  /health                                              → { status: "ok" }  (no auth needed)

/remove returns HTTP 404 (not a silent 200) if the key doesn't exist, so
the calling bot can tell "revoked" from "already gone".


# File separation — Main VPS vs Regional VPS

## Main VPS:

```
mkdir -p main-vps && cp main.js regions.example.js tokens.example.js setup-main.sh main-vps/
```

## Regional:

```
mkdir -p RoyalVPN && cd RoyalVPN
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/tls.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/keys.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/doh-server.js

tls.js, keys.js, doh-server.js, admin-api.js, db.js	❌ ignore	✅
manage-keys.js	❌ ignore	✅
setup.sh, test/*

```

Reference — every file, accounted for

FileMain VPSRegional VPSmain.js✅❌ ignoredb.js✅ (local bookkeeping only)❌ ignoresetup-main.sh✅❌ ignoreregions.example.js → copy to regions.js✅❌ ignoretokens.example.js → copy to tokens.js✅❌ ignorecallbacks.json (created by hand, not a template file)✅❌ ignoresetup.sh❌ ignore✅tls.js❌ ignore✅keys.js❌ ignore✅doh-server.js❌ ignore✅admin-api.js❌ ignore✅manage-keys.js❌ ignore✅test/test-dns.sh❌ ignore✅test/test-dns.js❌ ignore✅ANDROID_SETUP.md❌ ignore✅README.mdreference only — not deployed to either serverreference onlyFILE_SEPARATION.md (this file)reference only — not deployed to either serverreference only

That's every file currently in the project — 16 files total, plus the 3
that get created from templates or from scratch (regions.js, tokens.js,
callbacks.json), which only exist on the main VPS.

Notes


regions.js, tokens.js, and callbacks.json aren't copied by the
command above since they don't exist yet as real files — they're created
from templates (regions.example.js, tokens.example.js) or from
scratch (callbacks.json), each holding secrets/config specific to your
setup. See README.md for the exact commands to create them inside
main-vps/.
db.js lives only on the main VPS. It used to be a regional file (talking
to a shared remote database); regional servers have no database at all
now — keys.js there reads/writes a local JSON file instead.
README.md and this file are documentation for you, not files that get
uploaded to a server at all.
