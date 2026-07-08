#!/usr/bin/env bash
# -----------------------------------------------------------------------------
#  setup-main.sh  -  Royal DNS main VPS provisioning (bot + local database)
# -----------------------------------------------------------------------------
#
#  Run this ONCE on the main VPS. This box runs the Telegram bot AND a
#  MySQL database — but that database is purely LOCAL bookkeeping (a record
#  of every key issued, for support/audit purposes), not something any
#  regional server ever touches. Regional servers have no database at all;
#  each one keeps its own keys in a local JSON file (see keys.js there).
#  Because it's local-only, MySQL here never needs to accept remote
#  connections, and there's no firewall port to open for it.
#
#  This is NOT the same as setup.sh, which provisions a regional DNS server
#  (TLS cert, DoH listener, admin API — file-based keys, no database).
#
#  Usage: sudo ./setup-main.sh
# -----------------------------------------------------------------------------

set -euo pipefail

ENV_FILE=".env"

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
# Usage: verifies main.js is present, and warns (non-fatal, since these hold
# secrets this script can't create for you) if tokens.js, callbacks.json, or
# regions.js are missing. Exits only if main.js itself is absent, since
# without it there's nothing to run at all.
#
#   check_required_files
# -----------------------------------------------------------------------------
check_required_files() {
    if [ ! -f main.js ]; then
        echo "ERROR: main.js not found in $(pwd)."
        echo "Copy/upload the bot's files here first, then re-run this script."
        exit 1
    fi

    local warnings=()
    [ -f tokens.js ]      || warnings+=("tokens.js (needs your real Telegram bot token — copy tokens.example.js and fill it in)")
    [ -f callbacks.json ] || warnings+=("callbacks.json (minimum: {\"callbackToServer\": {}, \"callbackToInternationalServer\": {}})")
    [ -f regions.js ]     || warnings+=("regions.js (needs each regional server's domain/port/admin token — copy regions.example.js and fill it in)")

    if [ "${#warnings[@]}" -gt 0 ]; then
        echo "WARNING: the following files are missing and the bot will crash without them:"
        for w in "${warnings[@]}"; do echo "  - $w"; done
        read -rp "Continue anyway (fix these before starting the service)? [y/N] " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
    fi
}

# -----------------------------------------------------------------------------
# Usage: installs Node.js 20 LTS + MySQL (local bookkeeping database lives
# here). No ufw firewall changes — MySQL only ever needs to accept
# connections from localhost, so there's nothing to open to the outside.
#
#   install_system_packages
# -----------------------------------------------------------------------------
install_system_packages() {
    step "Installing system packages"
    apt-get update -y
    apt-get install -y curl build-essential vim mysql-server

    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
    echo "Node $(node -v), npm $(npm -v)"
}

# -----------------------------------------------------------------------------
# Usage: installs just what main.js and db.js need.
#
#   install_node_packages
# -----------------------------------------------------------------------------
install_node_packages() {
    step "Installing npm packages"
    [ -f package.json ] || npm init -y > /dev/null
    npm install axios dotenv node-telegram-bot-api mysql2
    echo "Node packages installed"
}

# -----------------------------------------------------------------------------
# Usage: prompts for the local database's name, then generates a random
# username and strong password. Sets the globals DB_NAME, DB_USER, DB_PASS.
#
#   prompt_and_generate_db_credentials
# -----------------------------------------------------------------------------
prompt_and_generate_db_credentials() {
    step "Local bookkeeping database"
    read -rp "Database name [royaldns]: " DB_NAME
    DB_NAME=${DB_NAME:-royaldns}
    DB_USER="royaldns"
    DB_PASS=$(openssl rand -hex 24)
}

# -----------------------------------------------------------------------------
# Usage: creates the local database, an issued_keys bookkeeping table, and a
# MySQL user that can only connect from localhost (no remote access at all
# — this database is never reached by any regional server).
#
#   setup_local_database
# -----------------------------------------------------------------------------
setup_local_database() {
    step "Setting up local database"
    mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME};
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
USE ${DB_NAME};
CREATE TABLE IF NOT EXISTS issued_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_value VARCHAR(64) NOT NULL,
  telegram_id BIGINT NOT NULL,
  region VARCHAR(32) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  removed_at DATETIME DEFAULT NULL
);
SQL
    echo "Database '${DB_NAME}' ready (localhost-only, table: issued_keys)"
}

# -----------------------------------------------------------------------------
# Usage: writes .env (chmod 600) with the local DB connection details for
# db.js/main.js to use.
#
#   write_env_file
# -----------------------------------------------------------------------------
write_env_file() {
    step "Writing $ENV_FILE"
    cat > "$ENV_FILE" <<EOF
DB_HOST=127.0.0.1
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
EOF
    chmod 600 "$ENV_FILE"
    echo "Wrote $ENV_FILE (permissions locked to 600)"
    echo "Review/edit anytime with: vi $ENV_FILE"
}

# -----------------------------------------------------------------------------
# Usage: writes and enables the systemd service for the bot, so it survives
# reboots and crashes (Restart=always).
#
#   install_systemd_service
# -----------------------------------------------------------------------------
install_systemd_service() {
    step "Installing systemd service"
    local project_dir
    project_dir=$(pwd)

    cat > /etc/systemd/system/royaldns-bot.service <<EOF
[Unit]
Description=Royal DNS Telegram bot (main VPS)
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
    systemctl enable --now royaldns-bot
    echo "Service enabled: royaldns-bot"
    echo "Check status with: systemctl status royaldns-bot"
}

# -----------------------------------------------------------------------------
# Main entry point - runs every step in order.
# -----------------------------------------------------------------------------
main() {
    step "Royal DNS main VPS setup (bot + local database)"
    check_required_files
    prompt_and_generate_db_credentials
    install_system_packages
    install_node_packages
    setup_local_database
    write_env_file
    install_systemd_service

    echo
    echo "Setup complete."
    echo "Logs: journalctl -u royaldns-bot -f"
    echo "Make sure regions.js has a real domain/port/admin-token for every"
    echo "country your bot's menu offers — anything missing there gets a"
    echo "graceful \"temporarily unavailable\" message instead of a crash."
    echo "The database here is local-only bookkeeping — no regional server"
    echo "ever connects to it, and it never needs to accept remote connections."
}

main
