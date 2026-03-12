/**
 * elashry ai Coder — Security Engine
 * Authorized security testing and defensive security module for macOS.
 *
 * Every method is async and returns a structured object.
 * Uses Node.js child_process to invoke native macOS commands.
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

function runSync(cmd) {
  try {
    return execSync(cmd, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }).toString();
  } catch {
    return '';
  }
}

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

const WELL_KNOWN_PORTS = {
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp',
  53: 'dns', 80: 'http', 110: 'pop3', 119: 'nntp', 123: 'ntp',
  135: 'msrpc', 139: 'netbios', 143: 'imap', 161: 'snmp', 194: 'irc',
  443: 'https', 445: 'smb', 465: 'smtps', 514: 'syslog', 587: 'submission',
  631: 'ipp', 993: 'imaps', 995: 'pop3s', 1080: 'socks', 1433: 'mssql',
  1521: 'oracle', 2049: 'nfs', 3306: 'mysql', 3389: 'rdp',
  5432: 'postgresql', 5900: 'vnc', 5901: 'vnc-1', 5938: 'teamviewer',
  6379: 'redis', 6443: 'kubernetes', 8080: 'http-proxy', 8443: 'https-alt',
  8888: 'http-alt', 9090: 'prometheus', 27017: 'mongodb',
};

function serviceName(port) {
  return WELL_KNOWN_PORTS[port] || 'unknown';
}

const SUSPICIOUS_PROCESS_NAMES = [
  'ncat', 'netcat', 'nc', 'socat', 'meterpreter', 'mimikatz',
  'cobaltstrike', 'beacon', 'empire', 'powershell', 'xmrig',
  'cryptominer', 'keylogger', 'rat', 'backdoor', 'reverse_shell',
  'bind_shell', 'payload', 'exploit', 'lazagne', 'hydra',
  'medusa', 'hashcat', 'john', 'aircrack', 'ettercap',
  'bettercap', 'responder', 'bloodhound', 'sharphound',
];

const REMOTE_ACCESS_TOOLS = [
  { name: 'TeamViewer', process: 'TeamViewer', bundleId: 'com.teamviewer.TeamViewer' },
  { name: 'AnyDesk', process: 'AnyDesk', bundleId: 'com.anydesk.anydeskplatform' },
  { name: 'Chrome Remote Desktop', process: 'remoting_host', bundleId: 'com.google.chrome.remote_desktop' },
  { name: 'LogMeIn', process: 'LogMeIn', bundleId: 'com.logmein.LogMeInClient' },
  { name: 'Splashtop', process: 'SplashtopStreamer', bundleId: 'com.splashtop.Splashtop-Streamer' },
  { name: 'RustDesk', process: 'RustDesk', bundleId: 'com.carriez.RustDesk' },
  { name: 'NoMachine', process: 'nxserver', bundleId: 'com.nomachine.nxplayer' },
  { name: 'VNC Viewer', process: 'vncviewer', bundleId: '' },
];

// ---------------------------------------------------------------------------
// SecurityEngine
// ---------------------------------------------------------------------------

class SecurityEngine {
  constructor() {
    this._appLocked = false;
    this._appPasswordHash = null;
  }

  // -----------------------------------------------------------------------
  // 1. scanDevice — Full Mac system scan
  // -----------------------------------------------------------------------
  async scanDevice() {
    const report = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      sections: {},
      riskLevel: 'low',
      findings: [],
    };

    // --- Running processes ---
    const psResult = await run('ps aux');
    const suspiciousProcesses = [];
    if (psResult.ok) {
      const rows = lines(psResult.stdout).slice(1); // skip header
      for (const row of rows) {
        const cols = row.split(/\s+/);
        const proc = (cols[10] || '').toLowerCase();
        const procBase = path.basename(proc);
        if (SUSPICIOUS_PROCESS_NAMES.some((s) => procBase.includes(s))) {
          suspiciousProcesses.push({
            user: cols[0],
            pid: cols[1],
            cpu: cols[2],
            mem: cols[3],
            command: cols.slice(10).join(' '),
          });
        }
      }
    }
    report.sections.suspiciousProcesses = suspiciousProcesses;
    if (suspiciousProcesses.length > 0) {
      report.findings.push(`${suspiciousProcesses.length} suspicious process(es) detected`);
    }

    // --- Open ports ---
    const lsofResult = await run('lsof -i -P -n');
    const openPorts = [];
    if (lsofResult.ok) {
      const rows = lines(lsofResult.stdout).slice(1);
      for (const row of rows) {
        const cols = row.split(/\s+/);
        if (cols.length >= 9) {
          openPorts.push({
            command: cols[0],
            pid: cols[1],
            user: cols[2],
            type: cols[4],
            node: cols[7],
            name: cols[8],
          });
        }
      }
    }
    report.sections.openPorts = openPorts;

    // --- LaunchAgents / LaunchDaemons ---
    const launchPaths = [
      '/Library/LaunchAgents',
      '/Library/LaunchDaemons',
      path.join(os.homedir(), 'Library/LaunchAgents'),
    ];
    const persistenceItems = [];
    for (const lp of launchPaths) {
      try {
        if (fs.existsSync(lp)) {
          const entries = fs.readdirSync(lp).filter((f) => f.endsWith('.plist'));
          for (const entry of entries) {
            const full = path.join(lp, entry);
            let label = entry;
            const plistRead = await run(`/usr/bin/plutil -p "${full}"`);
            if (plistRead.ok) {
              const labelMatch = plistRead.stdout.match(/"Label"\s*=>\s*"([^"]+)"/);
              if (labelMatch) label = labelMatch[1];
            }
            const isApple = label.startsWith('com.apple.');
            persistenceItems.push({
              path: full,
              label,
              directory: lp,
              isApple,
            });
          }
        }
      } catch {
        // permission denied — skip
      }
    }
    const nonApplePersistence = persistenceItems.filter((p) => !p.isApple);
    report.sections.persistence = {
      total: persistenceItems.length,
      thirdParty: nonApplePersistence,
    };
    if (nonApplePersistence.length > 5) {
      report.findings.push(`${nonApplePersistence.length} third-party LaunchAgents/Daemons found`);
    }

    // --- Login items ---
    const loginResult = await run('osascript -e \'tell application "System Events" to get the name of every login item\'');
    const loginItems = loginResult.ok ? lines(loginResult.stdout) : [];
    report.sections.loginItems = loginItems;

    // --- Recent sudo usage ---
    const sudoResult = await run('log show --predicate \'process == "sudo"\' --last 1h --style compact 2>/dev/null | head -50');
    const sudoLines = sudoResult.ok ? lines(sudoResult.stdout) : [];
    report.sections.recentSudo = {
      count: sudoLines.length,
      entries: sudoLines.slice(0, 20),
    };
    if (sudoLines.length > 10) {
      report.findings.push(`High sudo activity: ${sudoLines.length} entries in the last hour`);
    }

    // --- Screen sharing / VNC ---
    const screenSharingResult = await run('launchctl list | grep com.apple.screensharing');
    const vncRunning = screenSharingResult.ok && screenSharingResult.stdout.trim().length > 0;
    const remoteManagementResult = await run('launchctl list | grep com.apple.RemoteDesktop');
    const remoteManagement = remoteManagementResult.ok && remoteManagementResult.stdout.trim().length > 0;
    report.sections.remoteAccess = {
      screenSharing: vncRunning,
      remoteManagement,
    };
    if (vncRunning) report.findings.push('Screen Sharing (VNC) is enabled');
    if (remoteManagement) report.findings.push('Remote Management (ARD) is enabled');

    // --- Risk level ---
    if (report.findings.length >= 4) report.riskLevel = 'high';
    else if (report.findings.length >= 2) report.riskLevel = 'medium';

    return report;
  }

  // -----------------------------------------------------------------------
  // 2. scanNetwork — nmap or fallback
  // -----------------------------------------------------------------------
  async scanNetwork(target) {
    if (!target) throw new Error('target is required');

    const result = {
      target,
      timestamp: new Date().toISOString(),
      scanner: 'native',
      openPorts: [],
      osGuess: null,
      scanDuration: 0,
    };

    const start = Date.now();

    // Try nmap first
    const nmapCheck = await run('which nmap');
    if (nmapCheck.ok && nmapCheck.stdout.trim()) {
      result.scanner = 'nmap';
      const nmapResult = await run(`nmap -sV -O --top-ports 1000 -T4 "${target}" 2>/dev/null`, 120000);
      if (nmapResult.ok) {
        const portRegex = /^(\d+)\/(tcp|udp)\s+(open|filtered)\s+(.*)$/gm;
        let match;
        while ((match = portRegex.exec(nmapResult.stdout)) !== null) {
          result.openPorts.push({
            port: parseInt(match[1], 10),
            protocol: match[2],
            state: match[3],
            service: match[4].trim(),
          });
        }
        const osMatch = nmapResult.stdout.match(/OS details:\s*(.+)/);
        if (osMatch) result.osGuess = osMatch[1].trim();
        const aggressiveOs = nmapResult.stdout.match(/Running:\s*(.+)/);
        if (!result.osGuess && aggressiveOs) result.osGuess = aggressiveOs[1].trim();
      }
    } else {
      // Fallback: scan common ports with /usr/bin/nc
      const commonPorts = [
        21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445,
        993, 995, 1433, 3306, 3389, 5432, 5900, 8080, 8443,
      ];
      const scanPromises = commonPorts.map(async (port) => {
        const ncResult = await run(`/usr/bin/nc -z -w 2 "${target}" ${port} 2>&1`, 5000);
        if (ncResult.ok) {
          result.openPorts.push({
            port,
            protocol: 'tcp',
            state: 'open',
            service: serviceName(port),
          });
        }
      });
      await Promise.all(scanPromises);
      result.openPorts.sort((a, b) => a.port - b.port);
    }

    result.scanDuration = Date.now() - start;
    return result;
  }

  // -----------------------------------------------------------------------
  // 3. detectRemoteAccess
  // -----------------------------------------------------------------------
  async detectRemoteAccess() {
    const report = {
      timestamp: new Date().toISOString(),
      tools: [],
      sshEnabled: false,
      screenSharing: false,
      remoteManagement: false,
      suspiciousProcesses: [],
    };

    // Check each known remote access tool
    const psResult = await run('ps aux');
    const allProcs = psResult.ok ? psResult.stdout.toLowerCase() : '';

    for (const tool of REMOTE_ACCESS_TOOLS) {
      const running = allProcs.includes(tool.process.toLowerCase());
      let installed = false;
      if (tool.bundleId) {
        const findResult = await run(`mdfind "kMDItemCFBundleIdentifier == '${tool.bundleId}'" 2>/dev/null`);
        installed = findResult.ok && findResult.stdout.trim().length > 0;
      }
      if (running || installed) {
        report.tools.push({
          name: tool.name,
          running,
          installed,
        });
      }
    }

    // SSH
    const sshResult = await run('launchctl list | grep com.openssh.sshd');
    report.sshEnabled = sshResult.ok && sshResult.stdout.trim().length > 0;
    if (!report.sshEnabled) {
      const sysProfResult = await run('systemsetup -getremotelogin 2>/dev/null');
      if (sysProfResult.ok && sysProfResult.stdout.toLowerCase().includes('on')) {
        report.sshEnabled = true;
      }
    }

    // Screen Sharing
    const ssResult = await run('launchctl list | grep com.apple.screensharing');
    report.screenSharing = ssResult.ok && ssResult.stdout.trim().length > 0;

    // Remote Management
    const rmResult = await run('launchctl list | grep com.apple.RemoteDesktop');
    report.remoteManagement = rmResult.ok && rmResult.stdout.trim().length > 0;

    // Suspicious remote-access-like processes
    const suspiciousRemote = ['reverse', 'tunnel', 'proxy', 'ngrok', 'chisel', 'frp', 'bore'];
    if (psResult.ok) {
      const rows = lines(psResult.stdout).slice(1);
      for (const row of rows) {
        const lower = row.toLowerCase();
        if (suspiciousRemote.some((s) => lower.includes(s))) {
          const cols = row.split(/\s+/);
          report.suspiciousProcesses.push({
            pid: cols[1],
            user: cols[0],
            command: cols.slice(10).join(' '),
          });
        }
      }
    }

    return report;
  }

  // -----------------------------------------------------------------------
  // 4. analyzeFile
  // -----------------------------------------------------------------------
  async analyzeFile(filePath) {
    if (!filePath) throw new Error('filePath is required');
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const stat = fs.statSync(absPath);
    const report = {
      path: absPath,
      name: path.basename(absPath),
      size: stat.size,
      sizeHuman: stat.size > 1048576
        ? `${(stat.size / 1048576).toFixed(2)} MB`
        : `${(stat.size / 1024).toFixed(2)} KB`,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      permissions: '0' + (stat.mode & 0o777).toString(8),
      isExecutable: !!(stat.mode & 0o111),
      hashes: {},
      fileType: null,
      codeSignature: null,
      suspiciousStrings: [],
      riskScore: 0,
    };

    // Hashes
    const content = fs.readFileSync(absPath);
    report.hashes.md5 = crypto.createHash('md5').update(content).digest('hex');
    report.hashes.sha256 = crypto.createHash('sha256').update(content).digest('hex');

    // File type via `file`
    const fileResult = await run(`file -b "${absPath}"`);
    report.fileType = fileResult.ok ? fileResult.stdout.trim() : 'unknown';

    // Code signing
    const codesignResult = await run(`codesign -dvvv "${absPath}" 2>&1`);
    if (codesignResult.ok || codesignResult.stderr) {
      const output = codesignResult.stdout + codesignResult.stderr;
      if (output.includes('not signed')) {
        report.codeSignature = { signed: false, details: 'Not code-signed' };
        report.riskScore += 20;
      } else {
        const teamMatch = output.match(/TeamIdentifier=(\S+)/);
        const authorityMatch = output.match(/Authority=(.+)/);
        report.codeSignature = {
          signed: true,
          teamId: teamMatch ? teamMatch[1] : null,
          authority: authorityMatch ? authorityMatch[1].trim() : null,
        };
      }
    }

    // Suspicious strings (only for files < 10 MB)
    if (stat.size < 10 * 1024 * 1024) {
      const suspiciousPatterns = [
        { pattern: /eval\s*\(/gi, label: 'eval() call' },
        { pattern: /exec\s*\(/gi, label: 'exec() call' },
        { pattern: /base64/gi, label: 'base64 reference' },
        { pattern: /\/etc\/passwd/g, label: '/etc/passwd reference' },
        { pattern: /\/etc\/shadow/g, label: '/etc/shadow reference' },
        { pattern: /password/gi, label: 'password string' },
        { pattern: /keychain/gi, label: 'keychain reference' },
        { pattern: /reverse.{0,10}shell/gi, label: 'reverse shell reference' },
        { pattern: /bind.{0,10}shell/gi, label: 'bind shell reference' },
        { pattern: /0\.0\.0\.0/g, label: '0.0.0.0 binding' },
        { pattern: /subprocess|os\.system|popen/gi, label: 'system command execution' },
        { pattern: /LaunchAgent|LaunchDaemon/gi, label: 'persistence mechanism reference' },
        { pattern: /curl\s.*\|\s*sh/gi, label: 'pipe-to-shell pattern' },
        { pattern: /wget\s.*\|\s*sh/gi, label: 'pipe-to-shell pattern' },
      ];

      const text = content.toString('utf-8', 0, Math.min(content.length, 2 * 1024 * 1024));
      for (const { pattern, label } of suspiciousPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          report.suspiciousStrings.push({ label, count: matches.length });
          report.riskScore += 5;
        }
      }
    }

    if (report.isExecutable) report.riskScore += 10;
    report.riskScore = Math.min(report.riskScore, 100);

    return report;
  }

  // -----------------------------------------------------------------------
  // 5. getConnections
  // -----------------------------------------------------------------------
  async getConnections() {
    const connections = [];

    const lsofResult = await run('lsof -i -P -n 2>/dev/null');
    if (lsofResult.ok) {
      const rows = lines(lsofResult.stdout).slice(1);
      for (const row of rows) {
        const cols = row.split(/\s+/);
        if (cols.length < 9) continue;

        const nameField = cols.slice(8).join(' ');
        let localAddr = '';
        let remoteAddr = '';
        let state = '';
        let direction = '';

        // Parse the name field  e.g. 192.168.1.5:443->10.0.0.1:52341 (ESTABLISHED)
        const stateMatch = nameField.match(/\((\w+)\)/);
        if (stateMatch) state = stateMatch[1];

        const arrowMatch = nameField.match(/(.+)->(.+?)(?:\s|$)/);
        if (arrowMatch) {
          localAddr = arrowMatch[1].replace(/\(.*\)/, '').trim();
          remoteAddr = arrowMatch[2].replace(/\(.*\)/, '').trim();
          direction = 'outgoing';
        } else {
          localAddr = nameField.replace(/\(.*\)/, '').trim();
          direction = 'listening';
        }

        connections.push({
          process: cols[0],
          pid: parseInt(cols[1], 10),
          user: cols[2],
          type: cols[4],
          protocol: cols[7],
          localAddress: localAddr,
          remoteAddress: remoteAddr || null,
          state: state || (direction === 'listening' ? 'LISTEN' : ''),
          direction,
        });
      }
    } else {
      // Fallback to netstat
      const netstatResult = await run('netstat -an -p tcp 2>/dev/null');
      if (netstatResult.ok) {
        const rows = lines(netstatResult.stdout).slice(2);
        for (const row of rows) {
          const cols = row.split(/\s+/);
          if (cols.length >= 6) {
            connections.push({
              process: null,
              pid: null,
              user: null,
              type: 'IPv4',
              protocol: cols[0],
              localAddress: cols[3],
              remoteAddress: cols[4] !== '*.*' ? cols[4] : null,
              state: cols[5] || '',
              direction: cols[5] === 'LISTEN' ? 'listening' : 'outgoing',
            });
          }
        }
      }
    }

    return {
      timestamp: new Date().toISOString(),
      total: connections.length,
      listening: connections.filter((c) => c.direction === 'listening').length,
      outgoing: connections.filter((c) => c.direction === 'outgoing').length,
      connections,
    };
  }

  // -----------------------------------------------------------------------
  // 6. blockConnection
  // -----------------------------------------------------------------------
  async blockConnection(ip) {
    if (!ip) throw new Error('ip is required');
    if (!/^[\d.]+$/.test(ip) && !/^[a-fA-F0-9:]+$/.test(ip)) {
      throw new Error('Invalid IP address format');
    }

    const anchorName = 'apex_blocked';
    const pfRulesDir = '/etc/pf.anchors';
    const pfRulesFile = `${pfRulesDir}/${anchorName}`;

    // Read existing rules if any
    let existingRules = '';
    try {
      existingRules = fs.readFileSync(pfRulesFile, 'utf-8');
    } catch {
      // File does not exist yet
    }

    const blockRule = `block drop from ${ip} to any\nblock drop from any to ${ip}\n`;

    if (existingRules.includes(ip)) {
      return {
        success: true,
        alreadyBlocked: true,
        ip,
        message: `IP ${ip} is already blocked`,
      };
    }

    const newRules = existingRules + blockRule;

    // Write the anchor file and load it
    const writeResult = await run(`echo '${newRules}' | sudo tee "${pfRulesFile}" > /dev/null`);
    if (!writeResult.ok) {
      return {
        success: false,
        ip,
        message: `Failed to write rule file: ${writeResult.stderr}. Try running with sudo.`,
      };
    }

    // Ensure anchor is referenced in pf.conf
    const pfConf = await run('cat /etc/pf.conf');
    if (pfConf.ok && !pfConf.stdout.includes(anchorName)) {
      await run(
        `echo 'anchor "${anchorName}"\nload anchor "${anchorName}" from "${pfRulesFile}"' | sudo tee -a /etc/pf.conf > /dev/null`
      );
    }

    // Reload pf
    const reloadResult = await run(`sudo pfctl -f /etc/pf.conf 2>&1 && sudo pfctl -e 2>&1`);

    return {
      success: reloadResult.ok || reloadResult.stderr.includes('already enabled'),
      alreadyBlocked: false,
      ip,
      ruleFile: pfRulesFile,
      message: reloadResult.ok
        ? `IP ${ip} has been blocked via pf firewall`
        : `Firewall updated but enable may have issues: ${reloadResult.stderr}`,
    };
  }

  // -----------------------------------------------------------------------
  // 7. hardenSystem
  // -----------------------------------------------------------------------
  async hardenSystem() {
    const actions = [];

    // 1. Enable Application Firewall
    const fwStatus = await run('sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1');
    if (fwStatus.ok && fwStatus.stdout.toLowerCase().includes('disabled')) {
      const enableFw = await run('sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on 2>&1');
      actions.push({
        action: 'Enable Application Firewall',
        success: enableFw.ok,
        detail: enableFw.ok ? 'Firewall enabled' : enableFw.stderr,
      });
    } else {
      actions.push({
        action: 'Enable Application Firewall',
        success: true,
        detail: 'Already enabled',
        skipped: true,
      });
    }

    // 2. Enable stealth mode
    const stealthResult = await run('sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on 2>&1');
    actions.push({
      action: 'Enable Stealth Mode',
      success: stealthResult.ok,
      detail: stealthResult.ok ? 'Stealth mode enabled' : stealthResult.stderr,
    });

    // 3. Disable Remote Management
    const rmOff = await run('sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -deactivate -configure -access -off 2>&1');
    actions.push({
      action: 'Disable Remote Management',
      success: rmOff.ok || rmOff.stderr.includes('deactivated'),
      detail: rmOff.ok ? 'Remote management disabled' : rmOff.stderr.substring(0, 200),
    });

    // 4. Disable Remote Login (SSH)
    const sshOff = await run('sudo systemsetup -setremotelogin off 2>&1');
    actions.push({
      action: 'Disable Remote Login (SSH)',
      success: sshOff.ok || sshOff.stderr.includes('off'),
      detail: sshOff.ok ? 'SSH disabled' : sshOff.stderr.substring(0, 200),
    });

    // 5. Check FileVault
    const fvStatus = await run('fdesetup status 2>&1');
    const fvOn = fvStatus.ok && fvStatus.stdout.toLowerCase().includes('on');
    actions.push({
      action: 'Check FileVault',
      success: true,
      detail: fvOn ? 'FileVault is ON' : 'FileVault is OFF — enable it in System Preferences > Privacy & Security',
      requiresManual: !fvOn,
    });

    // 6. Check SIP
    const sipResult = await run('csrutil status 2>&1');
    const sipEnabled = sipResult.ok && sipResult.stdout.toLowerCase().includes('enabled');
    actions.push({
      action: 'Check System Integrity Protection',
      success: true,
      detail: sipEnabled ? 'SIP is enabled' : 'SIP is DISABLED — boot to Recovery and run csrutil enable',
      requiresManual: !sipEnabled,
    });

    // 7. Disable Bonjour multicast advertising
    const bonjourOff = await run('sudo defaults write /Library/Preferences/com.apple.mDNSResponder.plist NoMulticastAdvertisements -bool true 2>&1');
    actions.push({
      action: 'Disable Bonjour Advertising',
      success: bonjourOff.ok,
      detail: bonjourOff.ok ? 'Bonjour advertising disabled' : bonjourOff.stderr.substring(0, 200),
    });

    // 8. Require password on wake
    const wakePassword = await run('sysadminctl -screenLock immediate -password - 2>&1');
    const wakeAlt = await run('defaults write com.apple.screensaver askForPassword -int 1 2>&1');
    actions.push({
      action: 'Require password on wake',
      success: wakeAlt.ok,
      detail: wakeAlt.ok ? 'Password required on wake' : 'Could not set',
    });

    // 9. Disable automatic login
    const autoLoginOff = await run('sudo defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUser 2>&1');
    actions.push({
      action: 'Disable Automatic Login',
      success: autoLoginOff.ok || autoLoginOff.stderr.includes('does not exist'),
      detail: 'Auto-login disabled or already off',
    });

    return {
      timestamp: new Date().toISOString(),
      actionsPerformed: actions.length,
      actions,
      summary: actions.filter((a) => a.success && !a.skipped).length + ' hardening actions applied',
    };
  }

  // -----------------------------------------------------------------------
  // 8. checkVulnerabilities
  // -----------------------------------------------------------------------
  async checkVulnerabilities() {
    const vulnerabilities = [];

    // macOS version
    const swVersResult = await run('sw_vers -productVersion');
    const macVersion = swVersResult.ok ? swVersResult.stdout.trim() : 'unknown';
    const buildResult = await run('sw_vers -buildVersion');
    const build = buildResult.ok ? buildResult.stdout.trim() : '';

    // Check if macOS is outdated (simplified heuristic)
    const vParts = macVersion.split('.').map(Number);
    const majorVersion = vParts[0] || 0;
    const minorVersion = vParts[1] || 0;

    if (majorVersion < 14) {
      vulnerabilities.push({
        severity: 'high',
        category: 'OS',
        title: 'Outdated macOS version',
        detail: `Running macOS ${macVersion}. Versions before 14.x (Sonoma) may have unpatched CVEs.`,
        remediation: 'Update to the latest macOS version via System Preferences > Software Update',
      });
    } else if (majorVersion === 14 && minorVersion < 4) {
      vulnerabilities.push({
        severity: 'medium',
        category: 'OS',
        title: 'macOS may be missing recent patches',
        detail: `Running macOS ${macVersion}. Ensure latest security updates are installed.`,
        remediation: 'Check System Preferences > Software Update',
      });
    }

    // SIP
    const sipResult = await run('csrutil status 2>&1');
    if (sipResult.ok && sipResult.stdout.toLowerCase().includes('disabled')) {
      vulnerabilities.push({
        severity: 'critical',
        category: 'System',
        title: 'System Integrity Protection is DISABLED',
        detail: 'SIP protects critical system files. Disabling it exposes the system.',
        remediation: 'Boot into Recovery Mode and run: csrutil enable',
      });
    }

    // Gatekeeper
    const gkResult = await run('spctl --status 2>&1');
    if (gkResult.ok && gkResult.stdout.toLowerCase().includes('disabled')) {
      vulnerabilities.push({
        severity: 'high',
        category: 'System',
        title: 'Gatekeeper is DISABLED',
        detail: 'Gatekeeper prevents unsigned apps from running.',
        remediation: 'Run: sudo spctl --master-enable',
      });
    }

    // FileVault
    const fvResult = await run('fdesetup status 2>&1');
    if (fvResult.ok && fvResult.stdout.toLowerCase().includes('off')) {
      vulnerabilities.push({
        severity: 'high',
        category: 'Encryption',
        title: 'FileVault disk encryption is OFF',
        detail: 'Without FileVault, data on disk is not encrypted at rest.',
        remediation: 'Enable FileVault in System Preferences > Privacy & Security',
      });
    }

    // Firewall
    const fwResult = await run('/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1');
    if (fwResult.ok && fwResult.stdout.toLowerCase().includes('disabled')) {
      vulnerabilities.push({
        severity: 'medium',
        category: 'Network',
        title: 'Application Firewall is disabled',
        detail: 'The built-in firewall is not active.',
        remediation: 'Enable in System Preferences > Network > Firewall, or run the hardenSystem() method',
      });
    }

    // World-writable files in common locations
    const wwResult = await run('find /usr/local/bin /usr/local/sbin -perm -0002 -type f 2>/dev/null | head -20');
    if (wwResult.ok && wwResult.stdout.trim()) {
      const wwFiles = lines(wwResult.stdout);
      vulnerabilities.push({
        severity: 'medium',
        category: 'Permissions',
        title: 'World-writable executables found',
        detail: `${wwFiles.length} world-writable files in /usr/local: ${wwFiles.slice(0, 5).join(', ')}`,
        remediation: 'Fix permissions: chmod o-w <file>',
      });
    }

    // Check for Homebrew security
    const brewResult = await run('brew doctor 2>&1 | head -20');
    if (brewResult.ok && brewResult.stdout.includes('Warning')) {
      vulnerabilities.push({
        severity: 'low',
        category: 'Software',
        title: 'Homebrew warnings detected',
        detail: 'brew doctor reported warnings that may affect security.',
        remediation: 'Run: brew doctor and follow the recommendations',
      });
    }

    // SSH key permissions
    const sshDir = path.join(os.homedir(), '.ssh');
    if (fs.existsSync(sshDir)) {
      try {
        const sshStat = fs.statSync(sshDir);
        const sshPerms = (sshStat.mode & 0o777).toString(8);
        if (sshPerms !== '700') {
          vulnerabilities.push({
            severity: 'medium',
            category: 'Permissions',
            title: 'SSH directory has insecure permissions',
            detail: `~/.ssh has permissions ${sshPerms}, should be 700`,
            remediation: 'Run: chmod 700 ~/.ssh',
          });
        }

        const keyFiles = fs.readdirSync(sshDir).filter((f) => f.startsWith('id_') && !f.endsWith('.pub'));
        for (const kf of keyFiles) {
          const kfStat = fs.statSync(path.join(sshDir, kf));
          const kfPerms = (kfStat.mode & 0o777).toString(8);
          if (kfPerms !== '600') {
            vulnerabilities.push({
              severity: 'medium',
              category: 'Permissions',
              title: `SSH key ${kf} has insecure permissions`,
              detail: `~/.ssh/${kf} has permissions ${kfPerms}, should be 600`,
              remediation: `Run: chmod 600 ~/.ssh/${kf}`,
            });
          }
        }
      } catch {
        // skip
      }
    }

    // Sort by severity
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    vulnerabilities.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

    return {
      timestamp: new Date().toISOString(),
      macVersion,
      build,
      totalVulnerabilities: vulnerabilities.length,
      critical: vulnerabilities.filter((v) => v.severity === 'critical').length,
      high: vulnerabilities.filter((v) => v.severity === 'high').length,
      medium: vulnerabilities.filter((v) => v.severity === 'medium').length,
      low: vulnerabilities.filter((v) => v.severity === 'low').length,
      vulnerabilities,
    };
  }

  // -----------------------------------------------------------------------
  // 9. portScan
  // -----------------------------------------------------------------------
  async portScan(target, portRange = '1-1024') {
    if (!target) throw new Error('target is required');

    const result = {
      target,
      portRange,
      timestamp: new Date().toISOString(),
      openPorts: [],
      scanDuration: 0,
    };

    const start = Date.now();

    // Parse port range
    let ports = [];
    const rangeParts = portRange.split(',');
    for (const part of rangeParts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [startPort, endPort] = trimmed.split('-').map(Number);
        if (isNaN(startPort) || isNaN(endPort)) continue;
        const lo = Math.max(1, Math.min(startPort, endPort));
        const hi = Math.min(65535, Math.max(startPort, endPort));
        for (let p = lo; p <= hi; p++) ports.push(p);
      } else {
        const p = parseInt(trimmed, 10);
        if (!isNaN(p) && p >= 1 && p <= 65535) ports.push(p);
      }
    }

    // Cap at 10000 to avoid insane runtimes
    if (ports.length > 10000) ports = ports.slice(0, 10000);

    // Try nmap first for large ranges
    const nmapCheck = await run('which nmap');
    if (nmapCheck.ok && nmapCheck.stdout.trim() && ports.length > 100) {
      const nmapResult = await run(`nmap -p ${portRange} -sV -T4 "${target}" 2>/dev/null`, 120000);
      if (nmapResult.ok) {
        const portRegex = /^(\d+)\/(tcp|udp)\s+(open)\s+(.*)$/gm;
        let match;
        while ((match = portRegex.exec(nmapResult.stdout)) !== null) {
          result.openPorts.push({
            port: parseInt(match[1], 10),
            protocol: match[2],
            state: 'open',
            service: match[4].trim() || serviceName(parseInt(match[1], 10)),
          });
        }
        result.scanDuration = Date.now() - start;
        return result;
      }
    }

    // Native TCP connect scan with batching
    const BATCH_SIZE = 50;
    for (let i = 0; i < ports.length; i += BATCH_SIZE) {
      const batch = ports.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (port) => {
        const ncResult = await run(`/usr/bin/nc -z -w 1 "${target}" ${port} 2>&1`, 3000);
        if (ncResult.ok) {
          result.openPorts.push({
            port,
            protocol: 'tcp',
            state: 'open',
            service: serviceName(port),
          });
        }
      });
      await Promise.all(batchPromises);
    }

    result.openPorts.sort((a, b) => a.port - b.port);
    result.scanDuration = Date.now() - start;
    return result;
  }

  // -----------------------------------------------------------------------
  // 10. analyzeTraffic
  // -----------------------------------------------------------------------
  async analyzeTraffic(duration = 10) {
    const seconds = Math.min(Math.max(1, duration), 60);
    const captureFile = `/tmp/apex_capture_${Date.now()}.pcap`;

    const report = {
      timestamp: new Date().toISOString(),
      duration: seconds,
      captureFile,
      totalPackets: 0,
      protocols: {},
      topTalkers: {},
      suspiciousPatterns: [],
      connections: [],
    };

    // Capture with tcpdump
    const captureResult = await run(
      `sudo tcpdump -c 500 -w "${captureFile}" -i any 2>&1 &
       TCPDUMP_PID=$!
       sleep ${seconds}
       sudo kill $TCPDUMP_PID 2>/dev/null
       wait $TCPDUMP_PID 2>/dev/null
       echo "DONE"`,
      (seconds + 10) * 1000
    );

    // Read back with tcpdump -r
    const readResult = await run(`sudo tcpdump -r "${captureFile}" -nn -q 2>/dev/null`);
    if (!readResult.ok) {
      // Fallback: use live capture text mode
      const liveResult = await run(
        `sudo tcpdump -i any -nn -q -c 200 2>/dev/null`,
        (seconds + 10) * 1000
      );
      if (liveResult.ok) {
        readResult.ok = true;
        readResult.stdout = liveResult.stdout;
      }
    }

    if (readResult.ok) {
      const packetLines = lines(readResult.stdout);
      report.totalPackets = packetLines.length;

      for (const line of packetLines) {
        // Protocol detection
        if (line.includes(' TCP ') || line.match(/\.\d+ > .+\.\d+:/)) {
          report.protocols['TCP'] = (report.protocols['TCP'] || 0) + 1;
        } else if (line.includes(' UDP ') || line.includes('.domain') || line.includes('.53:')) {
          report.protocols['UDP'] = (report.protocols['UDP'] || 0) + 1;
        } else if (line.includes(' ICMP ') || line.includes('icmp')) {
          report.protocols['ICMP'] = (report.protocols['ICMP'] || 0) + 1;
        } else if (line.includes(' ARP ')) {
          report.protocols['ARP'] = (report.protocols['ARP'] || 0) + 1;
        } else {
          report.protocols['Other'] = (report.protocols['Other'] || 0) + 1;
        }

        // Extract IPs for top talkers
        const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/g);
        if (ipMatch) {
          for (const ip of ipMatch) {
            if (ip !== '0.0.0.0' && ip !== '255.255.255.255') {
              report.topTalkers[ip] = (report.topTalkers[ip] || 0) + 1;
            }
          }
        }

        // Connection tracking (src > dst)
        const connMatch = line.match(/(\d+\.\d+\.\d+\.\d+)\.(\d+)\s*>\s*(\d+\.\d+\.\d+\.\d+)\.(\d+)/);
        if (connMatch) {
          report.connections.push({
            srcIp: connMatch[1],
            srcPort: parseInt(connMatch[2], 10),
            dstIp: connMatch[3],
            dstPort: parseInt(connMatch[4], 10),
          });
        }
      }

      // Detect suspicious patterns
      const topTalkersSorted = Object.entries(report.topTalkers)
        .sort((a, b) => b[1] - a[1]);

      // Excessive traffic from a single IP
      if (topTalkersSorted.length > 0 && topTalkersSorted[0][1] > report.totalPackets * 0.6) {
        report.suspiciousPatterns.push({
          type: 'traffic_flood',
          detail: `IP ${topTalkersSorted[0][0]} accounts for ${topTalkersSorted[0][1]}/${report.totalPackets} packets`,
          severity: 'medium',
        });
      }

      // Excessive ICMP
      if ((report.protocols['ICMP'] || 0) > 20) {
        report.suspiciousPatterns.push({
          type: 'icmp_flood',
          detail: `${report.protocols['ICMP']} ICMP packets detected`,
          severity: 'medium',
        });
      }

      // DNS exfiltration indicator (lots of DNS)
      if ((report.protocols['UDP'] || 0) > report.totalPackets * 0.7 && report.totalPackets > 50) {
        report.suspiciousPatterns.push({
          type: 'dns_exfiltration_suspect',
          detail: 'Unusually high proportion of UDP traffic — possible DNS tunneling',
          severity: 'high',
        });
      }

      // Connections to unusual ports
      const unusualPorts = report.connections.filter(
        (c) => c.dstPort > 10000 && c.dstPort !== 443 && c.dstPort !== 80
      );
      if (unusualPorts.length > 10) {
        report.suspiciousPatterns.push({
          type: 'unusual_ports',
          detail: `${unusualPorts.length} connections to high-numbered ports detected`,
          severity: 'low',
        });
      }

      // Convert topTalkers to sorted array
      report.topTalkers = topTalkersSorted.slice(0, 20).map(([ip, count]) => ({ ip, packets: count }));
      // Trim connections to first 100
      report.connections = report.connections.slice(0, 100);
    }

    // Clean up capture file
    try { fs.unlinkSync(captureFile); } catch { /* ignore */ }

    return report;
  }

  // -----------------------------------------------------------------------
  // 11. lockApp
  // -----------------------------------------------------------------------
  async lockApp(password) {
    if (!password || typeof password !== 'string' || password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

    this._appLocked = true;
    this._appPasswordHash = { salt, hash };

    // Persist lock state to disk
    const lockFile = path.join(os.homedir(), '.apex_lock.json');
    const lockData = {
      locked: true,
      salt,
      hash,
      lockedAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2), { mode: 0o600 });

    return {
      success: true,
      locked: true,
      lockFile,
      message: 'elashry ai app is now locked. Use unlockApp(password) to unlock.',
    };
  }

  /**
   * Unlock the app with the correct password.
   */
  async unlockApp(password) {
    const lockFile = path.join(os.homedir(), '.apex_lock.json');

    let lockData;
    if (this._appPasswordHash) {
      lockData = this._appPasswordHash;
    } else if (fs.existsSync(lockFile)) {
      lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    } else {
      return { success: true, locked: false, message: 'App is not locked' };
    }

    const testHash = crypto.pbkdf2Sync(password, lockData.salt, 100000, 64, 'sha512').toString('hex');
    if (testHash === lockData.hash) {
      this._appLocked = false;
      this._appPasswordHash = null;
      try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
      return { success: true, locked: false, message: 'App unlocked successfully' };
    }

    return { success: false, locked: true, message: 'Incorrect password' };
  }

  /**
   * Check if the app is currently locked.
   */
  isLocked() {
    if (this._appLocked) return true;
    const lockFile = path.join(os.homedir(), '.apex_lock.json');
    if (fs.existsSync(lockFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        return data.locked === true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // 12. intrusionDetection
  // -----------------------------------------------------------------------
  async intrusionDetection() {
    const report = {
      timestamp: new Date().toISOString(),
      indicators: [],
      riskLevel: 'low',
      checksPerformed: [],
    };

    // 1. Check for new/unknown LaunchAgents added recently (last 7 days)
    const recentAgents = await run(
      'find ~/Library/LaunchAgents /Library/LaunchAgents /Library/LaunchDaemons -name "*.plist" -mtime -7 2>/dev/null'
    );
    if (recentAgents.ok && recentAgents.stdout.trim()) {
      const agents = lines(recentAgents.stdout);
      const nonApple = agents.filter((a) => !a.includes('com.apple.'));
      if (nonApple.length > 0) {
        report.indicators.push({
          type: 'persistence',
          severity: 'high',
          detail: `${nonApple.length} non-Apple LaunchAgent/Daemon plist(s) modified in the last 7 days`,
          items: nonApple,
        });
      }
    }
    report.checksPerformed.push('Recent LaunchAgent/Daemon changes');

    // 2. Check for unexpected cron jobs
    const cronResult = await run('crontab -l 2>/dev/null');
    if (cronResult.ok && cronResult.stdout.trim()) {
      const cronEntries = lines(cronResult.stdout).filter((l) => !l.startsWith('#'));
      if (cronEntries.length > 0) {
        report.indicators.push({
          type: 'persistence',
          severity: 'medium',
          detail: `${cronEntries.length} cron job(s) found`,
          items: cronEntries,
        });
      }
    }
    report.checksPerformed.push('Cron jobs');

    // 3. Check /etc/hosts for tampering
    const hostsResult = await run('cat /etc/hosts');
    if (hostsResult.ok) {
      const hostEntries = lines(hostsResult.stdout).filter(
        (l) => !l.startsWith('#') && l.length > 0 && !l.startsWith('127.0.0.1') && !l.startsWith('::1') && !l.startsWith('255.255.255.255') && !l.includes('broadcasthost') && !l.startsWith('fe80::')
      );
      if (hostEntries.length > 0) {
        report.indicators.push({
          type: 'dns_hijack',
          severity: 'medium',
          detail: `${hostEntries.length} custom entries in /etc/hosts`,
          items: hostEntries,
        });
      }
    }
    report.checksPerformed.push('/etc/hosts integrity');

    // 4. Check for suspicious processes
    const psResult = await run('ps aux');
    if (psResult.ok) {
      const rows = lines(psResult.stdout).slice(1);
      const suspicious = [];
      for (const row of rows) {
        const lower = row.toLowerCase();
        const badKeywords = [
          'reverse_tcp', 'bind_tcp', 'meterpreter', 'payload',
          'exploit', 'keylog', 'cryptomin', 'xmrig', 'coinhive',
          'shell_reverse', 'backdoor', 'rat_', 'c2_', 'beacon',
        ];
        if (badKeywords.some((kw) => lower.includes(kw))) {
          const cols = row.split(/\s+/);
          suspicious.push({
            pid: cols[1],
            user: cols[0],
            cpu: cols[2],
            mem: cols[3],
            command: cols.slice(10).join(' '),
          });
        }
      }
      if (suspicious.length > 0) {
        report.indicators.push({
          type: 'malicious_process',
          severity: 'critical',
          detail: `${suspicious.length} potentially malicious process(es) running`,
          items: suspicious,
        });
      }
    }
    report.checksPerformed.push('Suspicious processes');

    // 5. Check for new SUID binaries outside standard locations
    const suidResult = await run(
      'find /usr/local /opt /tmp /var/tmp -perm -4000 -type f 2>/dev/null | head -20'
    );
    if (suidResult.ok && suidResult.stdout.trim()) {
      const suidFiles = lines(suidResult.stdout);
      report.indicators.push({
        type: 'privilege_escalation',
        severity: 'high',
        detail: `${suidFiles.length} SUID binary(ies) found in non-standard locations`,
        items: suidFiles,
      });
    }
    report.checksPerformed.push('SUID binaries in non-standard paths');

    // 6. Check for unauthorized SSH keys
    const authKeysFile = path.join(os.homedir(), '.ssh', 'authorized_keys');
    if (fs.existsSync(authKeysFile)) {
      try {
        const authKeys = fs.readFileSync(authKeysFile, 'utf-8');
        const keys = lines(authKeys).filter((l) => !l.startsWith('#'));
        if (keys.length > 0) {
          report.indicators.push({
            type: 'unauthorized_access',
            severity: 'medium',
            detail: `${keys.length} SSH authorized key(s) found — verify they are all legitimate`,
            items: keys.map((k) => {
              const parts = k.split(' ');
              return parts.length >= 3 ? parts.slice(2).join(' ') : parts[0].substring(0, 20) + '...';
            }),
          });
        }
      } catch {
        // skip
      }
    }
    report.checksPerformed.push('SSH authorized_keys');

    // 7. Check for recently modified binaries in PATH
    const recentBins = await run(
      'find /usr/local/bin -mtime -3 -type f 2>/dev/null | head -20'
    );
    if (recentBins.ok && recentBins.stdout.trim()) {
      const bins = lines(recentBins.stdout);
      if (bins.length > 5) {
        report.indicators.push({
          type: 'binary_tampering',
          severity: 'medium',
          detail: `${bins.length} binaries in /usr/local/bin modified in the last 3 days`,
          items: bins.slice(0, 10),
        });
      }
    }
    report.checksPerformed.push('Recently modified binaries');

    // 8. Check for unusual network connections
    const netResult = await run('lsof -i -P -n 2>/dev/null');
    if (netResult.ok) {
      const rows = lines(netResult.stdout).slice(1);
      const established = rows.filter((r) => r.includes('ESTABLISHED'));
      const foreignIps = new Set();
      for (const row of established) {
        const ipMatch = row.match(/->(\d+\.\d+\.\d+\.\d+):/);
        if (ipMatch) {
          const ip = ipMatch[1];
          if (!ip.startsWith('127.') && !ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('172.')) {
            foreignIps.add(ip);
          }
        }
      }
      if (foreignIps.size > 10) {
        report.indicators.push({
          type: 'c2_communication',
          severity: 'medium',
          detail: `${foreignIps.size} unique external IPs with established connections`,
          items: Array.from(foreignIps).slice(0, 20),
        });
      }
    }
    report.checksPerformed.push('Unusual network connections');

    // 9. Check login history for anomalies
    const lastResult = await run('last -20 2>/dev/null');
    if (lastResult.ok) {
      const logins = lines(lastResult.stdout);
      const rootLogins = logins.filter((l) => l.startsWith('root'));
      if (rootLogins.length > 0) {
        report.indicators.push({
          type: 'unauthorized_access',
          severity: 'medium',
          detail: `${rootLogins.length} root login(s) in recent history`,
          items: rootLogins.slice(0, 5),
        });
      }
    }
    report.checksPerformed.push('Login history');

    // 10. Check for hidden files in home directory
    const hiddenResult = await run(`ls -la "${os.homedir()}" | grep "^\\." 2>/dev/null`);
    // Check for suspicious hidden dirs created recently
    const suspHidden = await run(
      `find "${os.homedir()}" -maxdepth 1 -name ".*" -not -name ".Trash" -not -name ".ssh" -not -name ".zshrc" -not -name ".bashrc" -not -name ".bash_profile" -not -name ".gitconfig" -not -name ".npm" -not -name ".config" -not -name ".local" -not -name ".cache" -not -name "." -not -name ".." -not -name ".DS_Store" -not -name ".CFUserTextEncoding" -not -name ".vscode" -not -name ".cursor*" -mtime -7 -type d 2>/dev/null`
    );
    if (suspHidden.ok && suspHidden.stdout.trim()) {
      const hiddenDirs = lines(suspHidden.stdout);
      if (hiddenDirs.length > 0) {
        report.indicators.push({
          type: 'hidden_files',
          severity: 'low',
          detail: `${hiddenDirs.length} recently created hidden directory(ies) in home`,
          items: hiddenDirs,
        });
      }
    }
    report.checksPerformed.push('Hidden directories');

    // Determine risk level
    const hasCritical = report.indicators.some((i) => i.severity === 'critical');
    const hasHigh = report.indicators.some((i) => i.severity === 'high');
    const hasMedium = report.indicators.some((i) => i.severity === 'medium');

    if (hasCritical) report.riskLevel = 'critical';
    else if (hasHigh) report.riskLevel = 'high';
    else if (hasMedium && report.indicators.length >= 3) report.riskLevel = 'high';
    else if (hasMedium) report.riskLevel = 'medium';

    return report;
  }
}

module.exports = { SecurityEngine };
