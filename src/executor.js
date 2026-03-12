const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class Executor {
    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'apex-executor');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async execute(code, language) {
        const lang = (language || 'javascript').toLowerCase();
        const handlers = {
            'javascript': this.executeJavaScript.bind(this),
            'js': this.executeJavaScript.bind(this),
            'python': this.executePython.bind(this),
            'py': this.executePython.bind(this),
            'bash': this.executeBash.bind(this),
            'sh': this.executeBash.bind(this),
            'shell': this.executeBash.bind(this),
            'applescript': this.executeAppleScript.bind(this),
            'swift': this.executeSwift.bind(this),
            'html': this.executeHTML.bind(this),
            'c': this.executeC.bind(this),
            'cpp': this.executeCpp.bind(this),
            'rust': this.executeRust.bind(this),
            'go': this.executeGo.bind(this),
            'ruby': this.executeRuby.bind(this),
            'php': this.executePHP.bind(this),
            'java': this.executeJava.bind(this),
            'typescript': this.executeTypeScript.bind(this),
            'ts': this.executeTypeScript.bind(this)
        };

        const handler = handlers[lang];
        if (!handler) {
            return { stdout: '', stderr: `Unsupported language: ${lang}`, exitCode: 1 };
        }

        return handler(code);
    }

    async runCommand(command) {
        return new Promise((resolve) => {
            exec(command, {
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
                shell: '/bin/zsh',
                env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` }
            }, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    exitCode: error ? error.code || 1 : 0
                });
            });
        });
    }

    async runAppleScript(script) {
        return new Promise((resolve) => {
            const escaped = script.replace(/'/g, "'\\''");
            exec(`osascript -e '${escaped}'`, {
                timeout: 15000
            }, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    exitCode: error ? error.code || 1 : 0
                });
            });
        });
    }

    async executeJavaScript(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.js`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`node "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executePython(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.py`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`python3.11 "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executeBash(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.sh`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`bash "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executeAppleScript(code) {
        return this.runAppleScript(code);
    }

    async executeSwift(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.swift`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`swift "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executeHTML(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.html`);
        fs.writeFileSync(filePath, code);
        exec(`open "${filePath}"`);
        return { stdout: `HTML file opened: ${filePath}`, stderr: '', exitCode: 0 };
    }

    async executeC(code) {
        const srcPath = path.join(this.tempDir, `exec_${Date.now()}.c`);
        const outPath = srcPath.replace('.c', '');
        fs.writeFileSync(srcPath, code);
        try {
            const compileResult = await this.runCommand(`gcc "${srcPath}" -o "${outPath}"`);
            if (compileResult.exitCode !== 0) return compileResult;
            return await this.runCommand(`"${outPath}"`);
        } finally {
            this.cleanup(srcPath);
            this.cleanup(outPath);
        }
    }

    async executeCpp(code) {
        const srcPath = path.join(this.tempDir, `exec_${Date.now()}.cpp`);
        const outPath = srcPath.replace('.cpp', '');
        fs.writeFileSync(srcPath, code);
        try {
            const compileResult = await this.runCommand(`g++ -std=c++17 "${srcPath}" -o "${outPath}"`);
            if (compileResult.exitCode !== 0) return compileResult;
            return await this.runCommand(`"${outPath}"`);
        } finally {
            this.cleanup(srcPath);
            this.cleanup(outPath);
        }
    }

    async executeRust(code) {
        const srcPath = path.join(this.tempDir, `exec_${Date.now()}.rs`);
        const outPath = srcPath.replace('.rs', '');
        fs.writeFileSync(srcPath, code);
        try {
            const compileResult = await this.runCommand(`rustc "${srcPath}" -o "${outPath}"`);
            if (compileResult.exitCode !== 0) return compileResult;
            return await this.runCommand(`"${outPath}"`);
        } finally {
            this.cleanup(srcPath);
            this.cleanup(outPath);
        }
    }

    async executeGo(code) {
        const srcPath = path.join(this.tempDir, `exec_${Date.now()}.go`);
        fs.writeFileSync(srcPath, code);
        try {
            return await this.runCommand(`go run "${srcPath}"`);
        } finally {
            this.cleanup(srcPath);
        }
    }

    async executeRuby(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.rb`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`ruby "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executePHP(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.php`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`php "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    async executeJava(code) {
        const classMatch = code.match(/class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : 'Main';
        const srcPath = path.join(this.tempDir, `${className}.java`);
        fs.writeFileSync(srcPath, code);
        try {
            const compileResult = await this.runCommand(`javac "${srcPath}"`);
            if (compileResult.exitCode !== 0) return compileResult;
            return await this.runCommand(`cd "${this.tempDir}" && java ${className}`);
        } finally {
            this.cleanup(srcPath);
            this.cleanup(srcPath.replace('.java', '.class'));
        }
    }

    async executeTypeScript(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.ts`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`npx ts-node "${filePath}" 2>/dev/null || npx tsx "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    cleanup(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {}
    }
}

module.exports = Executor;
