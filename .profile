SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}")
WORKING_DIR=$(dirname "$SCRIPT_PATH")
export IMPORT_MAP_PATH="$WORKING_DIR/importmap.json"
export NODE_OPTIONS="--experimental-transform-types --no-warnings --import=tsx --import=$WORKING_DIR/import.js"