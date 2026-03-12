const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

let mainWindow;

const APEX_CORE_PATH = path.resolve(__dirname, '..', '..', 'apex-core');
const ENV_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 720,
        height: 520,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0f',
        resizable: false,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'installer.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

function runCommand(cmd, options = {}) {
    return new Promise((resolve, reject) => {
        const execOptions = {
            env: { ...process.env, PATH: ENV_PATH + ':' + process.env.PATH },
            shell: '/bin/zsh',
            maxBuffer: 1024 * 1024 * 50,
            ...options
        };
        const child = exec(cmd, execOptions, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
            child.stdout?.on('data', (data) => {
                mainWindow.webContents.send('install-log', data.toString());
            });
            child.stderr?.on('data', (data) => {
                mainWindow.webContents.send('install-log', data.toString());
            });
        }
    });
}

function sendProgress(step, total, name, status, percent) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('install-progress', { step, total, name, status, percent });
    }
}

const TOTAL_STEPS = 17;

const STEPS = [
    { name: 'تثبيت Homebrew', critical: true },
    { name: 'تثبيت Python 3.11', critical: true },
    { name: 'تثبيت Node.js', critical: true },
    { name: 'تثبيت Ollama', critical: true },
    { name: 'تثبيت BlackHole 2ch', critical: false },
    { name: 'تثبيت PortAudio', critical: false },
    { name: 'تشغيل خادم Ollama', critical: true },
    { name: 'تحميل نموذج qwen2.5-coder:14b', critical: true },
    { name: 'تحميل نموذج qwen2.5-coder:7b', critical: true },
    { name: 'تحميل نموذج qwen2.5:14b', critical: true },
    { name: 'تحميل نموذج nomic-embed-text', critical: true },
    { name: 'تثبيت حزم Python', critical: true },
    { name: 'تثبيت حزم npm', critical: true },
    { name: 'تحميل نموذج Whisper', critical: false },
    { name: 'بناء تطبيق APEX', critical: true },
    { name: 'نسخ إلى Applications', critical: true },
    { name: 'إنهاء التثبيت', critical: false }
];

ipcMain.handle('start-install', async () => {
    let currentStep = 0;

    async function executeStep(stepIndex, action) {
        currentStep = stepIndex + 1;
        const stepInfo = STEPS[stepIndex];
        sendProgress(currentStep, TOTAL_STEPS, stepInfo.name, 'running', Math.round((currentStep / TOTAL_STEPS) * 100));

        try {
            await action();
            sendProgress(currentStep, TOTAL_STEPS, stepInfo.name, 'done', Math.round((currentStep / TOTAL_STEPS) * 100));
            return true;
        } catch (err) {
            const errMsg = err.stderr || err.error?.message || 'Unknown error';
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('install-log', `[ERROR] Step ${currentStep}: ${errMsg}\n`);
            }
            if (stepInfo.critical) {
                sendProgress(currentStep, TOTAL_STEPS, stepInfo.name, 'error', Math.round((currentStep / TOTAL_STEPS) * 100));
                // Continue even on critical errors to try remaining steps
            } else {
                sendProgress(currentStep, TOTAL_STEPS, stepInfo.name, 'skipped', Math.round((currentStep / TOTAL_STEPS) * 100));
            }
            return false;
        }
    }

    // Step 1: Check/Install Homebrew
    await executeStep(0, async () => {
        try {
            await runCommand('brew --version');
            mainWindow.webContents.send('install-log', 'Homebrew already installed.\n');
        } catch {
            mainWindow.webContents.send('install-log', 'Installing Homebrew...\n');
            await runCommand('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', { timeout: 300000 });
        }
    });

    // Step 2: Check/Install Python 3.11
    await executeStep(1, async () => {
        try {
            await runCommand('python3.11 --version');
            mainWindow.webContents.send('install-log', 'Python 3.11 already installed.\n');
        } catch {
            mainWindow.webContents.send('install-log', 'Installing Python 3.11...\n');
            await runCommand('brew install python@3.11', { timeout: 600000 });
        }
    });

    // Step 3: Check/Install Node.js
    await executeStep(2, async () => {
        try {
            await runCommand('node --version');
            mainWindow.webContents.send('install-log', 'Node.js already installed.\n');
        } catch {
            mainWindow.webContents.send('install-log', 'Installing Node.js...\n');
            await runCommand('brew install node', { timeout: 300000 });
        }
    });

    // Step 4: Check/Install Ollama
    await executeStep(3, async () => {
        try {
            await runCommand('ollama --version');
            mainWindow.webContents.send('install-log', 'Ollama already installed.\n');
        } catch {
            mainWindow.webContents.send('install-log', 'Installing Ollama...\n');
            await runCommand('brew install ollama', { timeout: 300000 });
        }
    });

    // Step 5: Install BlackHole 2ch
    await executeStep(4, async () => {
        mainWindow.webContents.send('install-log', 'Installing BlackHole 2ch...\n');
        await runCommand('brew install blackhole-2ch', { timeout: 300000 });
    });

    // Step 6: Install PortAudio
    await executeStep(5, async () => {
        mainWindow.webContents.send('install-log', 'Installing PortAudio...\n');
        await runCommand('brew install portaudio', { timeout: 300000 });
    });

    // Step 7: Start Ollama server
    await executeStep(6, async () => {
        mainWindow.webContents.send('install-log', 'Starting Ollama server...\n');
        // Start ollama serve in background, don't wait for it to exit
        exec('ollama serve &', {
            env: { ...process.env, PATH: ENV_PATH + ':' + process.env.PATH },
            shell: '/bin/zsh',
            detached: true
        });
        // Wait for server to be ready
        await new Promise(resolve => setTimeout(resolve, 3000));
        mainWindow.webContents.send('install-log', 'Ollama server started.\n');
    });

    // Step 8: Pull qwen2.5-coder:14b
    await executeStep(7, async () => {
        mainWindow.webContents.send('install-log', 'Pulling qwen2.5-coder:14b (this may take a while)...\n');
        await runCommand('ollama pull qwen2.5-coder:14b', { timeout: 3600000 });
    });

    // Step 9: Pull qwen2.5-coder:7b
    await executeStep(8, async () => {
        mainWindow.webContents.send('install-log', 'Pulling qwen2.5-coder:7b...\n');
        await runCommand('ollama pull qwen2.5-coder:7b', { timeout: 3600000 });
    });

    // Step 10: Pull qwen2.5:14b
    await executeStep(9, async () => {
        mainWindow.webContents.send('install-log', 'Pulling qwen2.5:14b...\n');
        await runCommand('ollama pull qwen2.5:14b', { timeout: 3600000 });
    });

    // Step 11: Pull nomic-embed-text
    await executeStep(10, async () => {
        mainWindow.webContents.send('install-log', 'Pulling nomic-embed-text...\n');
        await runCommand('ollama pull nomic-embed-text', { timeout: 1800000 });
    });

    // Step 12: Install Python packages
    await executeStep(11, async () => {
        mainWindow.webContents.send('install-log', 'Installing Python packages...\n');
        await runCommand(`cd "${APEX_CORE_PATH}" && python3.11 -m pip install -r requirements.txt`, { timeout: 600000 });
    });

    // Step 13: Install npm packages
    await executeStep(12, async () => {
        mainWindow.webContents.send('install-log', 'Installing npm packages...\n');
        await runCommand(`cd "${APEX_CORE_PATH}" && npm install`, { timeout: 300000 });
    });

    // Step 14: Download Whisper model
    await executeStep(13, async () => {
        mainWindow.webContents.send('install-log', 'Downloading Whisper model (medium)...\n');
        await runCommand(`python3.11 -c "from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu', compute_type='int8')"`, { timeout: 600000 });
    });

    // Step 15: Build APEX.app
    await executeStep(14, async () => {
        mainWindow.webContents.send('install-log', 'Building APEX.app...\n');
        await runCommand(`cd "${APEX_CORE_PATH}" && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --x64`, { timeout: 600000 });
    });

    // Step 16: Copy to Applications
    await executeStep(15, async () => {
        mainWindow.webContents.send('install-log', 'Copying APEX.app to Applications...\n');
        await runCommand(`cp -R "${APEX_CORE_PATH}/dist/mac/APEX.app" /Applications/`);
    });

    // Step 17: Finalize
    await executeStep(16, async () => {
        mainWindow.webContents.send('install-log', 'Finalizing installation...\n');
        const flagPath = path.join(require('os').homedir(), '.apex-installed');
        require('fs').writeFileSync(flagPath, JSON.stringify({
            installedAt: new Date().toISOString(),
            version: '1.0.0',
            apexPath: '/Applications/APEX.app'
        }));
        mainWindow.webContents.send('install-log', 'Installation complete!\n');
    });

    sendProgress(TOTAL_STEPS, TOTAL_STEPS, 'اكتمل التثبيت', 'complete', 100);
    return { success: true };
});

ipcMain.handle('open-apex', async () => {
    try {
        await shell.openPath('/Applications/APEX.app');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
