#!/usr/bin/env bash
# Local LiveKit stack for the Study Group two-browser E2E test.
#
# Runs in the foreground as a Playwright webServer entry: on SIGTERM/SIGINT or
# normal exit it removes its docker container and stops the nginx master it
# started. Idempotent: re-run cleans up leftovers from a previous run (or a
# smoke-check instance that used the same pid file) before starting.
set -euo pipefail

CERTS_DIR=/tmp/lg-livekit-certs
NGINX_CONF=/tmp/lg-nginx.conf
NGINX_PID=/tmp/lg-nginx.pid
CONTAINER=lg-livekit
LIVEKIT_KEYS='devkey: devsecret-devsecret-devsecret-32'

if [[ ! -f "$CERTS_DIR/cert.pem" || ! -f "$CERTS_DIR/key.pem" ]]; then
  mkdir -p "$CERTS_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERTS_DIR/key.pem" -out "$CERTS_DIR/cert.pem" \
    -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
fi

# Stop a previous nginx started with this pid file (smoke checks included).
if [[ -f "$NGINX_PID" ]]; then
  nginx -s stop -c "$NGINX_CONF" 2>/dev/null || true
  for _ in $(seq 1 50); do
    [[ -f "$NGINX_PID" ]] || break
    sleep 0.1
  done
fi
if [[ -z "$(lsof -ti tcp:7443 2>/dev/null || true)" ]]; then
  :
else
  echo "studygroup-livekit-local: port 7443 is still busy but $NGINX_PID is gone; refusing to kill an unknown process." >&2
  exit 1
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d --rm --name "$CONTAINER" \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="$LIVEKIT_KEYS" \
  livekit/livekit-server:latest \
  --node-ip=127.0.0.1 --dev --config-body $'port: 7880\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  use_external_ip: false\n' >/dev/null

cat > "$NGINX_CONF" <<'CONF'
worker_processes 1;
pid /tmp/lg-nginx.pid;
events { worker_connections 128; }
http {
  access_log off;
  server {
    listen 7443 ssl;
    server_name 127.0.0.1 localhost;
    ssl_certificate /tmp/lg-livekit-certs/cert.pem;
    ssl_certificate_key /tmp/lg-livekit-certs/key.pem;
    location / {
      proxy_pass http://127.0.0.1:7880;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 3600s;
    }
  }
}
CONF

nginx -c "$NGINX_CONF" -g 'daemon off;' &
NGINX_JOB=$!

cleanup() {
  trap - EXIT INT TERM
  kill "$NGINX_JOB" 2>/dev/null || true
  nginx -s stop -c "$NGINX_CONF" 2>/dev/null || true
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM

wait "$NGINX_JOB"
