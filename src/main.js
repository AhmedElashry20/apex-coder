const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const OllamaEngine = require('./ollama');
const Executor = require('./executor');
const BrowserEngine = require('./browser');
const MemoryEngine = require('./memory');
const SearchEngine = require('./search');
const Updater = require('./updater');

let mainWindow;
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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
        cleanupProcesses();
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

async function initializeEngines() {
    ensureDirectories();
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
    await initializeEngines();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    cleanupProcesses();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    cleanupProcesses();
});
