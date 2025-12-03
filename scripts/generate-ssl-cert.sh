#!/bin/bash
# Generate self-signed SSL certificate for Job Executor API Server
# This enables HTTPS access from remote browsers
#
# Usage: sudo ./generate-ssl-cert.sh [hostname]
#
# The certificate will be valid for:
# - The server's hostname
# - The server's primary IP address
# - localhost (for local testing)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo_error "This script must be run as root (sudo ./generate-ssl-cert.sh)"
    exit 1
fi

# SSL directory
SSL_DIR="/etc/idrac-manager/ssl"
CERT_FILE="$SSL_DIR/server.crt"
KEY_FILE="$SSL_DIR/server.key"

# Get hostname and IP
HOSTNAME="${1:-$(hostname -f 2>/dev/null || hostname)}"
SHORT_HOSTNAME=$(hostname -s 2>/dev/null || hostname)
PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo "=========================================="
echo "SSL Certificate Generator for Job Executor"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Hostname: $HOSTNAME"
echo "  Short hostname: $SHORT_HOSTNAME"
echo "  Primary IP: $PRIMARY_IP"
echo "  Certificate: $CERT_FILE"
echo "  Private key: $KEY_FILE"
echo ""

# Create SSL directory
mkdir -p "$SSL_DIR"
chmod 755 "$SSL_DIR"

# Check if certificate already exists
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo_warn "SSL certificate already exists!"
    read -p "Overwrite existing certificate? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
        echo "Keeping existing certificate."
        exit 0
    fi
fi

# Create OpenSSL config for SAN (Subject Alternative Names)
OPENSSL_CONFIG=$(mktemp)
cat > "$OPENSSL_CONFIG" << EOF
[req]
default_bits = 4096
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
C = US
ST = State
L = City
O = Dell Server Manager
OU = Job Executor
CN = $HOSTNAME

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, keyCertSign, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $HOSTNAME
DNS.2 = $SHORT_HOSTNAME
DNS.3 = localhost
IP.1 = $PRIMARY_IP
IP.2 = 127.0.0.1
EOF

echo_info "Generating RSA private key..."
openssl genrsa -out "$KEY_FILE" 4096

echo_info "Generating self-signed certificate (valid for 365 days)..."
openssl req -new -x509 \
    -key "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 365 \
    -config "$OPENSSL_CONFIG"

# Clean up temp file
rm -f "$OPENSSL_CONFIG"

# Set permissions
chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo ""
echo_info "SSL certificate generated successfully!"
echo ""
echo "Certificate details:"
openssl x509 -in "$CERT_FILE" -noout -subject -dates -ext subjectAltName 2>/dev/null || \
    openssl x509 -in "$CERT_FILE" -noout -subject -dates
echo ""

echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "1. Enable SSL in Job Executor:"
echo "   Edit /opt/job-executor/.env and add:"
echo "     API_SERVER_SSL_ENABLED=true"
echo "     API_SERVER_SSL_CERT=$CERT_FILE"
echo "     API_SERVER_SSL_KEY=$KEY_FILE"
echo ""
echo "2. Restart Job Executor:"
echo "   systemctl restart job-executor"
echo ""
echo "3. Update the Job Executor URL in Dell Server Manager:"
echo "   Settings → System → Job Executor Connection"
echo "   Change to: https://$HOSTNAME:8081"
echo ""
echo "4. Trust the certificate in your browser:"
echo "   When you first connect, your browser will show a warning"
echo "   about the self-signed certificate. Click 'Advanced' and"
echo "   'Proceed' to trust it."
echo ""
echo "=========================================="
