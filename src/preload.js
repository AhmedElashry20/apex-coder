const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apex', {
    // Chat
    sendMessage: (data) => ipcRenderer.invoke('send-message', data),
    sendMessageStream: (data) => ipcRenderer.invoke('send-message-stream', data),
    onStreamChunk: (callback) => ipcRenderer.on('stream-chunk', (_, chunk) => callback(chunk)),
    onStreamEnd: (callback) => ipcRenderer.on('stream-end', () => callback()),

    // Code Execution
    executeCode: (data) => ipcRenderer.invoke('execute-code', data),
    executeTerminal: (data) => ipcRenderer.invoke('execute-terminal', data),

    // Browser
    browseUrl: (data) => ipcRenderer.invoke('browse-url', data),
    searchWeb: (data) => ipcRenderer.invoke('search-web', data),

    // Mac Control
    runAppleScript: (data) => ipcRenderer.invoke('run-applescript', data),
    openApp: (data) => ipcRenderer.invoke('open-app', data),

    // Memory
    searchMemory: (data) => ipcRenderer.invoke('search-memory', data),
    getConversations: () => ipcRenderer.invoke('get-conversations'),

    // Voice
    voiceSetup: (data) => ipcRenderer.invoke('voice-setup', data),
    startMeeting: () => ipcRenderer.invoke('start-meeting'),
    stopMeeting: () => ipcRenderer.invoke('stop-meeting'),
    getMeetingSummary: () => ipcRenderer.invoke('get-meeting-summary'),
    testVoice: (data) => ipcRenderer.invoke('test-voice', data),
    checkBlackhole: () => ipcRenderer.invoke('check-blackhole'),
    uploadVoiceSamples: () => ipcRenderer.invoke('upload-voice-samples'),
    onVoiceProgress: (callback) => ipcRenderer.on('voice-progress', (_, msg) => callback(msg)),
    onMeetingEvent: (callback) => ipcRenderer.on('meeting-event', (_, msg) => callback(msg)),
    onMeetingError: (callback) => ipcRenderer.on('meeting-error', (_, msg) => callback(msg)),
    onMeetingEnded: (callback) => ipcRenderer.on('meeting-ended', () => callback()),

    // File Operations
    readFile: (data) => ipcRenderer.invoke('read-file', data),
    writeFile: (data) => ipcRenderer.invoke('write-file', data),
    listDirectory: (data) => ipcRenderer.invoke('list-directory', data),

    // Security
    securityScanDevice: () => ipcRenderer.invoke('security-scan-device'),
    securityScanNetwork: (data) => ipcRenderer.invoke('security-scan-network', data || {}),
    securityDetectRemote: () => ipcRenderer.invoke('security-detect-remote'),
    securityHarden: () => ipcRenderer.invoke('security-harden'),
    securityConnections: () => ipcRenderer.invoke('security-connections'),
    securityAnalyzeFile: (data) => ipcRenderer.invoke('security-analyze-file', data),
    securityBlockIP: (data) => ipcRenderer.invoke('security-block-ip', data),
    securityVulnerabilities: () => ipcRenderer.invoke('security-vulnerabilities'),

    // System
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    updateKnowledge: () => ipcRenderer.invoke('update-knowledge'),

    // Tab switching from tray
    onSwitchTab: (callback) => ipcRenderer.on('switch-tab', (_, tab) => callback(tab))
});
