#!/usr/bin/env bash
set -euo pipefail

# Installs Caddy with automatic Let's Encrypt HTTPS in front of Wild Wheels on
# Ubuntu/Debian so browser microphones work automatically in a secure context.
#
# Usage:
#   ./scripts/server/setup-https-caddy.sh [domain]
# Environment overrides:
#   DOMAIN=wildwheels.duckdns.org  PORT=5173

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
domain="${1:-${DOMAIN:-wildwheels.duckdns.org}}"
port="${PORT:-5173}"

if [[ ! $domain =~ ^[A-Za-z0-9.-]+$ ]] || [[ $domain == *..* ]]; then
  printf 'Invalid domain name: %s\n' "$domain" >&2
  exit 1
fi
if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
  printf 'Invalid PORT: %s\n' "$port" >&2
  exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
  printf 'Installing Caddy...\n'
  sudo apt-get update
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
fi

caddyfile=$(mktemp)
trap 'rm -f -- "$caddyfile"' EXIT
cat > "$caddyfile" <<EOF
$domain {
	reverse_proxy 127.0.0.1:$port {
		header_up X-Forwarded-Proto {scheme}
	}
}
EOF

sudo install -m 0644 "$caddyfile" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl reload-or-restart caddy

state_dir="${WILD_WHEELS_RUN_DIR:-$project_dir/.wild-wheels}"
mkdir -p -- "$state_dir"
env_file="$state_dir/server.env"
touch "$env_file"
chmod 600 "$env_file"
if ! grep -q '^TRUST_PROXY=' "$env_file"; then
  printf 'TRUST_PROXY=1\n' >> "$env_file"
fi

if [[ -x "$project_dir/run_server.sh" && -x "$project_dir/kill_server.sh" ]]; then
  printf 'Restarting Wild Wheels with TRUST_PROXY=1...\n'
  (cd "$project_dir" && ./kill_server.sh && ./run_server.sh)
fi

printf '\nHTTPS reverse proxy configured for https://%s/?room=00\n' "$domain"
printf 'Make sure TCP ports 80 and 443 are open in your VM firewall (e.g. GCP VPC firewall).\n'
printf 'Caddy obtains and renews the Let'\''s Encrypt certificate automatically.\n'
