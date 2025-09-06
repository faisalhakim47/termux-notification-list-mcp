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

# Install termux-services if not already installed
if ! command -v sv > /dev/null 2>&1; then
    echo "Installing termux-services..."
    pkg install termux-services -y
    # Source profile again after installation
    if [ -f "$PREFIX/etc/profile" ]; then
        . "$PREFIX/etc/profile"
    fi
fi

# Install the package globally
echo "Installing termux-notification-list-mcp globally..."
npm install -g termux-notification-list-mcp

# Create service directory
SERVICE_DIR="$PREFIX/var/service/termux-notification-sse"
echo "Creating service directory: $SERVICE_DIR"
mkdir -p "$SERVICE_DIR"

# Create run script with security environment variables
echo "Creating run script..."

# Generate secure random token if not provided
if [ -z "$MCP_AUTH_TOKEN" ]; then
    MCP_AUTH_TOKEN=$(openssl rand -hex 32)
    echo "Generated MCP_AUTH_TOKEN: $MCP_AUTH_TOKEN"
fi

cat > "$SERVICE_DIR/run" << EOF
#!/data/data/com.termux/files/usr/bin/sh
# Security configuration - modify these values for production
export MCP_AUTH_TOKEN="$MCP_AUTH_TOKEN"
export MCP_BASIC_USER="${MCP_BASIC_USER:-}"
export MCP_BASIC_PASS="${MCP_BASIC_PASS:-}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:3000}"
export PORT="${PORT:-3000}"

exec /data/data/com.termux/files/usr/bin/termux-notification-list-mcp-sse
EOF

chmod +x "$SERVICE_DIR/run"

# Enable the service
echo "Enabling service..."
sv-enable termux-notification-sse

echo "Setup complete! The SSE server should now be running."
echo "Check status with: sv status termux-notification-sse"
echo ""
echo "Security Notes:"
echo "- Set MCP_AUTH_TOKEN for Bearer token authentication"
echo "- Set MCP_BASIC_USER and MCP_BASIC_PASS for HTTP Basic authentication"
echo "- For production, enable HTTPS with proper SSL certificates"
echo "- Configure ALLOWED_ORIGINS for CORS security"
echo "- Review the README.md for detailed security configuration"
echo "SSE endpoint: http://localhost:3000/sse"
