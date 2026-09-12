#!/bin/sh
# SnapRecord P-005 Tier 2 — a self-signed certificate for the LAN address.
#
# Browsers hand out getUserMedia/MediaRecorder only on secure origins, and the
# product serves plain HTTP on the LAN (R-0005). This makes the certificate that
# lets the same app answer on https://<lan-ip>:8789 as well. The phone will not
# trust it until a human accepts it, which is the whole risk of Tier 2.
#
#   sh scripts/make-cert.sh
#
# Output goes to data/cert/ which is git-ignored (data/ is). Nothing here is a
# secret worth keeping: regenerate it whenever the LAN address changes.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/cert"
mkdir -p "$OUT"

IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || true)}"
if [ -z "$IP" ]; then
  echo "no LAN IPv4 found on en0; pass one: sh scripts/make-cert.sh 192.168.1.23" >&2
  exit 1
fi

# The LAN address is DHCP-assigned and changes between networks (R-0003), so it
# is read at generation time and never hard-coded.
cat > "$OUT/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[dn]
CN = $IP
[v3]
subjectAltName   = IP:$IP, IP:127.0.0.1, DNS:localhost
basicConstraints = critical, CA:TRUE
keyUsage         = digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout "$OUT/key.pem" -out "$OUT/cert.pem" -config "$OUT/openssl.cnf" 2>/dev/null
chmod 600 "$OUT/key.pem"

echo "wrote $OUT/cert.pem and $OUT/key.pem for IP:$IP (+127.0.0.1, localhost), valid 365 days"
openssl x509 -in "$OUT/cert.pem" -noout -subject -dates -ext subjectAltName
