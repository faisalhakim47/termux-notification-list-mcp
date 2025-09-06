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

# Create run script
echo "Creating run script..."
cat > "$SERVICE_DIR/run" << 'EOF'
#!/bin/sh
exec termux-notification-list-mcp-sse
EOF

chmod +x "$SERVICE_DIR/run"

# Enable the service
echo "Enabling service..."
sv-enable termux-notification-sse

echo "Setup complete! The SSE server should now be running."
echo "Check status with: sv status termux-notification-sse"
echo "SSE endpoint: http://localhost:3000/sse"
