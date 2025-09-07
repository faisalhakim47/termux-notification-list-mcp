#!/bin/sh
# Setup script for termux-notification-list-mcp SSE service

echo "Setting up termux-notification-list-mcp as SSE service..."

# Check if we're in Termux
if [ -z "$PREFIX" ]; then
    echo "Error: This script must be run in Termux environment"
    exit 1
fi

# Source profile to get SVDIR
if [ -f "$PREFIX/etc/profile" ]; then
    . "$PREFIX/etc/profile"
fi

# Set SVDIR if not already set
if [ -z "$SVDIR" ]; then
    export SVDIR="$PREFIX/var/service"
fi

# Install termux-services if not already installed
if ! command -v sv > /dev/null 2>&1; then
    echo "Installing termux-services..."
    pkg install termux-services -y
    # Source profile again after installation
    if [ -f "$PREFIX/etc/profile" ]; then
        . "$PREFIX/etc/profile"
    fi
fi

# Install openssl if not already installed
if ! command -v openssl > /dev/null 2>&1; then
    echo "Installing openssl..."
    pkg install openssl -y
fi

# Install the package globally
echo "Installing termux-notification-list-mcp globally..."
npm install -g termux-notification-list-mcp

# Create service directory
SERVICE_DIR="$PREFIX/var/service/termux-notification-mcp"
echo "Creating service directory: $SERVICE_DIR"
mkdir -p "$SERVICE_DIR"
mkdir -p "$SERVICE_DIR/log"
ln -sf $PREFIX/share/termux-services/svlogger $SERVICE_DIR/log/run

# Create run script with security environment variables
echo "Creating run script..."

# Generate secure random token if not provided
if [ -z "$MCP_AUTH_TOKEN" ]; then
    if command -v openssl > /dev/null 2>&1; then
        MCP_AUTH_TOKEN=$(openssl rand -hex 32)
    else
        # Fallback to /dev/urandom if openssl is not available
        MCP_AUTH_TOKEN=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')
    fi
    echo "Generated MCP_AUTH_TOKEN: $MCP_AUTH_TOKEN"
fi

cat > "$SERVICE_DIR/run" << EOF
#!/data/data/com.termux/files/usr/bin/sh
export TERMUX_NOTIFICATION_MCP_HTTP_PORT="${TERMUX_NOTIFICATION_MCP_HTTP_PORT:-3000}"
export TERMUX_NOTIFICATION_MCP_BASIC_USER="${TERMUX_NOTIFICATION_MCP_BASIC_USER:-}"
export TERMUX_NOTIFICATION_MCP_BASIC_PASS="${TERMUX_NOTIFICATION_MCP_BASIC_PASS:-}"
export TERMUX_NOTIFICATION_MCP_ALLOWED_ORIGINS="${TERMUX_NOTIFICATION_MCP_ALLOWED_ORIGINS:-http://localhost:3000}"
export TERMUX_NOTIFICATION_MCP_BEARER_TOKEN="$TERMUX_NOTIFICATION_MCP_BEARER_TOKEN"

exec /data/data/com.termux/files/usr/bin/node /data/data/com.termux/files/usr/lib/node_modules/termux-notification-list-mcp/dist/streamable-http.js
EOF

chmod +x "$SERVICE_DIR/run"

echo "Enabling service..."
sv-enable termux-notification-mcp
