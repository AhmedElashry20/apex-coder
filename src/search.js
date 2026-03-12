const http = require('http');
const https = require('https');
const cheerio = require('cheerio');
const zlib = require('zlib');

class SearchEngine {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    }

    // ─── Helper: HTTP GET with redirect + gzip ───
    _get(url, headers = {}, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, {
                headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': 'gzip, deflate, identity', ...headers },
                timeout
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    let loc = res.headers.location;
                    if (loc.startsWith('/')) { const u = new URL(url); loc = u.origin + loc; }
                    return this._get(loc, headers, timeout).then(resolve).catch(reject);
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    let text;
                    try { text = zlib.gunzipSync(buf).toString('utf-8'); } catch {
                        try { text = zlib.inflateSync(buf).toString('utf-8'); } catch {
                            text = buf.toString('utf-8');
                        }
                    }
                    resolve(text);
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        });
    }

    _jsonGet(url, headers = {}) {
        return this._get(url, { 'Accept': 'application/json', ...headers }).then(t => JSON.parse(t));
    }

    // ─── General Web Search (DuckDuckGo) ───
    async search(query, maxResults = 8) {
        try {
            return await this.duckDuckGoSearch(query, maxResults);
        } catch { return []; }
    }

    async duckDuckGoSearch(query, maxResults) {
        const html = await this._get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
        });
        return this.parseDuckDuckGoResults(html, maxResults);
    }

    parseDuckDuckGoResults(html, maxResults) {
        const $ = cheerio.load(html);
        const results = [];
        $('.result').each((i, el) => {
            if (i >= maxResults) return false;
            const titleEl = $(el).find('.result__title a, .result__a');
            const snippetEl = $(el).find('.result__snippet');
            const urlEl = $(el).find('.result__url');
            const title = titleEl.text().trim();
            let href = titleEl.attr('href') || '';
            const snippet = snippetEl.text().trim();
            const displayUrl = urlEl.text().trim();
            if (href.includes('uddg=')) {
                const m = href.match(/uddg=([^&]+)/);
                if (m) href = decodeURIComponent(m[1]);
            }
            if (title && (href || displayUrl)) {
                results.push({ title, url: href || `https://${displayUrl}`, snippet });
            }
        });
        return results;
    }

    // ─── Fetch & Extract Page Content ───
    async fetchPage(url) {
        const html = await this._get(url);
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, iframe, noscript, svg, .ad, .ads, .sidebar').remove();
        let content = '';
        for (const sel of ['main', 'article', '[role="main"]', '.content', '#content', '.post-content', '.entry-content', '.markdown-body']) {
            if ($(sel).length) { content = $(sel).text(); break; }
        }
        if (!content) content = $('body').text();
        content = content.replace(/\s+/g, ' ').trim().substring(0, 10000);
        return { title: $('title').text().trim(), content, url };
    }

    async readURL(url) {
        return this.fetchPage(url);
    }

    async searchAndSummarize(query, maxResults = 5) {
        const results = await this.search(query, maxResults);
        const detailed = [];
        for (const r of results.slice(0, 3)) {
            try {
                const page = await this.fetchPage(r.url);
                detailed.push({ ...r, fullContent: page.content });
            } catch { detailed.push(r); }
        }
        return detailed;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  GitHub
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchGitHub(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            return (data.items || []).map(r => ({
                name: r.full_name, description: r.description || '', url: r.html_url,
                stars: r.stargazers_count, language: r.language, updated: r.updated_at, forks: r.forks_count
            }));
        } catch { return []; }
    }

    async searchGitHubCode(query, language = '', maxResults = 10) {
        try {
            let q = encodeURIComponent(query);
            if (language) q += `+language:${encodeURIComponent(language)}`;
            const data = await this._jsonGet(
                `https://api.github.com/search/code?q=${q}&per_page=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            return (data.items || []).map(item => ({
                name: item.name, path: item.path, repo: item.repository?.full_name || '', url: item.html_url
            }));
        } catch { return []; }
    }

    async searchGitHubGists(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://api.github.com/gists/public?per_page=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            return (data || []).filter(g => {
                const desc = (g.description || '').toLowerCase();
                return desc.includes(query.toLowerCase());
            }).map(g => ({
                id: g.id, description: g.description, url: g.html_url,
                files: Object.keys(g.files), created: g.created_at
            }));
        } catch { return []; }
    }

    async getGitHubFileContent(owner, repo, filePath) {
        try {
            const data = await this._jsonGet(
                `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            if (data.content) {
                return { name: data.name, path: data.path, content: Buffer.from(data.content, 'base64').toString('utf-8'), size: data.size, url: data.html_url };
            }
            return null;
        } catch { return null; }
    }

    async getGitHubReadme(owner, repo) {
        try {
            const data = await this._jsonGet(
                `https://api.github.com/repos/${owner}/${repo}/readme`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            return data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : null;
        } catch { return null; }
    }

    async getGitHubTopics(topic, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://api.github.com/search/repositories?q=topic:${encodeURIComponent(topic)}&sort=stars&per_page=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent', 'Accept': 'application/vnd.github.v3+json' }
            );
            return (data.items || []).map(r => ({
                name: r.full_name, description: r.description || '', url: r.html_url,
                stars: r.stargazers_count, language: r.language, topics: r.topics || []
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  StackOverflow / StackExchange
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchStackOverflow(query, maxResults = 5) {
        try {
            const data = await this._jsonGet(
                `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${maxResults}&filter=withbody`
            );
            return (data.items || []).map(q => ({
                title: q.title, url: q.link, score: q.score,
                answered: q.is_answered, answers: q.answer_count, tags: q.tags || [], views: q.view_count
            }));
        } catch { return []; }
    }

    async getStackOverflowAnswers(questionId) {
        try {
            const data = await this._jsonGet(
                `https://api.stackexchange.com/2.3/questions/${questionId}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody`
            );
            return (data.items || []).map(a => ({
                id: a.answer_id, score: a.score, accepted: a.is_accepted,
                body: a.body?.replace(/<[^>]+>/g, '').substring(0, 3000) || ''
            }));
        } catch { return []; }
    }

    async searchStackOverflowByTag(tag, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://api.stackexchange.com/2.3/search?order=desc&sort=votes&tagged=${encodeURIComponent(tag)}&site=stackoverflow&pagesize=${maxResults}&filter=withbody`
            );
            return (data.items || []).map(q => ({
                title: q.title, url: q.link, score: q.score, answered: q.is_answered, tags: q.tags || []
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  npm Registry
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchNpm(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${maxResults}`
            );
            return (data.objects || []).map(o => ({
                name: o.package.name, version: o.package.version,
                description: o.package.description || '',
                url: o.package.links?.npm || `https://www.npmjs.com/package/${o.package.name}`,
                keywords: o.package.keywords || [], score: o.score?.final || 0
            }));
        } catch { return []; }
    }

    async getNpmPackageInfo(packageName) {
        try {
            const data = await this._jsonGet(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
            const latest = data['dist-tags']?.latest;
            const ver = latest ? data.versions?.[latest] : null;
            return {
                name: data.name, version: latest, description: data.description || '',
                homepage: data.homepage || '', repository: data.repository?.url || '',
                license: data.license || '', dependencies: ver?.dependencies || {},
                devDependencies: ver?.devDependencies || {}
            };
        } catch { return null; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  PyPI (Python Package Index)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchPyPI(query, maxResults = 10) {
        try {
            const html = await this._get(`https://pypi.org/search/?q=${encodeURIComponent(query)}`);
            const $ = cheerio.load(html);
            const results = [];
            $('a.package-snippet').each((i, el) => {
                if (i >= maxResults) return false;
                results.push({
                    name: $(el).find('.package-snippet__name').text().trim(),
                    version: $(el).find('.package-snippet__version').text().trim(),
                    description: $(el).find('.package-snippet__description').text().trim(),
                    url: 'https://pypi.org' + $(el).attr('href')
                });
            });
            return results;
        } catch { return []; }
    }

    async getPyPIPackageInfo(packageName) {
        try {
            const data = await this._jsonGet(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
            return {
                name: data.info.name, version: data.info.version,
                summary: data.info.summary || '', description: data.info.description?.substring(0, 2000) || '',
                homepage: data.info.home_page || data.info.project_url || '',
                license: data.info.license || '', requires_python: data.info.requires_python || '',
                dependencies: data.info.requires_dist || []
            };
        } catch { return null; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  crates.io (Rust)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchCrates(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent' }
            );
            return (data.crates || []).map(c => ({
                name: c.name, version: c.max_version, description: c.description || '',
                downloads: c.downloads, url: `https://crates.io/crates/${c.name}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  pkg.go.dev (Go)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchGoPackages(query, maxResults = 10) {
        try {
            const html = await this._get(`https://pkg.go.dev/search?q=${encodeURIComponent(query)}&m=package`);
            const $ = cheerio.load(html);
            const results = [];
            $('.SearchSnippet').each((i, el) => {
                if (i >= maxResults) return false;
                const name = $(el).find('.SearchSnippet-headerContainer a').first().text().trim();
                const synopsis = $(el).find('.SearchSnippet-synopsis').text().trim();
                results.push({
                    name, description: synopsis,
                    url: 'https://pkg.go.dev/' + name
                });
            });
            return results;
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  RubyGems
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchRubyGems(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://rubygems.org/api/v1/search.json?query=${encodeURIComponent(query)}&page=1`
            );
            return data.slice(0, maxResults).map(g => ({
                name: g.name, version: g.version, description: g.info || '',
                downloads: g.downloads, url: g.project_uri || `https://rubygems.org/gems/${g.name}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Maven Central (Java/Kotlin/Scala)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchMaven(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=${maxResults}&wt=json`
            );
            return (data.response?.docs || []).map(d => ({
                groupId: d.g, artifactId: d.a, version: d.latestVersion,
                url: `https://search.maven.org/artifact/${d.g}/${d.a}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  NuGet (.NET / C# / F#)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchNuGet(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(query)}&take=${maxResults}`
            );
            return (data.data || []).map(p => ({
                id: p.id, version: p.version, description: p.description || '',
                downloads: p.totalDownloads, url: `https://www.nuget.org/packages/${p.id}`,
                tags: p.tags || []
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Packagist (PHP / Composer)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchPackagist(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://packagist.org/search.json?q=${encodeURIComponent(query)}&per_page=${maxResults}`
            );
            return (data.results || []).map(p => ({
                name: p.name, description: p.description || '',
                url: p.url, downloads: p.downloads, favers: p.favers
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Hex.pm (Elixir / Erlang)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchHex(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://hex.pm/api/packages?search=${encodeURIComponent(query)}&sort=downloads&per_page=${maxResults}`
            );
            return data.map(p => ({
                name: p.name, url: p.html_url || `https://hex.pm/packages/${p.name}`,
                downloads: p.downloads?.all || 0,
                description: p.meta?.description || ''
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  CocoaPods (Swift / Objective-C)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchCocoaPods(query, maxResults = 10) {
        try {
            const html = await this._get(`https://cocoapods.org/search?q=${encodeURIComponent(query)}`);
            const $ = cheerio.load(html);
            const results = [];
            $('.pod-list__item').each((i, el) => {
                if (i >= maxResults) return false;
                results.push({
                    name: $(el).find('.pod-list__item__content__header a').first().text().trim(),
                    description: $(el).find('.pod-list__item__content__description').text().trim(),
                    url: 'https://cocoapods.org' + ($(el).find('.pod-list__item__content__header a').attr('href') || '')
                });
            });
            return results;
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  pub.dev (Dart / Flutter)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchPubDev(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://pub.dev/api/search?q=${encodeURIComponent(query)}`
            );
            const packages = (data.packages || []).slice(0, maxResults);
            return packages.map(p => ({
                name: p.package, url: `https://pub.dev/packages/${p.package}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Homebrew (macOS packages)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchHomebrew(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(`https://formulae.brew.sh/api/formula.json`);
            const q = query.toLowerCase();
            const matches = data.filter(f => f.name.includes(q) || (f.desc || '').toLowerCase().includes(q)).slice(0, maxResults);
            return matches.map(f => ({
                name: f.name, version: f.versions?.stable || '',
                description: f.desc || '', homepage: f.homepage || '',
                url: `https://formulae.brew.sh/formula/${f.name}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Docker Hub
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchDockerHub(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=${maxResults}`
            );
            return (data.results || []).map(r => ({
                name: r.repo_name, description: r.short_description || '',
                stars: r.star_count, pulls: r.pull_count, official: r.is_official,
                url: `https://hub.docker.com/r/${r.repo_name}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  MDN Web Docs (HTML/CSS/JS reference)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchMDN(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&size=${maxResults}`
            );
            return (data.documents || []).map(d => ({
                title: d.title, url: `https://developer.mozilla.org${d.mdn_url}`,
                summary: d.summary || '', locale: d.locale
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  DevDocs.io (multiple language docs)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchDevDocs(query, scope = '') {
        try {
            const url = scope
                ? `https://devdocs.io/search?q=${encodeURIComponent(scope + ' ' + query)}`
                : `https://devdocs.io/search?q=${encodeURIComponent(query)}`;
            const html = await this._get(url);
            const $ = cheerio.load(html);
            const results = [];
            $('a._list-item').each((i, el) => {
                if (i >= 10) return false;
                results.push({
                    title: $(el).text().trim(),
                    url: 'https://devdocs.io' + ($(el).attr('href') || '')
                });
            });
            return results;
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Can I Use (CSS/HTML/JS browser support)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchCanIUse(feature) {
        try {
            const data = await this._jsonGet('https://raw.githubusercontent.com/nicedoc/caniuse-api/gh-pages/features.json');
            const q = feature.toLowerCase();
            const matches = Object.entries(data).filter(([k]) => k.includes(q)).slice(0, 5);
            return matches.map(([name, info]) => ({
                feature: name, support: info, url: `https://caniuse.com/${name}`
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Hacker News (tech news & discussions)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchHackerNews(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${maxResults}`
            );
            return (data.hits || []).map(h => ({
                title: h.title || h.story_title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
                points: h.points, comments: h.num_comments, author: h.author,
                created: h.created_at
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Dev.to (developer community articles)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchDevTo(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://dev.to/api/articles?tag=${encodeURIComponent(query)}&per_page=${maxResults}&top=365`
            );
            return data.map(a => ({
                title: a.title, url: a.url, tags: a.tag_list,
                reactions: a.positive_reactions_count, comments: a.comments_count,
                author: a.user?.name || '', published: a.published_at
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Reddit (programming subreddits)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchRedditProgramming(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://www.reddit.com/r/programming/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=relevance&limit=${maxResults}`,
                { 'User-Agent': 'APEX-AI-Agent/1.0' }
            );
            return (data.data?.children || []).map(c => ({
                title: c.data.title, url: `https://reddit.com${c.data.permalink}`,
                score: c.data.score, comments: c.data.num_comments,
                subreddit: c.data.subreddit
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  ExploitDB / CVE (Security)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchCVE(query, maxResults = 10) {
        try {
            const data = await this._jsonGet(
                `https://cveawg.mitre.org/api/cve?cveId=${encodeURIComponent(query)}`
            );
            if (data.cveMetadata) {
                return [{ id: data.cveMetadata.cveId, state: data.cveMetadata.state, description: data.containers?.cna?.descriptions?.[0]?.value || '' }];
            }
            // Fallback: search via NVD
            const nvd = await this._jsonGet(
                `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=${maxResults}`
            );
            return (nvd.vulnerabilities || []).map(v => ({
                id: v.cve.id, description: v.cve.descriptions?.[0]?.value || '',
                published: v.cve.published, severity: v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity || 'N/A'
            }));
        } catch { return []; }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Unified Code Search — searches the right registry by language
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async searchPackage(query, language = '') {
        const lang = language.toLowerCase();
        const searchMap = {
            'javascript': () => this.searchNpm(query),
            'js': () => this.searchNpm(query),
            'typescript': () => this.searchNpm(query),
            'ts': () => this.searchNpm(query),
            'node': () => this.searchNpm(query),
            'python': () => this.searchPyPI(query),
            'py': () => this.searchPyPI(query),
            'rust': () => this.searchCrates(query),
            'go': () => this.searchGoPackages(query),
            'golang': () => this.searchGoPackages(query),
            'ruby': () => this.searchRubyGems(query),
            'rb': () => this.searchRubyGems(query),
            'java': () => this.searchMaven(query),
            'kotlin': () => this.searchMaven(query),
            'scala': () => this.searchMaven(query),
            'csharp': () => this.searchNuGet(query),
            'c#': () => this.searchNuGet(query),
            'fsharp': () => this.searchNuGet(query),
            'f#': () => this.searchNuGet(query),
            'dotnet': () => this.searchNuGet(query),
            '.net': () => this.searchNuGet(query),
            'php': () => this.searchPackagist(query),
            'elixir': () => this.searchHex(query),
            'erlang': () => this.searchHex(query),
            'swift': () => this.searchCocoaPods(query),
            'objc': () => this.searchCocoaPods(query),
            'objective-c': () => this.searchCocoaPods(query),
            'dart': () => this.searchPubDev(query),
            'flutter': () => this.searchPubDev(query),
            'docker': () => this.searchDockerHub(query),
            'brew': () => this.searchHomebrew(query),
            'homebrew': () => this.searchHomebrew(query),
        };

        const fn = searchMap[lang];
        if (fn) return fn();

        // No language specified: search npm + PyPI + GitHub in parallel
        const [npm, pypi, github] = await Promise.all([
            this.searchNpm(query, 5),
            this.searchPyPI(query, 5),
            this.searchGitHub(query, 5)
        ]);
        return { npm, pypi, github };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Comprehensive Code Search — searches multiple sources at once
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async deepCodeSearch(query, language = '') {
        const [web, github, stackoverflow, hackerNews] = await Promise.all([
            this.search(query + ' programming', 5),
            this.searchGitHub(query, 5),
            this.searchStackOverflow(query, 5),
            this.searchHackerNews(query, 5)
        ]);

        const packages = language ? await this.searchPackage(query, language) : null;

        return {
            web,
            github,
            stackoverflow,
            hackerNews,
            packages,
            query,
            timestamp: new Date().toISOString()
        };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  Documentation Lookup
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async getLatestDocs(technology) {
        const docsSites = {
            // JavaScript / Frontend
            'react': 'https://react.dev',
            'next.js': 'https://nextjs.org/docs',
            'nextjs': 'https://nextjs.org/docs',
            'vue': 'https://vuejs.org/guide',
            'nuxt': 'https://nuxt.com/docs',
            'angular': 'https://angular.dev',
            'svelte': 'https://svelte.dev/docs',
            'sveltekit': 'https://kit.svelte.dev/docs',
            'solid': 'https://www.solidjs.com/docs',
            'astro': 'https://docs.astro.build',
            'remix': 'https://remix.run/docs',
            'gatsby': 'https://www.gatsbyjs.com/docs/',
            'jquery': 'https://api.jquery.com/',
            'htmx': 'https://htmx.org/docs/',

            // CSS
            'tailwind': 'https://tailwindcss.com/docs/',
            'tailwindcss': 'https://tailwindcss.com/docs/',
            'bootstrap': 'https://getbootstrap.com/docs/',
            'sass': 'https://sass-lang.com/documentation/',
            'css': 'https://developer.mozilla.org/en-US/docs/Web/CSS',

            // JavaScript / Backend
            'node': 'https://nodejs.org/docs/latest/api/',
            'nodejs': 'https://nodejs.org/docs/latest/api/',
            'express': 'https://expressjs.com/en/api.html',
            'nestjs': 'https://docs.nestjs.com/',
            'fastify': 'https://fastify.dev/docs/latest/',
            'deno': 'https://deno.land/manual',
            'bun': 'https://bun.sh/docs',

            // TypeScript
            'typescript': 'https://www.typescriptlang.org/docs/',
            'ts': 'https://www.typescriptlang.org/docs/',

            // Python
            'python': 'https://docs.python.org/3/',
            'django': 'https://docs.djangoproject.com/',
            'flask': 'https://flask.palletsprojects.com/',
            'fastapi': 'https://fastapi.tiangolo.com/',
            'sqlalchemy': 'https://docs.sqlalchemy.org/',
            'pandas': 'https://pandas.pydata.org/docs/',
            'numpy': 'https://numpy.org/doc/',
            'scipy': 'https://docs.scipy.org/doc/scipy/',
            'matplotlib': 'https://matplotlib.org/stable/contents.html',
            'scrapy': 'https://docs.scrapy.org/',
            'celery': 'https://docs.celeryq.dev/',
            'pydantic': 'https://docs.pydantic.dev/',

            // AI / ML
            'pytorch': 'https://pytorch.org/docs/stable/',
            'tensorflow': 'https://www.tensorflow.org/api_docs',
            'langchain': 'https://python.langchain.com/docs/',
            'transformers': 'https://huggingface.co/docs/transformers/',
            'scikit-learn': 'https://scikit-learn.org/stable/documentation.html',
            'keras': 'https://keras.io/api/',
            'ollama': 'https://github.com/ollama/ollama/blob/main/docs/api.md',

            // Rust
            'rust': 'https://doc.rust-lang.org/book/',
            'cargo': 'https://doc.rust-lang.org/cargo/',
            'tokio': 'https://tokio.rs/tokio/tutorial',
            'actix': 'https://actix.rs/docs/',

            // Go
            'go': 'https://go.dev/doc/',
            'golang': 'https://go.dev/doc/',
            'gin': 'https://gin-gonic.com/docs/',
            'fiber': 'https://docs.gofiber.io/',

            // Java / JVM
            'java': 'https://docs.oracle.com/en/java/javase/21/docs/api/',
            'spring': 'https://docs.spring.io/spring-framework/reference/',
            'springboot': 'https://docs.spring.io/spring-boot/docs/current/reference/',
            'kotlin': 'https://kotlinlang.org/docs/',
            'scala': 'https://docs.scala-lang.org/',
            'gradle': 'https://docs.gradle.org/current/userguide/userguide.html',

            // .NET
            'csharp': 'https://learn.microsoft.com/en-us/dotnet/csharp/',
            'c#': 'https://learn.microsoft.com/en-us/dotnet/csharp/',
            'dotnet': 'https://learn.microsoft.com/en-us/dotnet/',
            'fsharp': 'https://learn.microsoft.com/en-us/dotnet/fsharp/',
            'blazor': 'https://learn.microsoft.com/en-us/aspnet/core/blazor/',

            // Swift / Apple
            'swift': 'https://docs.swift.org/swift-book/',
            'swiftui': 'https://developer.apple.com/documentation/swiftui/',

            // PHP
            'php': 'https://www.php.net/manual/en/',
            'laravel': 'https://laravel.com/docs/',
            'symfony': 'https://symfony.com/doc/current/',
            'wordpress': 'https://developer.wordpress.org/',

            // Ruby
            'ruby': 'https://ruby-doc.org/',
            'rails': 'https://guides.rubyonrails.org/',

            // Elixir / Erlang
            'elixir': 'https://hexdocs.pm/elixir/',
            'phoenix': 'https://hexdocs.pm/phoenix/',
            'erlang': 'https://www.erlang.org/docs',

            // Dart / Flutter
            'dart': 'https://dart.dev/guides',
            'flutter': 'https://docs.flutter.dev/',

            // Databases
            'postgresql': 'https://www.postgresql.org/docs/current/',
            'postgres': 'https://www.postgresql.org/docs/current/',
            'mysql': 'https://dev.mysql.com/doc/',
            'mongodb': 'https://www.mongodb.com/docs/',
            'redis': 'https://redis.io/docs/',
            'sqlite': 'https://www.sqlite.org/docs.html',
            'prisma': 'https://www.prisma.io/docs/',
            'supabase': 'https://supabase.com/docs',
            'firebase': 'https://firebase.google.com/docs',

            // DevOps / Infrastructure
            'docker': 'https://docs.docker.com/',
            'kubernetes': 'https://kubernetes.io/docs/',
            'k8s': 'https://kubernetes.io/docs/',
            'terraform': 'https://developer.hashicorp.com/terraform/docs',
            'ansible': 'https://docs.ansible.com/',
            'nginx': 'https://nginx.org/en/docs/',
            'aws': 'https://docs.aws.amazon.com/',
            'gcp': 'https://cloud.google.com/docs',
            'azure': 'https://learn.microsoft.com/en-us/azure/',
            'vercel': 'https://vercel.com/docs',
            'netlify': 'https://docs.netlify.com/',
            'cloudflare': 'https://developers.cloudflare.com/',

            // Desktop
            'electron': 'https://www.electronjs.org/docs/latest/',
            'tauri': 'https://tauri.app/v1/guides/',
            'qt': 'https://doc.qt.io/',

            // Mobile
            'react-native': 'https://reactnative.dev/docs/',
            'expo': 'https://docs.expo.dev/',

            // Other
            'graphql': 'https://graphql.org/learn/',
            'grpc': 'https://grpc.io/docs/',
            'git': 'https://git-scm.com/doc',
            'linux': 'https://www.kernel.org/doc/',
            'bash': 'https://www.gnu.org/software/bash/manual/',
            'vim': 'https://vimdoc.sourceforge.net/',
            'regex': 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions',
            'webassembly': 'https://webassembly.org/specs/',
            'wasm': 'https://webassembly.org/specs/',
            'solidity': 'https://docs.soliditylang.org/',
            'haskell': 'https://www.haskell.org/documentation/',
            'julia': 'https://docs.julialang.org/',
            'r': 'https://cran.r-project.org/manuals.html',
            'lua': 'https://www.lua.org/manual/',
            'zig': 'https://ziglang.org/documentation/',
            'nim': 'https://nim-lang.org/documentation.html',
            'clojure': 'https://clojure.org/reference/',
            'ocaml': 'https://ocaml.org/docs',
        };

        const tech = technology.toLowerCase();
        const docsUrl = docsSites[tech];

        if (docsUrl) {
            try {
                return await this.fetchPage(docsUrl);
            } catch {
                return await this.searchAndSummarize(`${technology} documentation latest`);
            }
        }

        return await this.searchAndSummarize(`${technology} official documentation`);
    }
}

module.exports = SearchEngine;
