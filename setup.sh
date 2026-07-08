#!/usr/bin/env bash
# -----------------------------------------------------------------------------
#  setup.sh  -  Royal DNS server provisioning
# -----------------------------------------------------------------------------
#
#  Run this ONCE on a fresh Ubuntu server (root or sudo) before deploying
#  tls.js / keys.js / doh-server.js. Asks for your domain and a port, then
#  installs everything and gets the box ready to serve DoH and issue/revoke
#  keys. Generated keys look like:
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
    for f in tls.js keys.js doh-server.js; do
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
# Usage: prompts for MySQL connection details used by db.js/keys.js.
# Leaves password entry hidden from terminal echo.
#
#   prompt_for_mysql
# -----------------------------------------------------------------------------
prompt_for_mysql() {
    step "MySQL connection details"
    read -rp "MySQL host [127.0.0.1]: " DB_HOST
    DB_HOST=${DB_HOST:-127.0.0.1}
    read -rp "MySQL database name [royaldns]: " DB_NAME
    DB_NAME=${DB_NAME:-royaldns}
    read -rp "MySQL user [royaldns]: " DB_USER
    DB_USER=${DB_USER:-royaldns}
    read -rsp "MySQL password: " DB_PASS
    echo
}

# -----------------------------------------------------------------------------
# Usage: writes all collected values to .env (chmod 600). tls.js/keys.js/
# doh-server.js all load this via require('dotenv').config() - edit later
# with `vi .env` if anything changes.
#
#   write_env_file
# -----------------------------------------------------------------------------
write_env_file() {
    step "Writing $ENV_FILE"
    cat > "$ENV_FILE" <<EOF
DNS_DOMAIN=${DOMAIN}
DOH_PORT=${DOH_PORT}
DB_HOST=${DB_HOST}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
EOF
    chmod 600 "$ENV_FILE"
    echo "Wrote $ENV_FILE (permissions locked to 600)"
    echo "Review/edit anytime with: vi $ENV_FILE"
}

# -----------------------------------------------------------------------------
# Usage: installs Node.js 20 LTS + system packages this project needs
# (build tools for native modules, dnsutils/knot-dnsutils for testing, ufw
# for the firewall step). Idempotent - safe to re-run.
#
#   install_system_packages
# -----------------------------------------------------------------------------
install_system_packages() {
    step "Installing system packages"
    apt-get update -y
    apt-get install -y curl dnsutils knot-dnsutils ufw mysql-server build-essential vim

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
    npm install express https axios acme-client dotenv mysql2 node-telegram-bot-api
    echo "Node packages installed"
}

# -----------------------------------------------------------------------------
# Usage: creates the MySQL database, user, and dns_keys table if they don't
# already exist. Safe to re-run (uses IF NOT EXISTS throughout).
#
#   setup_database
# -----------------------------------------------------------------------------
setup_database() {
    step "Setting up MySQL database"
    mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME};
CREATE USER IF NOT EXISTS '${DB_USER}'@'${DB_HOST}' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'${DB_HOST}';
FLUSH PRIVILEGES;
USE ${DB_NAME};
CREATE TABLE IF NOT EXISTS dns_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_value VARCHAR(64) UNIQUE NOT NULL,
  telegram_id BIGINT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked TINYINT(1) DEFAULT 0
);
SQL
    echo "Database '${DB_NAME}' and dns_keys table ready"
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
    ufw --force enable
    echo "Firewall rules applied: 22, 80, ${DOH_PORT} open"
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
After=network.target mysql.service

[Service]
WorkingDirectory=${project_dir}
ExecStart=$(command -v node) doh-server.js
Restart=always
EnvironmentFile=${project_dir}/.env

[Install]
WantedBy=multi-user.target
EOF

    cat > /etc/systemd/system/royaldns-bot.service <<EOF
[Unit]
Description=Royal DNS Telegram bot
After=network.target mysql.service

[Service]
WorkingDirectory=${project_dir}
ExecStart=$(command -v node) main.js
Restart=always
EnvironmentFile=${project_dir}/.env

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now royaldns-server royaldns-bot
    echo "Services enabled: royaldns-server, royaldns-bot"
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
    prompt_for_mysql
    write_env_file
    install_system_packages
    install_node_packages
    setup_database
    configure_firewall
    request_certificate
    install_systemd_services
    install_renewal_timer

    step "Setup complete"
    echo "Server:  https://${DOMAIN}:${DOH_PORT}/<key>"
    echo "Test it: ./test/test-dns.sh ${DOMAIN} ${DOH_PORT} <a-valid-key>"
    echo "Edit config anytime with: vi ${ENV_FILE}"
}

main
