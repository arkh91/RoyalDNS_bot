#!/usr/bin/env bash
# -----------------------------------------------------------------------------
#  test-dns.sh  -  Manual smoke tests for the Royal DNS server
# -----------------------------------------------------------------------------
#
#  Usage: ./test-dns.sh <domain> <port> <key>
#  Example: ./test-dns.sh dns.royalgaming.com 11111 a1A10A4qQmNCh3GgcL0e2w
#
#  Requires: curl, openssl, dig (dnsutils) — sudo apt install dnsutils
# -----------------------------------------------------------------------------

DOMAIN="$1"
PORT="$2"
KEY="$3"
SAMPLE_QUERY="q80BAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB"

if [ -z "$DOMAIN" ] || [ -z "$PORT" ] || [ -z "$KEY" ]; then
    echo "Usage: $0 <domain> <port> <key>"
    exit 1
fi

BASE_URL="https://${DOMAIN}:${PORT}"

echo "-- 1. Health check (no key needed) --"
curl -s "${BASE_URL}/health"; echo

echo "-- 2. TLS certificate check --"
echo | openssl s_client -connect "${DOMAIN}:${PORT}" -servername "${DOMAIN}" 2>/dev/null \
    | openssl x509 -noout -dates -subject

echo "-- 3. DoH query with a BOGUS key (expect 403) --"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -H 'accept: application/dns-message' \
    "${BASE_URL}/not-a-real-key?dns=${SAMPLE_QUERY}"

echo "-- 4. DoH query WITH the valid key (expect 200) --"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -H 'accept: application/dns-message' \
    "${BASE_URL}/${KEY}?dns=${SAMPLE_QUERY}"

echo "-- 5. Actual name resolution through the DoH endpoint --"
curl -s -H 'accept: application/dns-message' \
    "${BASE_URL}/${KEY}?dns=${SAMPLE_QUERY}" | xxd | head -5

echo "-- 6. Latency check (5 requests) --"
for i in 1 2 3 4 5; do
    curl -s -o /dev/null -w "%{time_total}s\n" \
        "${BASE_URL}/${KEY}?dns=${SAMPLE_QUERY}"
done
