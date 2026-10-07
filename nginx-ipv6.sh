#!/bin/sh
# @see: https://github.com/nginx/docker-nginx-unprivileged/tree/main/stable/alpine-slim

set -e

entrypoint_log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "$@"
    fi
}

PORT=${PORT:-8080}
case "$PORT" in
  ''|*[!0-9]*) echo "ERROR: PORT must be a number, got '$PORT'" >&2; exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "ERROR: PORT must be between 1 and 65535, got '$PORT'" >&2
  exit 1
fi
if [ "$PORT" != "8080" ]; then
  entrypoint_log "Changing Nginx listen port to $PORT"
  sed -i "s/listen 8080/listen $PORT/g; s/listen \[::\]:8080/listen [::]:$PORT/g" /etc/nginx/nginx.conf
fi

if [ "$DISABLE_IPV6" = "true" ]; then
  entrypoint_log "Disabling the Nginx IPv6 listener"
  sed -i '/^[[:space:]]*listen[[:space:]]*\[::\]:[0-9]*/s/^/#/' /etc/nginx/nginx.conf
fi

exit 0
