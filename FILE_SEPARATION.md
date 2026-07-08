# File separation — Main VPS vs Regional VPS

## Main VPS:

```
mkdir -p main-vps && cp main.js db.js regions.example.js tokens.example.js setup-main.sh main-vps/
```

## Regional:

```
mkdir -p RoyalVPN && cd RoyalVPN
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/setup.sh && chmod +x setup.sh
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/tls.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/keys.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/doh-server.js && chmod +x admin-api.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/admin-api.js && chmod +x admin-api.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/manage-keys.js && chmod +x manage-keys.js
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/test-dns.sh && chmod +x test-dns.sh
wget https://raw.githubusercontent.com/arkh91/RoyalDNS_bot/refs/heads/main/test-dns.js && chmod +x test-dns.js
```

## Reference — every file, accounted for

| File | Main VPS | Regional VPS |
|---|---|---|
| `main.js` | ✅ | ❌ ignore |
| `db.js` | ✅ (local bookkeeping only) | ❌ ignore |
| `setup-main.sh` | ✅ | ❌ ignore |
| `regions.example.js` → copy to `regions.js` | ✅ | ❌ ignore |
| `tokens.example.js` → copy to `tokens.js` | ✅ | ❌ ignore |
| `callbacks.json` (created by hand, not a template file) | ✅ | ❌ ignore |
| `setup.sh` | ❌ ignore | ✅ |
| `tls.js` | ❌ ignore | ✅ |
| `keys.js` | ❌ ignore | ✅ |
| `doh-server.js` | ❌ ignore | ✅ |
| `admin-api.js` | ❌ ignore | ✅ |
| `manage-keys.js` | ❌ ignore | ✅ |
| `test/test-dns.sh` | ❌ ignore | ✅ |
| `test/test-dns.js` | ❌ ignore | ✅ |
| `ANDROID_SETUP.md` | ❌ ignore | ✅ |
| `README.md` | reference only — not deployed to either server | reference only |
| `FILE_SEPARATION.md` (this file) | reference only — not deployed to either server | reference only |

That's every file currently in the project — 16 files total, plus the 3
that get created from templates or from scratch (`regions.js`, `tokens.js`,
`callbacks.json`), which only exist on the main VPS.

## Notes

- `regions.js`, `tokens.js`, and `callbacks.json` aren't copied by the
  command above since they don't exist yet as real files — they're created
  from templates (`regions.example.js`, `tokens.example.js`) or from
  scratch (`callbacks.json`), each holding secrets/config specific to your
  setup. See `README.md` for the exact commands to create them inside
  `main-vps/`.
- `db.js` lives only on the main VPS. It used to be a regional file (talking
  to a shared remote database); regional servers have no database at all
  now — `keys.js` there reads/writes a local JSON file instead.
- `README.md` and this file are documentation for you, not files that get
  uploaded to a server at all.
