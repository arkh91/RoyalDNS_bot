#!/usr/bin/env bash
# -----------------------------------------------------------------------------
#  setup.sh  -  Royal DNS server provisioning
# -----------------------------------------------------------------------------
#
#  Run this ONCE on a fresh REGIONAL Ubuntu server (root or sudo) — NOT the
#  main VPS running the Telegram bot, which uses setup-main.sh instead.
#  Deploys tls.js / keys.js / doh-server.js / admin-api.js. Asks for your
#  domain and two ports (DoH + admin API), then installs everything and
#  gets the box ready to serve DoH and issue/revoke keys via a bearer-
#  token-protected API. No database anywhere on this server — keys live
#  in a local JSON file (see keys.js); the only database in this whole
#  system is on the main VPS, purely for its own bookkeeping. Generated
#  keys look like:
#    https://dns.royalgaming.com:11111/a1A10A4qQmNCh3GgcL0e2w
#  which is what you hand to Intra (Android) users. Windows/iPhone/Mac
#  clients are a separate step - come back to this once Android works.
#
#  Usage: sudo ./setup.sh
# -----------------------------------------------------------------------------

set -euo pipefail

ENV_FILE=".env"

# -----------------------------------------------------------------------------
# Usage: verifies tls.js, keys.js, and doh-server.js exist in the current
# directory before doing anything else. request_certificate() later calls
# `require('./tls')`, which resolves relative to the current working
# directory — if these files aren't sitting right next to setup.sh, that
# step fails with a confusing "Cannot find module" error instead of this
# clear one. Exits immediately if anything is missing.
#
#   check_required_files
# -----------------------------------------------------------------------------
check_required_files() {
    local missing=()
    for f in tls.js keys.js doh-server.js admin-api.js; do
        [ -f "$f" ] || missing+=("$f")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        echo "ERROR: missing required file(s) in $(pwd): ${missing[*]}"
        echo "setup.sh must be run from the same folder as tls.js/keys.js/doh-server.js."
        echo "Copy/upload the whole project folder to the server first, then re-run this script from inside it."
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Usage: prints a message in a consistent "step" style so the script's output
# is easy to scan. Called throughout this file - not meant to be run alone.
#
#   step "Installing Node.js"
# -----------------------------------------------------------------------------
step() {
    echo -e "\n\033[1;36m==> $1\033[0m"
}

# -----------------------------------------------------------------------------
# Usage: validates a string is a plausible FQDN (labels of letters/digits/
# hyphens, dots between, valid TLD length). Returns 0 (true) if valid.
# Rejects bare IPs, trailing dots, and single-label names like "localhost".
#
#   if is_valid_domain "dns.royalgaming.com"; then echo ok; fi
# -----------------------------------------------------------------------------
is_valid_domain() {
    local domain="$1"
    [[ "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]
}

# -----------------------------------------------------------------------------
# Usage: prompts for a domain, re-asking until is_valid_domain passes, and
# warns (non-fatal) if it doesn't currently resolve to this server. Sets the
# global DOMAIN variable.
#
#   prompt_for_domain
#   echo "Using: $DOMAIN"
# -----------------------------------------------------------------------------
prompt_for_domain() {
    while true; do
        read -rp "Enter the domain for your DNS server (e.g. dns.royalgaming.com): " DOMAIN
        if is_valid_domain "$DOMAIN"; then
            break
        fi
        echo "Not a valid domain: '$DOMAIN'. Try again (no http://, no trailing dot)."
    done

    step "Checking DNS for $DOMAIN"
    local server_ip resolved_ip
    server_ip=$(curl -s -4 https://ifconfig.me || echo "unknown")
    resolved_ip=$(dig +short A "$DOMAIN" | tail -n1 || echo "")

    if [ -z "$resolved_ip" ]; then
        echo "WARNING: $DOMAIN does not resolve yet. Point an A record at ${server_ip} before requesting a certificate."
    elif [ "$resolved_ip" != "$server_ip" ]; then
        echo "WARNING: $DOMAIN currently resolves to ${resolved_ip}, but this server is ${server_ip}."
        echo "   Certificate issuance may fail until DNS is updated (allow time to propagate)."
    else
        echo "OK: $DOMAIN correctly points to this server (${server_ip})"
    fi

    read -rp "Continue with '$DOMAIN' anyway? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
}

# -----------------------------------------------------------------------------
# Usage: prompts for the port the DoH service will listen on. This is the
# port that ends up in the generated key URL, e.g. the "11111" in
# https://dns.royalgaming.com:11111/<key>. Sets the global DOH_PORT variable.
#
#   prompt_for_port
# -----------------------------------------------------------------------------
prompt_for_port() {
    read -rp "Port for the DoH service [11111]: " DOH_PORT
    DOH_PORT=${DOH_PORT:-11111}
    if ! [[ "$DOH_PORT" =~ ^[0-9]+$ ]] || (( DOH_PORT < 1 || DOH_PORT > 65535 )); then
        echo "Invalid port, defaulting to 11111"
        DOH_PORT=11111
    fi
}

# -----------------------------------------------------------------------------
# Usage: prompts for the port the admin API (create/remove keys remotely)
# will listen on. Must differ from DOH_PORT since both bind on this same
# host. Sets the global ADMIN_PORT variable.
#
#   prompt_for_admin_port
# -----------------------------------------------------------------------------
prompt_for_admin_port() {
    while true; do
        read -rp "Port for the admin API [9443]: " ADMIN_PORT
        ADMIN_PORT=${ADMIN_PORT:-9443}
        if ! [[ "$ADMIN_PORT" =~ ^[0-9]+$ ]] || (( ADMIN_PORT < 1 || ADMIN_PORT > 65535 )); then
            echo "Invalid port, try again."
            continue
        fi
        if [ "$ADMIN_PORT" = "$DOH_PORT" ]; then
            echo "Admin port can't be the same as the DoH port (${DOH_PORT}). Try again."
            continue
        fi
        break
    done
}

# -----------------------------------------------------------------------------
# Usage: generates a random 64-character bearer token for the admin API and
# stores it in the global ADMIN_TOKEN variable. This is the only credential
# the main VPS needs to create/remove keys on this server remotely — treat
# it like a password.
#
#   generate_admin_token
# -----------------------------------------------------------------------------
generate_admin_token() {
    ADMIN_TOKEN=$(openssl rand -hex 32)
}

# -----------------------------------------------------------------------------
# Usage: writes all collected values to .env (chmod 600). tls.js/keys.js/
# doh-server.js all load this via require('dotenv').config() - edit later
# with `vi .env` if anything changes. No DB_* values at all — this server
# has no database, keys live in a local JSON file (see keys.js).
#
#   write_env_file
# -----------------------------------------------------------------------------
write_env_file() {
    step "Writing $ENV_FILE"
    cat > "$ENV_FILE" <<EOF
DNS_DOMAIN=${DOMAIN}
DOH_PORT=${DOH_PORT}
ADMIN_PORT=${ADMIN_PORT}
ADMIN_TOKEN=${ADMIN_TOKEN}
EOF
    chmod 600 "$ENV_FILE"
    echo "Wrote $ENV_FILE (permissions locked to 600)"
    echo "Review/edit anytime with: vi $ENV_FILE"
}

# -----------------------------------------------------------------------------
# Usage: installs Node.js 20 LTS + system packages this project needs
# (build tools for native modules, dnsutils/knot-dnsutils for testing, ufw
# for the firewall step). No MySQL at all — this server has no database,
# keys live in a local JSON file. Idempotent - safe to re-run.
#
#   install_system_packages
# -----------------------------------------------------------------------------
install_system_packages() {
    step "Installing system packages"
    apt-get update -y
    apt-get install -y curl dnsutils knot-dnsutils ufw build-essential vim

    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
    echo "Node $(node -v), npm $(npm -v)"
}

# -----------------------------------------------------------------------------
# Usage: installs the npm packages this project's modules require. Run from
# the project root (where package.json lives, or will be created).
#
#   install_node_packages
# -----------------------------------------------------------------------------
install_node_packages() {
    step "Installing npm packages"
    [ -f package.json ] || npm init -y > /dev/null
    npm install express https axios acme-client dotenv
    echo "Node packages installed"
}

# -----------------------------------------------------------------------------
# Usage: opens the firewall ports this server needs and enables ufw. Port 80
# is only used transiently during certificate issuance/renewal (the http-01
# challenge), not for serving traffic day-to-day.
#
#   configure_firewall
# -----------------------------------------------------------------------------
configure_firewall() {
    step "Configuring firewall (ufw)"
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow "${DOH_PORT}/tcp"
    ufw allow "${ADMIN_PORT}/tcp"
    ufw --force enable
    echo "Firewall rules applied: 22, 80, ${DOH_PORT}, ${ADMIN_PORT} open"
}

# -----------------------------------------------------------------------------
# Usage: requests the initial TLS certificate by invoking tls.js directly.
# Requires DNS_DOMAIN to already be in .env, and for the domain to actually
# resolve to this server (checked earlier).
#
#   request_certificate
# -----------------------------------------------------------------------------
request_certificate() {
    step "Requesting TLS certificate for $DOMAIN (this can take ~30-60s)"
    node -e "require('dotenv').config(); require('./tls').ensureCertificate().then(() => console.log('Certificate ready')).catch(e => { console.error('Error:', e.message); process.exit(1); })"
}

# -----------------------------------------------------------------------------
# Usage: installs a systemd timer that checks/renews the certificate daily.
# Regular (non-wildcard) Let's Encrypt certs last 90 days, so daily checks
# give a comfortable margin — ensureCertificate() only actually renews once
# the cert is within 14 days of expiry.
#
#   install_renewal_timer
# -----------------------------------------------------------------------------
install_renewal_timer() {
    step "Installing certificate renewal timer (daily check)"
    local project_dir
    project_dir=$(pwd)

    cat > /etc/systemd/system/royaldns-renew.service <<EOF
[Unit]
Description=Renew Royal DNS certificate if needed

[Service]
Type=oneshot
WorkingDirectory=${project_dir}
EnvironmentFile=${project_dir}/.env
ExecStart=$(command -v node) -e "require('./tls').ensureCertificate().then(() => console.log('checked'))"
ExecStartPost=/bin/systemctl restart royaldns-server
EOF

    cat > /etc/systemd/system/royaldns-renew.timer <<EOF
[Unit]
Description=Run royaldns-renew daily

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=1800
Persistent=true

[Install]
WantedBy=timers.target
EOF

    systemctl daemon-reload
    systemctl enable --now royaldns-renew.timer
    echo "Renewal timer installed: checks daily at 03:00, renews when within 14 days of expiry"
}

# -----------------------------------------------------------------------------
# Usage: writes and enables systemd services for the DoH server and the
# Telegram bot, so both survive reboots and crashes (Restart=always).
#
#   install_systemd_services
# -----------------------------------------------------------------------------
install_systemd_services() {
    step "Installing systemd services"
    local project_dir
    project_dir=$(pwd)

    cat > /etc/systemd/system/royaldns-server.service <<EOF
[Unit]
Description=Royal DNS DoH server
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${project_dir}
ExecStart=$(command -v node) doh-server.js
Restart=always
EnvironmentFile=${project_dir}/.env

[Install]
WantedBy=multi-user.target
EOF

    # NOTE ON RUNNING AS ROOT: since this project lives in /root (mode 700
    # by default), a dedicated non-root service user couldn't read these
    # files without either loosening /root's permissions or moving the
    # project to a shared path like /opt/royaldns. Both are real hardening
    # options worth doing before this is customer-facing at scale — this
    # script doesn't do it automatically so it doesn't silently change your
    # server layout. Ask if you want that migration done.
    cat > /etc/systemd/system/royaldns-admin.service <<EOF
[Unit]
Description=Royal DNS admin API (remote key create/remove)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${project_dir}
ExecStart=$(command -v node) admin-api.js
Restart=always
EnvironmentFile=${project_dir}/.env

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now royaldns-server royaldns-admin
    echo "Services enabled: royaldns-server, royaldns-admin"
    echo "Check status with: systemctl status royaldns-server"
}

# -----------------------------------------------------------------------------
# Main entry point - runs every step in order. Comment out steps you've
# already done if you need to re-run part of this (e.g. after adding DNS).
# -----------------------------------------------------------------------------
main() {
    step "Royal DNS server setup"
    check_required_files
    prompt_for_domain
    prompt_for_port
    prompt_for_admin_port
    generate_admin_token
    write_env_file
    install_system_packages
    install_node_packages
    configure_firewall
    request_certificate
    install_systemd_services
    install_renewal_timer

    print_summary_banner
}

# -----------------------------------------------------------------------------
# Usage: prints the final install summary — domain, ports, admin token, ready
# -to-run curl examples, and where to find logs. Called once at the very end
# of main(). Not meant to be called standalone (relies on globals set by the
# prompt_for_* functions above).
# -----------------------------------------------------------------------------
print_summary_banner() {
    local line
    line=$(printf '═%.0s' {1..79})

    echo
    echo "$line"
    echo " ROYAL DNS SERVER INSTALLED"
    echo "$line"
    echo
    echo "Domain:            https://${DOMAIN}"
    echo "DoH port:          ${DOH_PORT}   (customer key URLs use this)"
    echo "Admin API port:    ${ADMIN_PORT}"
    echo "Bearer Token:      ${ADMIN_TOKEN}"
    echo
    echo "Create a key (example):"
    echo "  curl -X POST https://${DOMAIN}:${ADMIN_PORT}/create \\"
    echo "    -H \"Authorization: Bearer ${ADMIN_TOKEN}\" \\"
    echo "    -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"telegramId\": 123456789, \"days\": 30}'"
    echo
    echo "Remove a key (example):"
    echo "  curl -X POST https://${DOMAIN}:${ADMIN_PORT}/remove \\"
    echo "    -H \"Authorization: Bearer ${ADMIN_TOKEN}\" \\"
    echo "    -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"key\": \"a1A10A4qQmNCh3GgcL0e2w\"}'"
    echo
    echo "List keys (example):"
    echo "  curl https://${DOMAIN}:${ADMIN_PORT}/list \\"
    echo "    -H \"Authorization: Bearer ${ADMIN_TOKEN}\""
    echo
    echo "Test the DoH server:"
    echo "  ./test/test-dns.sh ${DOMAIN} ${DOH_PORT} <a-valid-key>"
    echo
    echo "Logs:"
    echo "  DoH server:  journalctl -u royaldns-server -f"
    echo "  Admin API:   journalctl -u royaldns-admin -f"
    echo
    echo "Security notes:"
    echo "  - Keep the bearer token secret — it's the only thing gating /create and /remove"
    echo "  - HTTPS is automatic via Let's Encrypt (auto-renews daily, see royaldns-renew.timer)"
    echo "  - Both services currently run as root (see the note above install_systemd_services"
    echo "    in this script for why, and how to change it)"
    echo "  - This server has NO database of any kind — keys live in ./data/keys-data.json"
    echo "  - This script is for REGIONAL servers only — the bot goes on the main VPS via"
    echo "    setup-main.sh instead, and doesn't belong here"
    echo "  - Edit config anytime with: vi ${ENV_FILE}"
    echo
    echo "$line"
}

main
