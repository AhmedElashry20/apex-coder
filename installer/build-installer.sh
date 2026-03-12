#!/bin/bash
#═══════════════════════════════════════════════════════
#  elashry ai — Build macOS Installer (.app + .dmg)
#═══════════════════════════════════════════════════════

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo -e "${CYAN}═══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Building elashry ai Installer...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════${NC}"

# Step 1: Install dependencies
echo -e "${YELLOW}[1/4] Installing dependencies...${NC}"
npm install

# Step 2: Install electron-builder
echo -e "${YELLOW}[2/4] Setting up electron-builder...${NC}"
npx electron-builder install-app-deps 2>/dev/null || true

# Step 3: Build the app
echo -e "${YELLOW}[3/4] Building elashry ai.app...${NC}"
npx electron-builder --mac --config electron-builder.yml

# Step 4: Done
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "  DMG location: ${CYAN}dist/${NC}"
echo -e "  Double-click the .dmg to install elashry ai"
echo ""
