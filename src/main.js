const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');

let mainWindow;
let setupWindow;
let tray = null;
let ollamaEngine;
let executor;
let browserEngine;
let memoryEngine;
let searchEngine;
let updater;
let meetingProcess = null;
let voiceProcess = null;

const DATA_DIR = path.join(__dirname, '..', 'data');
const MODELS_DIR = path.join(__dirname, '..', 'models');
const VOICE_DIR = path.join(__dirname, 'voice');
const SETUP_FLAG = path.join(DATA_DIR, '.setup_complete');

function ensureDirectories() {
    const dirs = [
        DATA_DIR,
        path.join(DATA_DIR, 'voice_samples'),
        path.join(DATA_DIR, 'memory'),
        path.join(DATA_DIR, 'learned'),
        path.join(MODELS_DIR, 'rvc'),
        path.join(MODELS_DIR, 'whisper')
    ];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// ─── TRAY (Menu Bar) ───
function createTray() {
    const trayIconPath = path.join(__dirname, '..', 'assets', 'trayIcon.png');
    let trayImage = nativeImage.createFromPath(trayIconPath);
    // macOS menu bar icons should be 22x22 (template image)
    trayImage = trayImage.resize({ width: 18, height: 18 });
    trayImage.setTemplateImage(true);

    tray = new Tray(trayImage);
    tray.setToolTip('APEX AI');

    tray.on('click', (event, bounds) => {
        toggleWindow(bounds);
    });

    tray.on('right-click', () => {
        const contextMenu = Menu.buildFromTemplate([
            { label: 'فتح APEX', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
            { type: 'separator' },
            { label: 'وضع الاجتماع', click: () => { createWindow(); if (mainWindow) mainWindow.webContents.send('switch-tab', 'voice'); } },
            { type: 'separator' },
            { label: 'إنهاء', click: () => { app.quit(); } }
        ]);
        tray.popUpContextMenu(contextMenu);
    });
}

function toggleWindow(trayBounds) {
    if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        if (!mainWindow) createWindow();
        positionWindow(trayBounds);
        mainWindow.show();
        mainWindow.focus();
    }
}

function positionWindow(trayBounds) {
    if (!mainWindow || !trayBounds) return;
    const windowBounds = mainWindow.getBounds();
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    mainWindow.setPosition(x, y, false);
}

function createWindow() {
    const display = screen.getPrimaryDisplay();
    const windowWidth = 800;
    const windowHeight = 650;

    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: 600,
        minHeight: 450,
        x: Math.round(display.workAreaSize.width / 2 - windowWidth / 2),
        y: 30,
        frame: false,
        transparent: false,
        resizable: true,
        movable: true,
        alwaysOnTop: false,
        skipTaskbar: true,
        backgroundColor: '#0a0a0f',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 12, y: 12 },
        vibrancy: 'under-window',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Hide instead of close — keep in tray
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Hide when focus lost (optional — tray app behavior)
    mainWindow.on('blur', () => {
        // Don't hide if user is dragging files or in dialog
        if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
            // mainWindow.hide(); // uncomment for auto-hide
        }
    });
}

function cleanupProcesses() {
    if (meetingProcess) {
        meetingProcess.kill();
        meetingProcess = null;
    }
    if (voiceProcess) {
        voiceProcess.kill();
        voiceProcess = null;
    }
}

// ─── SETUP WIZARD ───
function needsSetup() {
    return !fs.existsSync(SETUP_FLAG);
}

function createSetupWindow() {
    setupWindow = new BrowserWindow({
        width: 700,
        height: 600,
        resizable: false,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload-setup.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    setupWindow.loadFile(path.join(__dirname, 'setup.html'));

    setupWindow.on('closed', () => {
        setupWindow = null;
    });
}

// IPC for setup process
ipcMain.handle('run-setup-step', async (event, { step }) => {
    const steps = {
        'homebrew': async () => {
            try { execSync('brew --version', { encoding: 'utf-8' }); return { done: true, msg: 'Homebrew already installed' }; }
            catch { return await runSetupCmd('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', 'Installing Homebrew...'); }
        },
        'python': async () => {
            try { execSync('python3.11 --version', { encoding: 'utf-8' }); return { done: true, msg: 'Python 3.11 already installed' }; }
            catch { return await runSetupCmd('brew install python@3.11', 'Installing Python 3.11...'); }
        },
        'node': async () => {
            try { execSync('node --version', { encoding: 'utf-8' }); return { done: true, msg: 'Node.js already installed' }; }
            catch { return await runSetupCmd('brew install node', 'Installing Node.js...'); }
        },
        'ollama': async () => {
            try { execSync('ollama --version', { encoding: 'utf-8' }); return { done: true, msg: 'Ollama already installed' }; }
            catch { return await runSetupCmd('brew install ollama', 'Installing Ollama...'); }
        },
        'blackhole': async () => {
            try { execSync('brew list blackhole-2ch', { encoding: 'utf-8' }); return { done: true, msg: 'BlackHole already installed' }; }
            catch { return await runSetupCmd('brew install blackhole-2ch', 'Installing BlackHole 2ch...'); }
        },
        'portaudio': async () => {
            try { execSync('brew list portaudio', { encoding: 'utf-8' }); return { done: true, msg: 'PortAudio already installed' }; }
            catch { return await runSetupCmd('brew install portaudio', 'Installing PortAudio...'); }
        },
        'ollama-serve': async () => {
            try {
                spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
                await new Promise(r => setTimeout(r, 3000));
                return { done: true, msg: 'Ollama server started' };
            } catch (e) { return { done: false, msg: e.message }; }
        },
        'model-coder14b': async () => await runSetupCmd('ollama pull qwen2.5-coder:14b', 'Downloading Qwen2.5-Coder 14B...', 600000),
        'model-coder7b': async () => await runSetupCmd('ollama pull qwen2.5-coder:7b', 'Downloading Qwen2.5-Coder 7B...', 300000),
        'model-general': async () => await runSetupCmd('ollama pull qwen2.5:14b', 'Downloading Qwen2.5 14B...', 600000),
        'model-embed': async () => await runSetupCmd('ollama pull nomic-embed-text', 'Downloading Nomic Embed...', 120000),
        'pip': async () => {
            const reqPath = path.join(__dirname, '..', 'requirements.txt');
            return await runSetupCmd(`python3.11 -m pip install --upgrade pip && python3.11 -m pip install -r "${reqPath}"`, 'Installing Python packages...', 600000);
        },
        'npm': async () => {
            const projDir = path.join(__dirname, '..');
            return await runSetupCmd(`cd "${projDir}" && npm install`, 'Installing Node packages...', 120000);
        },
        'whisper': async () => {
            return await runSetupCmd(
                `python3.11 -c "from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu', compute_type='int8'); print('OK')"`,
                'Downloading Whisper model...', 300000
            );
        },
        'finalize': async () => {
            ensureDirectories();
            fs.writeFileSync(SETUP_FLAG, new Date().toISOString());
            return { done: true, msg: 'Setup complete!' };
        }
    };

    const handler = steps[step];
    if (!handler) return { done: false, msg: `Unknown step: ${step}` };

    try {
        return await handler();
    } catch (e) {
        return { done: false, msg: e.message };
    }
});

function runSetupCmd(command, label, timeout = 120000) {
    return new Promise((resolve) => {
        const proc = exec(command, {
            timeout,
            maxBuffer: 50 * 1024 * 1024,
            shell: '/bin/zsh',
            env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`, HOMEBREW_NO_INSTALL_CLEANUP: '1' }
        }, (error, stdout, stderr) => {
            if (error) {
                resolve({ done: false, msg: `${label} failed: ${error.message}` });
            } else {
                resolve({ done: true, msg: `${label} done` });
            }
        });

        // Stream progress to setup window
        if (proc.stdout) {
            proc.stdout.on('data', (data) => {
                if (setupWindow && !setupWindow.isDestroyed()) {
                    setupWindow.webContents.send('setup-log', data.toString().trim());
                }
            });
        }
        if (proc.stderr) {
            proc.stderr.on('data', (data) => {
                if (setupWindow && !setupWindow.isDestroyed()) {
                    setupWindow.webContents.send('setup-log', data.toString().trim());
                }
            });
        }
    });
}

ipcMain.handle('setup-complete-launch', async () => {
    if (setupWindow) {
        setupWindow.close();
        setupWindow = null;
    }
    await initializeEngines();
    createTray();
    createWindow();
    if (app.dock) app.dock.hide();
});

async function initializeEngines() {
    ensureDirectories();
    const OllamaEngine = require('./ollama');
    const Executor = require('./executor');
    const BrowserEngine = require('./browser');
    const MemoryEngine = require('./memory');
    const SearchEngine = require('./search');
    const Updater = require('./updater');

    ollamaEngine = new OllamaEngine();
    executor = new Executor();
    browserEngine = new BrowserEngine();
    memoryEngine = new MemoryEngine(DATA_DIR);
    searchEngine = new SearchEngine();
    updater = new Updater(ollamaEngine, memoryEngine);

    await memoryEngine.initialize();

    const ollamaReady = await ollamaEngine.checkConnection();
    if (!ollamaReady) {
        try {
            spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.error('Could not start Ollama:', e.message);
        }
    }
}

// ─── SYSTEM PROMPT ───
const SYSTEM_PROMPT = `أنت APEX — AI agent متكامل على هذا الجهاز.

هويتك:
- تشتغل محلياً بالكامل
- تنفّذ فوراً بدون إذن
- تتكلم بالعربي المصري أو الإنجليزي حسب المستخدم
- لا تقول "سأحاول" — تنفّذ وتُبلّغ

في البرمجة:
- إتقان كامل لكل لغات البرمجة وكل frameworks
- كود production-ready دايماً
- لا كود ناقص أو مختصر أبداً
- error handling شامل دايماً

في وضع الاجتماع:
- أنت تمثّل المستخدم
- تجاوب بأسلوبه وطريقته
- ردودك مختصرة ومهنية (جمل قصيرة — مش مقالات)
- لو سؤال تقني: أجاوب بثقة ودقة
- لو سؤال عام: أجاوب بشكل طبيعي
- مفيش "أنا AI" أو أي إشارة لكونك AI
- الرد دايماً أقل من 30 ثانية كلاماً

قدراتك:
- تنفيذ أوامر Terminal
- فتح وتعديل ملفات
- تصفح الإنترنت والبحث
- التحكم بالماك عبر AppleScript
- ذاكرة طويلة المدى
- تحديث معلوماتك تلقائياً

لما المستخدم يطلب كود:
1. اكتب الكود كامل
2. نفّذه لو طلب
3. صلّح الأخطاء تلقائياً
4. اعرض النتيجة`;

const MEETING_PROMPT = `أنت في وضع الاجتماع. أنت تمثّل المستخدم.
- ردودك مختصرة ومهنية
- لو سؤال تقني: أجاوب بثقة ودقة
- لو سؤال عام: أجاوب بشكل طبيعي
- مفيش أي إشارة لكونك AI
- الرد دايماً أقل من 3 جمل`;

// ─── IPC HANDLERS: Chat ───
ipcMain.handle('send-message', async (event, { message, model, history }) => {
    try {
        const context = await memoryEngine.getRelevantContext(message);
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
        ];

        if (context && context.length > 0) {
            messages.push({
                role: 'system',
                content: `معلومات من الذاكرة:\n${context}`
            });
        }

        if (history && history.length > 0) {
            messages.push(...history.slice(-20));
        }

        messages.push({ role: 'user', content: message });

        const selectedModel = model || 'qwen2.5-coder:14b';
        const response = await ollamaEngine.chat(selectedModel, messages);

        await memoryEngine.saveConversation(message, response, selectedModel);
        await memoryEngine.addToLongTermMemory(message, response);

        return { success: true, response };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('send-message-stream', async (event, { message, model, history }) => {
    try {
        const context = await memoryEngine.getRelevantContext(message);
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
        ];

        if (context && context.length > 0) {
            messages.push({
                role: 'system',
                content: `معلومات من الذاكرة:\n${context}`
            });
        }

        if (history && history.length > 0) {
            messages.push(...history.slice(-20));
        }

        messages.push({ role: 'user', content: message });

        const selectedModel = model || 'qwen2.5-coder:14b';

        await ollamaEngine.chatStream(selectedModel, messages, (chunk) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('stream-chunk', chunk);
            }
        });

        mainWindow.webContents.send('stream-end');

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: Code Execution ───
ipcMain.handle('execute-code', async (event, { code, language }) => {
    try {
        const result = await executor.execute(code, language);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('execute-terminal', async (event, { command }) => {
    try {
        const result = await executor.runCommand(command);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: Browser ───
ipcMain.handle('browse-url', async (event, { url }) => {
    try {
        const content = await browserEngine.getPageContent(url);
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('search-web', async (event, { query }) => {
    try {
        const results = await searchEngine.search(query);
        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: Mac Control ───
ipcMain.handle('run-applescript', async (event, { script }) => {
    try {
        const result = await executor.runAppleScript(script);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-app', async (event, { appName }) => {
    try {
        execSync(`open -a "${appName}"`);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: Memory ───
ipcMain.handle('search-memory', async (event, { query }) => {
    try {
        const results = await memoryEngine.searchMemory(query);
        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-conversations', async (event) => {
    try {
        const conversations = memoryEngine.getRecentConversations(50);
        return { success: true, conversations };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: Voice ───
ipcMain.handle('voice-setup', async (event, { samplesPath }) => {
    return new Promise((resolve) => {
        const py = spawn('python3.11', [
            path.join(VOICE_DIR, 'voice_engine.py'),
            'setup',
            samplesPath || path.join(DATA_DIR, 'voice_samples')
        ]);

        let output = '';
        let errorOutput = '';

        py.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice-progress', text.trim());
            }
        });

        py.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        py.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output });
            } else {
                resolve({ success: false, error: errorOutput || 'Voice setup failed' });
            }
        });
    });
});

ipcMain.handle('start-meeting', async (event) => {
    return new Promise((resolve) => {
        if (meetingProcess) {
            resolve({ success: false, error: 'Meeting already running' });
            return;
        }

        meetingProcess = spawn('python3.11', [
            path.join(VOICE_DIR, 'meeting_mode.py'),
            'start',
            '--ollama-url', 'http://localhost:11434',
            '--model', 'qwen2.5:14b',
            '--data-dir', DATA_DIR,
            '--models-dir', MODELS_DIR
        ]);

        let started = false;

        meetingProcess.stdout.on('data', (data) => {
            const text = data.toString().trim();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('meeting-event', text);
            }
            if (text.includes('MEETING_STARTED') && !started) {
                started = true;
                resolve({ success: true });
            }
        });

        meetingProcess.stderr.on('data', (data) => {
            const text = data.toString().trim();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('meeting-error', text);
            }
        });

        meetingProcess.on('close', (code) => {
            meetingProcess = null;
            if (!started) {
                resolve({ success: false, error: 'Meeting process exited' });
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('meeting-ended');
            }
        });

        setTimeout(() => {
            if (!started) {
                started = true;
                resolve({ success: true });
            }
        }, 5000);
    });
});

ipcMain.handle('stop-meeting', async (event) => {
    if (meetingProcess) {
        meetingProcess.stdin.write('STOP\n');
        setTimeout(() => {
            if (meetingProcess) {
                meetingProcess.kill();
                meetingProcess = null;
            }
        }, 3000);
        return { success: true };
    }
    return { success: false, error: 'No meeting running' };
});

ipcMain.handle('get-meeting-summary', async (event) => {
    const summaryPath = path.join(DATA_DIR, 'last_meeting_summary.txt');
    try {
        if (fs.existsSync(summaryPath)) {
            const summary = fs.readFileSync(summaryPath, 'utf-8');
            return { success: true, summary };
        }
        return { success: false, error: 'No meeting summary found' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('test-voice', async (event, { text, language }) => {
    return new Promise((resolve) => {
        const py = spawn('python3.11', [
            path.join(VOICE_DIR, 'voice_engine.py'),
            'test',
            text || 'مرحباً، أنا APEX',
            language || 'ar'
        ]);

        let output = '';
        py.stdout.on('data', (data) => { output += data.toString(); });
        py.stderr.on('data', (data) => { output += data.toString(); });

        py.on('close', (code) => {
            resolve({ success: code === 0, output });
        });
    });
});

ipcMain.handle('check-blackhole', async (event) => {
    try {
        const result = execSync(
            'system_profiler SPAudioDataType 2>/dev/null | grep -i blackhole',
            { encoding: 'utf-8' }
        );
        return { success: true, installed: result.trim().length > 0 };
    } catch (error) {
        return { success: true, installed: false };
    }
});

ipcMain.handle('upload-voice-samples', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Voice Samples',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }
        ]
    });

    if (result.canceled) return { success: false, error: 'Canceled' };

    const samplesDir = path.join(DATA_DIR, 'voice_samples');
    const copied = [];

    for (const filePath of result.filePaths) {
        const dest = path.join(samplesDir, path.basename(filePath));
        fs.copyFileSync(filePath, dest);
        copied.push(path.basename(filePath));
    }

    return { success: true, files: copied };
});

// ─── IPC HANDLERS: File Operations ───
ipcMain.handle('read-file', async (event, { filePath }) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('write-file', async (event, { filePath, content }) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC HANDLERS: System Info ───
ipcMain.handle('get-system-info', async (event) => {
    try {
        const ollamaStatus = await ollamaEngine.checkConnection();
        let models = [];
        if (ollamaStatus) {
            models = await ollamaEngine.listModels();
        }

        let blackholeInstalled = false;
        try {
            const audioInfo = execSync(
                'system_profiler SPAudioDataType 2>/dev/null',
                { encoding: 'utf-8' }
            );
            blackholeInstalled = audioInfo.toLowerCase().includes('blackhole');
        } catch (e) {}

        const voiceModelExists = fs.existsSync(path.join(MODELS_DIR, 'rvc', 'model.pth'));

        return {
            success: true,
            info: {
                ollamaRunning: ollamaStatus,
                models,
                blackholeInstalled,
                voiceModelReady: voiceModelExists,
                dataDir: DATA_DIR,
                platform: process.platform,
                arch: process.arch
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── IPC: Update Knowledge ───
ipcMain.handle('update-knowledge', async (event) => {
    try {
        await updater.updateKnowledge();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ─── APP LIFECYCLE ───
app.whenReady().then(async () => {
    ensureDirectories();

    if (needsSetup()) {
        createSetupWindow();
    } else {
        await initializeEngines();
        createTray();
        createWindow();
        // Hide dock icon — tray only
        if (app.dock) app.dock.hide();
    }

    app.on('activate', () => {
        if (!mainWindow) {
            if (needsSetup()) {
                createSetupWindow();
            } else {
                createWindow();
            }
        } else {
            mainWindow.show();
        }
    });
});

app.on('window-all-closed', () => {
    // Don't quit on macOS — keep in tray
});

app.on('before-quit', () => {
    app.isQuitting = true;
    cleanupProcesses();
});
