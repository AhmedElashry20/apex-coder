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
        const lang = (language || 'javascript').toLowerCase().trim();
        const handlers = {
            // ─── Web & Scripting ───
            'javascript':   this.executeJavaScript.bind(this),
            'js':           this.executeJavaScript.bind(this),
            'node':         this.executeJavaScript.bind(this),
            'typescript':   this.executeTypeScript.bind(this),
            'ts':           this.executeTypeScript.bind(this),
            'tsx':          this.executeTypeScript.bind(this),
            'jsx':          this.executeJavaScript.bind(this),
            'python':       this.executePython.bind(this),
            'py':           this.executePython.bind(this),
            'python3':      this.executePython.bind(this),
            'ruby':         this.executeRuby.bind(this),
            'rb':           this.executeRuby.bind(this),
            'php':          this.executePHP.bind(this),
            'perl':         this.executePerl.bind(this),
            'pl':           this.executePerl.bind(this),
            'lua':          this.executeLua.bind(this),
            'r':            this.executeR.bind(this),
            'rscript':      this.executeR.bind(this),

            // ─── Shell ───
            'bash':         this.executeBash.bind(this),
            'sh':           this.executeBash.bind(this),
            'shell':        this.executeBash.bind(this),
            'zsh':          this.executeZsh.bind(this),
            'fish':         this.executeFish.bind(this),
            'powershell':   this.executePowerShell.bind(this),
            'ps1':          this.executePowerShell.bind(this),
            'bat':          this.executeBash.bind(this),
            'cmd':          this.executeBash.bind(this),
            'applescript':  this.executeAppleScript.bind(this),

            // ─── Compiled — Systems ───
            'c':            this.executeC.bind(this),
            'cpp':          this.executeCpp.bind(this),
            'c++':          this.executeCpp.bind(this),
            'cxx':          this.executeCpp.bind(this),
            'objective-c':  this.executeObjectiveC.bind(this),
            'objc':         this.executeObjectiveC.bind(this),
            'rust':         this.executeRust.bind(this),
            'rs':           this.executeRust.bind(this),
            'go':           this.executeGo.bind(this),
            'golang':       this.executeGo.bind(this),
            'zig':          this.executeZig.bind(this),
            'nim':          this.executeNim.bind(this),
            'assembly':     this.executeAssembly.bind(this),
            'asm':          this.executeAssembly.bind(this),
            'nasm':         this.executeAssembly.bind(this),

            // ─── JVM ───
            'java':         this.executeJava.bind(this),
            'kotlin':       this.executeKotlin.bind(this),
            'kt':           this.executeKotlin.bind(this),
            'scala':        this.executeScala.bind(this),
            'groovy':       this.executeGroovy.bind(this),
            'clojure':      this.executeClojure.bind(this),
            'clj':          this.executeClojure.bind(this),

            // ─── .NET ───
            'csharp':       this.executeCSharp.bind(this),
            'c#':           this.executeCSharp.bind(this),
            'cs':           this.executeCSharp.bind(this),
            'fsharp':       this.executeFSharp.bind(this),
            'f#':           this.executeFSharp.bind(this),

            // ─── Apple ───
            'swift':        this.executeSwift.bind(this),

            // ─── Mobile ───
            'dart':         this.executeDart.bind(this),

            // ─── Functional ───
            'haskell':      this.executeHaskell.bind(this),
            'hs':           this.executeHaskell.bind(this),
            'elixir':       this.executeElixir.bind(this),
            'ex':           this.executeElixir.bind(this),
            'erlang':       this.executeErlang.bind(this),
            'erl':          this.executeErlang.bind(this),
            'ocaml':        this.executeOCaml.bind(this),
            'ml':           this.executeOCaml.bind(this),
            'lisp':         this.executeLisp.bind(this),
            'scheme':       this.executeScheme.bind(this),
            'racket':       this.executeRacket.bind(this),
            'prolog':       this.executeProlog.bind(this),

            // ─── Scientific ───
            'julia':        this.executeJulia.bind(this),
            'jl':           this.executeJulia.bind(this),
            'matlab':       this.executeOctave.bind(this),
            'octave':       this.executeOctave.bind(this),
            'fortran':      this.executeFortran.bind(this),
            'f90':          this.executeFortran.bind(this),

            // ─── Data & Config ───
            'sql':          this.executeSQL.bind(this),
            'sqlite':       this.executeSQL.bind(this),
            'graphql':      this.executeGraphQL.bind(this),

            // ─── Markup / Web ───
            'html':         this.executeHTML.bind(this),
            'css':          this.executeHTML.bind(this),
            'svg':          this.executeHTML.bind(this),
            'markdown':     this.executeMarkdown.bind(this),
            'md':           this.executeMarkdown.bind(this),
            'latex':        this.executeLaTeX.bind(this),
            'tex':          this.executeLaTeX.bind(this),

            // ─── Blockchain ───
            'solidity':     this.executeSolidity.bind(this),
            'sol':          this.executeSolidity.bind(this),

            // ─── DevOps ───
            'dockerfile':   this.executeDockerfile.bind(this),
            'docker':       this.executeDockerfile.bind(this),
            'terraform':    this.executeTerraform.bind(this),
            'tf':           this.executeTerraform.bind(this),
            'yaml':         this.executeYAML.bind(this),
            'yml':          this.executeYAML.bind(this),

            // ─── Other ───
            'pascal':       this.executePascal.bind(this),
            'delphi':       this.executePascal.bind(this),
            'd':            this.executeD.bind(this),
            'dlang':        this.executeD.bind(this),
            'crystal':      this.executeCrystal.bind(this),
            'v':            this.executeV.bind(this),
            'vlang':        this.executeV.bind(this),
            'coffeescript': this.executeCoffeeScript.bind(this),
            'coffee':       this.executeCoffeeScript.bind(this),
            'awk':          this.executeAwk.bind(this),
            'sed':          this.executeSed.bind(this),
            'tcl':          this.executeTcl.bind(this),
            'wasm':         this.executeWasm.bind(this),
            'webassembly':  this.executeWasm.bind(this),
        };

        const handler = handlers[lang];
        if (!handler) {
            // Try to auto-detect language from code
            const detected = this.detectLanguage(code);
            if (detected && handlers[detected]) {
                return handlers[detected](code);
            }
            return { stdout: '', stderr: `Language "${lang}" not recognized. Supported: ${Object.keys(handlers).filter((v,i,a) => a.indexOf(v) === i).join(', ')}`, exitCode: 1 };
        }

        return handler(code);
    }

    detectLanguage(code) {
        if (code.match(/^#!\s*\/usr\/bin\/env\s+python/m) || code.match(/^import\s/m) && code.match(/def\s/m)) return 'python';
        if (code.match(/^#!\s*\/usr\/bin\/env\s+node/m) || code.match(/const\s|let\s|var\s/) && code.match(/=>/)) return 'javascript';
        if (code.match(/^#!\s*\/bin\/(ba)?sh/m)) return 'bash';
        if (code.match(/^package\s+main/m) && code.match(/func\s+main/m)) return 'go';
        if (code.match(/fn\s+main/m) && code.match(/let\s+mut/m)) return 'rust';
        if (code.match(/public\s+static\s+void\s+main/m)) return 'java';
        if (code.match(/^#include/m) && code.match(/int\s+main/m)) return 'c';
        if (code.match(/println!/)) return 'rust';
        if (code.match(/fmt\.Println/)) return 'go';
        if (code.match(/Console\.WriteLine/)) return 'csharp';
        if (code.match(/System\.out\.println/)) return 'java';
        if (code.match(/puts\s/m) || code.match(/def\s.*\n.*end$/m)) return 'ruby';
        if (code.match(/<\?php/)) return 'php';
        if (code.match(/^import\s+Foundation/m) || code.match(/^import\s+SwiftUI/m)) return 'swift';
        if (code.match(/^import\s+'dart:/m) || code.match(/void\s+main\(\)/m) && code.match(/print\(/)) return 'dart';
        return null;
    }

    async runCommand(command, timeout = 30000) {
        return new Promise((resolve) => {
            exec(command, {
                timeout,
                maxBuffer: 10 * 1024 * 1024,
                shell: '/bin/zsh',
                env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/local/go/bin:${process.env.HOME}/.cargo/bin:${process.env.HOME}/.juliaup/bin:${process.env.PATH}` }
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
            exec(`osascript -e '${escaped}'`, { timeout: 15000 }, (error, stdout, stderr) => {
                resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: error ? error.code || 1 : 0 });
            });
        });
    }

    // ─── Helper: compile & run ───
    async compileAndRun(srcPath, outPath, compileCmd) {
        fs.writeFileSync(srcPath, arguments[3] || '');
        try {
            const compileResult = await this.runCommand(compileCmd, 60000);
            if (compileResult.exitCode !== 0) return compileResult;
            return await this.runCommand(`"${outPath}"`);
        } finally {
            this.cleanup(srcPath);
            this.cleanup(outPath);
        }
    }

    // ─── Helper: script runner ───
    async runScript(code, ext, cmd) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}${ext}`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`${cmd} "${filePath}"`);
        } finally {
            this.cleanup(filePath);
        }
    }

    // ═══════════════════════════════════════
    //  Web & Scripting Languages
    // ═══════════════════════════════════════

    async executeJavaScript(code) { return this.runScript(code, '.js', 'node'); }
    async executePython(code) { return this.runScript(code, '.py', 'python3.11 2>/dev/null || python3'); }

    async executeTypeScript(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.ts`);
        fs.writeFileSync(filePath, code);
        try {
            return await this.runCommand(`npx tsx "${filePath}" 2>/dev/null || npx ts-node "${filePath}"`);
        } finally { this.cleanup(filePath); }
    }

    async executeRuby(code) { return this.runScript(code, '.rb', 'ruby'); }
    async executePHP(code) { return this.runScript(code, '.php', 'php'); }
    async executePerl(code) { return this.runScript(code, '.pl', 'perl'); }
    async executeLua(code) { return this.runScript(code, '.lua', 'lua 2>/dev/null || lua5.4'); }

    async executeR(code) { return this.runScript(code, '.R', 'Rscript'); }

    // ═══════════════════════════════════════
    //  Shell Languages
    // ═══════════════════════════════════════

    async executeBash(code) { return this.runScript(code, '.sh', 'bash'); }
    async executeZsh(code) { return this.runScript(code, '.zsh', 'zsh'); }
    async executeFish(code) { return this.runScript(code, '.fish', 'fish'); }
    async executePowerShell(code) { return this.runScript(code, '.ps1', 'pwsh 2>/dev/null || powershell'); }
    async executeAppleScript(code) { return this.runAppleScript(code); }

    // ═══════════════════════════════════════
    //  Compiled — Systems Languages
    // ═══════════════════════════════════════

    async executeC(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.c`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`gcc "${src}" -o "${out}" -lm`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    async executeCpp(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.cpp`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`g++ -std=c++20 "${src}" -o "${out}"`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    async executeObjectiveC(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.m`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`clang -framework Foundation "${src}" -o "${out}"`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    async executeRust(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.rs`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`rustc "${src}" -o "${out}"`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    async executeGo(code) { return this.runScript(code, '.go', 'go run'); }

    async executeZig(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.zig`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`zig run "${src}"`, 60000);
        } finally { this.cleanup(src); }
    }

    async executeNim(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.nim`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`nim compile --run --verbosity:0 --hints:off "${src}"`, 60000);
        } finally { this.cleanup(src); this.cleanup(src.replace('.nim', '')); }
    }

    async executeAssembly(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.asm`);
        const obj = path.join(this.tempDir, `exec_${ts}.o`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const a = await this.runCommand(`nasm -f macho64 "${src}" -o "${obj}" && ld -o "${out}" "${obj}" -lSystem -L$(xcode-select -p)/SDKs/MacOSX.sdk/usr/lib`, 60000);
            if (a.exitCode !== 0) return a;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(obj); this.cleanup(out); }
    }

    // ═══════════════════════════════════════
    //  JVM Languages
    // ═══════════════════════════════════════

    async executeJava(code) {
        const classMatch = code.match(/class\s+(\w+)/);
        const className = classMatch ? classMatch[1] : 'Main';
        const src = path.join(this.tempDir, `${className}.java`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`javac "${src}"`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`cd "${this.tempDir}" && java ${className}`);
        } finally { this.cleanup(src); this.cleanup(src.replace('.java', '.class')); }
    }

    async executeKotlin(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.kts`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`kotlinc -script "${src}"`, 120000);
        } finally { this.cleanup(src); }
    }

    async executeScala(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.scala`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`scala "${src}" 2>/dev/null || scala-cli run "${src}"`, 120000);
        } finally { this.cleanup(src); }
    }

    async executeGroovy(code) { return this.runScript(code, '.groovy', 'groovy'); }

    async executeClojure(code) {
        const src = path.join(this.tempDir, `exec_${Date.now()}.clj`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`clojure "${src}" 2>/dev/null || clj -M "${src}"`, 60000);
        } finally { this.cleanup(src); }
    }

    // ═══════════════════════════════════════
    //  .NET Languages
    // ═══════════════════════════════════════

    async executeCSharp(code) {
        const ts = Date.now();
        const projDir = path.join(this.tempDir, `cs_${ts}`);
        fs.mkdirSync(projDir, { recursive: true });
        try {
            await this.runCommand(`cd "${projDir}" && dotnet new console --force -o . 2>/dev/null`);
            fs.writeFileSync(path.join(projDir, 'Program.cs'), code);
            return await this.runCommand(`cd "${projDir}" && dotnet run`, 60000);
        } finally {
            try { fs.rmSync(projDir, { recursive: true, force: true }); } catch(e) {}
        }
    }

    async executeFSharp(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.fsx`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`dotnet fsi "${src}"`, 60000);
        } finally { this.cleanup(src); }
    }

    // ═══════════════════════════════════════
    //  Apple
    // ═══════════════════════════════════════

    async executeSwift(code) { return this.runScript(code, '.swift', 'swift'); }

    // ═══════════════════════════════════════
    //  Mobile
    // ═══════════════════════════════════════

    async executeDart(code) { return this.runScript(code, '.dart', 'dart run'); }

    // ═══════════════════════════════════════
    //  Functional Languages
    // ═══════════════════════════════════════

    async executeHaskell(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.hs`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`ghc -o "${out}" "${src}" -no-keep-hi-files -no-keep-o-files`, 60000);
            if (c.exitCode !== 0) {
                // Try runghc for scripts
                return await this.runCommand(`runghc "${src}"`);
            }
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    async executeElixir(code) { return this.runScript(code, '.exs', 'elixir'); }
    async executeErlang(code) { return this.runScript(code, '.erl', 'escript'); }

    async executeOCaml(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.ml`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`ocaml "${src}"`, 30000);
        } finally { this.cleanup(src); }
    }

    async executeLisp(code) {
        return this.runScript(code, '.lisp', 'sbcl --script 2>/dev/null || clisp');
    }

    async executeScheme(code) {
        return this.runScript(code, '.scm', 'guile 2>/dev/null || mit-scheme --quiet --load');
    }

    async executeRacket(code) { return this.runScript(code, '.rkt', 'racket'); }
    async executeProlog(code) { return this.runScript(code, '.pl', 'swipl -s'); }

    // ═══════════════════════════════════════
    //  Scientific Languages
    // ═══════════════════════════════════════

    async executeJulia(code) { return this.runScript(code, '.jl', 'julia'); }
    async executeOctave(code) { return this.runScript(code, '.m', 'octave --no-gui'); }

    async executeFortran(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.f90`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`gfortran "${src}" -o "${out}"`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); }
    }

    // ═══════════════════════════════════════
    //  Data & Config
    // ═══════════════════════════════════════

    async executeSQL(code) {
        const ts = Date.now();
        const dbPath = path.join(this.tempDir, `exec_${ts}.db`);
        const sqlPath = path.join(this.tempDir, `exec_${ts}.sql`);
        fs.writeFileSync(sqlPath, code);
        try {
            return await this.runCommand(`sqlite3 "${dbPath}" < "${sqlPath}"`);
        } finally { this.cleanup(sqlPath); this.cleanup(dbPath); }
    }

    async executeGraphQL(code) {
        return { stdout: code, stderr: '', exitCode: 0, note: 'GraphQL schema/query displayed. Use with an API endpoint to execute.' };
    }

    // ═══════════════════════════════════════
    //  Markup / Web
    // ═══════════════════════════════════════

    async executeHTML(code) {
        const filePath = path.join(this.tempDir, `exec_${Date.now()}.html`);
        fs.writeFileSync(filePath, code);
        exec(`open "${filePath}"`);
        return { stdout: `HTML opened in browser: ${filePath}`, stderr: '', exitCode: 0 };
    }

    async executeMarkdown(code) {
        return { stdout: code, stderr: '', exitCode: 0, note: 'Markdown rendered above.' };
    }

    async executeLaTeX(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.tex`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`cd "${this.tempDir}" && pdflatex -interaction=nonstopmode "${src}"`, 30000);
            if (c.exitCode === 0) {
                const pdfPath = src.replace('.tex', '.pdf');
                if (fs.existsSync(pdfPath)) exec(`open "${pdfPath}"`);
                return { stdout: 'PDF generated and opened.', stderr: '', exitCode: 0 };
            }
            return c;
        } finally {
            this.cleanup(src);
            this.cleanup(src.replace('.tex', '.pdf'));
            this.cleanup(src.replace('.tex', '.aux'));
            this.cleanup(src.replace('.tex', '.log'));
        }
    }

    // ═══════════════════════════════════════
    //  Blockchain
    // ═══════════════════════════════════════

    async executeSolidity(code) {
        const src = path.join(this.tempDir, `exec_${Date.now()}.sol`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`solc --combined-json abi,bin "${src}" 2>&1 || echo "Install solc: brew install solidity"`);
        } finally { this.cleanup(src); }
    }

    // ═══════════════════════════════════════
    //  DevOps
    // ═══════════════════════════════════════

    async executeDockerfile(code) {
        const src = path.join(this.tempDir, `Dockerfile_${Date.now()}`);
        fs.writeFileSync(src, code);
        return { stdout: `Dockerfile saved at ${src}\nTo build: docker build -f "${src}" .`, stderr: '', exitCode: 0 };
    }

    async executeTerraform(code) {
        const dir = path.join(this.tempDir, `tf_${Date.now()}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'main.tf'), code);
        try {
            return await this.runCommand(`cd "${dir}" && terraform validate 2>&1 || echo "Install terraform: brew install terraform"`);
        } finally {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch(e) {}
        }
    }

    async executeYAML(code) {
        // Validate YAML using python
        const src = path.join(this.tempDir, `exec_${Date.now()}.yml`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`python3 -c "import yaml; yaml.safe_load(open('${src}')); print('Valid YAML')" 2>&1`);
        } finally { this.cleanup(src); }
    }

    // ═══════════════════════════════════════
    //  Other Languages
    // ═══════════════════════════════════════

    async executePascal(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.pas`);
        const out = path.join(this.tempDir, `exec_${ts}`);
        fs.writeFileSync(src, code);
        try {
            const c = await this.runCommand(`fpc "${src}" -o"${out}" 2>&1`, 60000);
            if (c.exitCode !== 0) return c;
            return await this.runCommand(`"${out}"`);
        } finally { this.cleanup(src); this.cleanup(out); this.cleanup(src.replace('.pas', '.o')); }
    }

    async executeD(code) {
        const ts = Date.now();
        const src = path.join(this.tempDir, `exec_${ts}.d`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`dmd -run "${src}" 2>/dev/null || ldc2 --run "${src}"`, 60000);
        } finally { this.cleanup(src); }
    }

    async executeCrystal(code) { return this.runScript(code, '.cr', 'crystal run'); }
    async executeV(code) { return this.runScript(code, '.v', 'v run'); }

    async executeCoffeeScript(code) {
        return this.runScript(code, '.coffee', 'npx coffee');
    }

    async executeAwk(code) {
        const src = path.join(this.tempDir, `exec_${Date.now()}.awk`);
        fs.writeFileSync(src, code);
        try {
            return await this.runCommand(`awk -f "${src}" /dev/null`);
        } finally { this.cleanup(src); }
    }

    async executeSed(code) {
        return await this.runCommand(`echo "" | sed '${code.replace(/'/g, "'\\''")}'`);
    }

    async executeTcl(code) { return this.runScript(code, '.tcl', 'tclsh'); }

    async executeWasm(code) {
        return { stdout: 'WebAssembly requires compilation from C/Rust first.\nUse C or Rust with wasm target to compile.', stderr: '', exitCode: 0 };
    }

    // ═══════════════════════════════════════
    //  File Operations
    // ═══════════════════════════════════════

    async createFile(filePath, content) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true, path: filePath };
    }

    async readFile(filePath) {
        return fs.readFileSync(filePath, 'utf-8');
    }

    async createFolder(folderPath) {
        fs.mkdirSync(folderPath, { recursive: true });
        return { success: true, path: folderPath };
    }

    async deleteFile(filePath) {
        if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(filePath);
            }
        }
        return { success: true };
    }

    async moveFile(src, dest) {
        fs.renameSync(src, dest);
        return { success: true, from: src, to: dest };
    }

    async listFolder(folderPath) {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'folder' : 'file',
            path: path.join(folderPath, e.name),
            size: e.isFile() ? fs.statSync(path.join(folderPath, e.name)).size : 0
        }));
    }

    async openApp(appName) {
        return this.runCommand(`open -a "${appName}"`);
    }

    // ═══════════════════════════════════════
    //  Utility
    // ═══════════════════════════════════════

    cleanup(filePath) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    }

    getSupportedLanguages() {
        return [
            'JavaScript', 'TypeScript', 'Python', 'Ruby', 'PHP', 'Perl', 'Lua', 'R',
            'Bash', 'Zsh', 'Fish', 'PowerShell', 'AppleScript',
            'C', 'C++', 'Objective-C', 'Rust', 'Go', 'Zig', 'Nim', 'Assembly',
            'Java', 'Kotlin', 'Scala', 'Groovy', 'Clojure',
            'C#', 'F#',
            'Swift', 'Dart',
            'Haskell', 'Elixir', 'Erlang', 'OCaml', 'Lisp', 'Scheme', 'Racket', 'Prolog',
            'Julia', 'MATLAB/Octave', 'Fortran',
            'SQL/SQLite', 'GraphQL',
            'HTML/CSS', 'Markdown', 'LaTeX',
            'Solidity',
            'Dockerfile', 'Terraform', 'YAML',
            'Pascal', 'D', 'Crystal', 'V', 'CoffeeScript', 'AWK', 'Sed', 'Tcl', 'WebAssembly'
        ];
    }
}

module.exports = Executor;
