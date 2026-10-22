#!/bin/sh
set -eu

cert_dir=$(CDPATH= cd -- "$(dirname -- "$0")/certs" && pwd)
mkdir -p "$cert_dir"
umask 077

openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$cert_dir/gallery-self-signed.key" \
  -out "$cert_dir/gallery-self-signed.crt" \
  -subj '/C=VN/ST=Thai Nguyen/L=Thai Nguyen/O=Gallery De31/OU=Demo/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'

chmod 644 "$cert_dir/gallery-self-signed.key"
chmod 644 "$cert_dir/gallery-self-signed.crt"
printf 'Generated development certificate in %s\n' "$cert_dir"
