#!/bin/bash
#═══════════════════════════════════════════════════════
#  APEX — Full Setup Script
#  Run once: bash setup.sh
#═══════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}"
echo "═══════════════════════════════════════════════════════"
echo "     _    ____  _______  __"
echo "    / \  |  _ \| ____\ \/ /"
echo "   / _ \ | |_) |  _|  \  / "
echo "  / ___ \|  __/| |___ /  \ "
echo " /_/   \_\_|   |_____/_/\_\\"
echo ""
echo "  APEX AI — Full Local Setup"
echo "═══════════════════════════════════════════════════════"
echo -e "${NC}"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ─── Step 1: Homebrew ───
echo -e "${BLUE}[1/10] Checking Homebrew...${NC}"
if ! command -v brew &>/dev/null; then
    echo -e "${YELLOW}Installing Homebrew...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
    # Intel Mac fallback
    if [ -f /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
else
    echo -e "${GREEN}Homebrew already installed.${NC}"
fi

# ─── Step 2: Python 3.11 ───
echo -e "${BLUE}[2/10] Checking Python 3.11...${NC}"
if ! command -v python3.11 &>/dev/null; then
    echo -e "${YELLOW}Installing Python 3.11...${NC}"
    brew install python@3.11
else
    echo -e "${GREEN}Python 3.11 already installed.${NC}"
fi

# ─── Step 3: Node.js ───
echo -e "${BLUE}[3/10] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
    echo -e "${YELLOW}Installing Node.js...${NC}"
    brew install node
else
    echo -e "${GREEN}Node.js already installed: $(node -v)${NC}"
fi

# ─── Step 4: Ollama ───
echo -e "${BLUE}[4/10] Checking Ollama...${NC}"
if ! command -v ollama &>/dev/null; then
    echo -e "${YELLOW}Installing Ollama...${NC}"
    brew install ollama
else
    echo -e "${GREEN}Ollama already installed.${NC}"
fi

# ─── Step 5: BlackHole Virtual Audio ───
echo -e "${BLUE}[5/10] Checking BlackHole-2ch...${NC}"
if ! brew list blackhole-2ch &>/dev/null 2>&1; then
    echo -e "${YELLOW}Installing BlackHole-2ch (virtual audio driver)...${NC}"
    brew install blackhole-2ch
else
    echo -e "${GREEN}BlackHole-2ch already installed.${NC}"
fi

# ─── Step 6: PortAudio (required for pyaudio) ───
echo -e "${BLUE}[6/10] Checking PortAudio...${NC}"
if ! brew list portaudio &>/dev/null 2>&1; then
    echo -e "${YELLOW}Installing PortAudio...${NC}"
    brew install portaudio
else
    echo -e "${GREEN}PortAudio already installed.${NC}"
fi

# ─── Step 7: Start Ollama & Pull Models ───
echo -e "${BLUE}[7/10] Starting Ollama and pulling AI models...${NC}"
echo -e "${YELLOW}This will take a while (downloading ~20GB of models)...${NC}"

# Start ollama serve in background if not running
if ! pgrep -x "ollama" &>/dev/null; then
    ollama serve &>/dev/null &
    sleep 3
fi

echo -e "${CYAN}  Pulling qwen2.5-coder:14b (main coding model)...${NC}"
ollama pull qwen2.5-coder:14b

echo -e "${CYAN}  Pulling qwen2.5-coder:7b (fast model)...${NC}"
ollama pull qwen2.5-coder:7b

echo -e "${CYAN}  Pulling qwen2.5:14b (general/chat model)...${NC}"
ollama pull qwen2.5:14b

echo -e "${CYAN}  Pulling nomic-embed-text (embeddings)...${NC}"
ollama pull nomic-embed-text

echo -e "${GREEN}All AI models downloaded.${NC}"

# ─── Step 8: Python Dependencies ───
echo -e "${BLUE}[8/10] Installing Python dependencies...${NC}"
python3.11 -m pip install --upgrade pip
python3.11 -m pip install -r requirements.txt

# ─── Step 9: Node Dependencies ───
echo -e "${BLUE}[9/10] Installing Node.js dependencies...${NC}"
npm install

# ─── Step 10: Download Whisper Model ───
echo -e "${BLUE}[10/10] Pre-downloading Whisper model (medium)...${NC}"
python3.11 -c "
from faster_whisper import WhisperModel
print('Downloading Whisper medium model (supports Arabic + English)...')
model = WhisperModel('medium', device='cpu', compute_type='int8')
print('Whisper model ready!')
"

# ─── Done ───
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  APEX Setup Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}  To start APEX:${NC}"
echo -e "${YELLOW}    npm start${NC}"
echo ""
echo -e "${CYAN}  Models installed:${NC}"
echo -e "    - qwen2.5-coder:14b (coding)"
echo -e "    - qwen2.5-coder:7b (fast)"
echo -e "    - qwen2.5:14b (general)"
echo -e "    - nomic-embed-text (memory)"
echo -e "    - Whisper medium (speech-to-text)"
echo ""
echo -e "${CYAN}  Virtual Audio:${NC}"
echo -e "    - BlackHole-2ch installed (virtual mic for meetings)"
echo ""
echo -e "${GREEN}  Ready to go! 🚀${NC}"
