#!/bin/bash

set -eux

SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}")
SCRIPTS_DIR=$(dirname "$SCRIPT_PATH")
WORKING_DIR=$(dirname "$SCRIPTS_DIR")

ORIGINAL_DIR=$(pwd)

cd $WORKING_DIR

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# SSH configuration with environment variable fallbacks
SSH_USER=${SSH_USER:-u0_a630}
SSH_HOST=${SSH_HOST:-192.168.1.25}

npm run build
npm pack
scp -P 8022 termux-notification-list-mcp-${VERSION}.tgz ${SSH_USER}@${SSH_HOST}:/data/data/com.termux/files/home/
ssh -p 8022 ${SSH_USER}@${SSH_HOST} npm i -g ./termux-notification-list-mcp-${VERSION}.tgz
ssh -p 8022 ${SSH_USER}@${SSH_HOST} 'source $PREFIX/etc/profile && export SVDIR=$PREFIX/var/service && sv down termux-notification-sse && sv up termux-notification-sse'

cd $ORIGINAL_DIR
