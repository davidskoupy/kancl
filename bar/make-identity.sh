#!/bin/bash
# Vytvoří lokální podpisovou identitu "KanclBar Dev" (self-signed, jen pro tenhle Mac), aby macOS
# po každém přeložení nezapomínal povolení Přístupnosti. Jednorázově; build.sh ji pak sám používá.
set -euo pipefail
NAME="KanclBar Dev"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then echo "identita $NAME uz existuje"; exit 0; fi
TMP=$(mktemp -d)
cat > "$TMP/cfg" <<CFG
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
CFG
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cfg" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" -passout pass:kancl -name "$NAME" -legacy 2>/dev/null || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" -passout pass:kancl -name "$NAME"
security import "$TMP/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P kancl -T /usr/bin/codesign -T /usr/bin/security >/dev/null
# self-signed certifikát musí být pro codesign důvěryhodný
security add-trusted-cert -r trustRoot -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" "$TMP/cert.pem" 2>/dev/null || true
rm -rf "$TMP"
security find-identity -v -p codesigning | grep "$NAME" && echo "identita vytvořena"
