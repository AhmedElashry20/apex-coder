const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

class SearchEngine {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    }

    async search(query, maxResults = 8) {
        try {
            const results = await this.duckDuckGoSearch(query, maxResults);
            return results;
        } catch (error) {
            console.error('Search failed:', error.message);
            return [];
        }
    }

    async duckDuckGoSearch(query, maxResults) {
        return new Promise((resolve, reject) => {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

            const req = https.get(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'text/html',
                    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const results = this.parseDuckDuckGoResults(data, maxResults);
                        resolve(results);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });

            req.on('error', (e) => resolve([]));
            req.on('timeout', () => {
                req.destroy();
                resolve([]);
            });
        });
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

            // DuckDuckGo wraps URLs in redirect
            if (href.includes('uddg=')) {
                const match = href.match(/uddg=([^&]+)/);
                if (match) {
                    href = decodeURIComponent(match[1]);
                }
            }

            if (title && (href || displayUrl)) {
                results.push({
                    title,
                    url: href || `https://${displayUrl}`,
                    snippet
                });
            }
        });

        return results;
    }

    async fetchPage(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            const req = protocol.get(url, {
                headers: { 'User-Agent': this.userAgent },
                timeout: 15000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    this.fetchPage(res.headers.location).then(resolve).catch(reject);
                    return;
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    const $ = cheerio.load(data);
                    $('script, style, nav, footer, header, iframe').remove();

                    let content = '';
                    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content'];
                    for (const sel of mainSelectors) {
                        if ($(sel).length) {
                            content = $(sel).text();
                            break;
                        }
                    }
                    if (!content) content = $('body').text();

                    content = content.replace(/\s+/g, ' ').trim().substring(0, 8000);

                    resolve({
                        title: $('title').text().trim(),
                        content,
                        url
                    });
                });
            });

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    }

    async searchAndSummarize(query, maxResults = 5) {
        const results = await this.search(query, maxResults);

        const detailed = [];
        for (const result of results.slice(0, 3)) {
            try {
                const page = await this.fetchPage(result.url);
                detailed.push({
                    ...result,
                    fullContent: page.content
                });
            } catch (e) {
                detailed.push(result);
            }
        }

        return detailed;
    }

    async searchGitHub(query, maxResults = 10) {
        return new Promise((resolve) => {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://api.github.com/search/repositories?q=${encodedQuery}&sort=stars&per_page=${maxResults}`;

            const req = https.get(url, {
                headers: {
                    'User-Agent': 'APEX-AI-Agent',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const repos = (parsed.items || []).map(r => ({
                            name: r.full_name,
                            description: r.description || '',
                            url: r.html_url,
                            stars: r.stargazers_count,
                            language: r.language,
                            updated: r.updated_at
                        }));
                        resolve(repos);
                    } catch (e) { resolve([]); }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
    }

    async searchGitHubCode(query, language = '', maxResults = 10) {
        return new Promise((resolve) => {
            let q = encodeURIComponent(query);
            if (language) q += `+language:${encodeURIComponent(language)}`;
            const url = `https://api.github.com/search/code?q=${q}&per_page=${maxResults}`;

            const req = https.get(url, {
                headers: {
                    'User-Agent': 'APEX-AI-Agent',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const results = (parsed.items || []).map(item => ({
                            name: item.name,
                            path: item.path,
                            repo: item.repository ? item.repository.full_name : '',
                            url: item.html_url
                        }));
                        resolve(results);
                    } catch (e) { resolve([]); }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
    }

    async searchStackOverflow(query, maxResults = 5) {
        return new Promise((resolve) => {
            const encodedQuery = encodeURIComponent(query);
            const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodedQuery}&site=stackoverflow&pagesize=${maxResults}&filter=withbody`;

            const req = https.get(url, {
                headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'APEX-AI-Agent' },
                timeout: 15000
            }, (res) => {
                let chunks = [];
                res.on('data', (chunk) => { chunks.push(chunk); });
                res.on('end', () => {
                    try {
                        const buffer = Buffer.concat(chunks);
                        // StackExchange API returns gzipped by default
                        let text;
                        try {
                            const zlib = require('zlib');
                            text = zlib.gunzipSync(buffer).toString('utf-8');
                        } catch (e) {
                            text = buffer.toString('utf-8');
                        }
                        const parsed = JSON.parse(text);
                        const questions = (parsed.items || []).map(q => ({
                            title: q.title,
                            url: q.link,
                            score: q.score,
                            answered: q.is_answered,
                            answers: q.answer_count,
                            tags: q.tags || []
                        }));
                        resolve(questions);
                    } catch (e) { resolve([]); }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
    }

    async readURL(url) {
        return this.fetchPage(url);
    }

    async getLatestDocs(technology) {
        const docsSites = {
            'react': 'https://react.dev',
            'next.js': 'https://nextjs.org/docs',
            'nextjs': 'https://nextjs.org/docs',
            'vue': 'https://vuejs.org/guide',
            'angular': 'https://angular.dev',
            'svelte': 'https://svelte.dev/docs',
            'node': 'https://nodejs.org/docs/latest/api/',
            'python': 'https://docs.python.org/3/',
            'django': 'https://docs.djangoproject.com/',
            'fastapi': 'https://fastapi.tiangolo.com/',
            'flask': 'https://flask.palletsprojects.com/',
            'rust': 'https://doc.rust-lang.org/book/',
            'go': 'https://go.dev/doc/',
            'swift': 'https://docs.swift.org/swift-book/',
            'kotlin': 'https://kotlinlang.org/docs/',
            'typescript': 'https://www.typescriptlang.org/docs/',
            'electron': 'https://www.electronjs.org/docs/latest/',
            'tailwind': 'https://tailwindcss.com/docs/',
            'pytorch': 'https://pytorch.org/docs/stable/',
            'tensorflow': 'https://www.tensorflow.org/api_docs',
            'docker': 'https://docs.docker.com/',
            'kubernetes': 'https://kubernetes.io/docs/',
        };

        const tech = technology.toLowerCase();
        const docsUrl = docsSites[tech];

        if (docsUrl) {
            try {
                return await this.fetchPage(docsUrl);
            } catch (e) {
                return await this.searchAndSummarize(`${technology} documentation latest`);
            }
        }

        return await this.searchAndSummarize(`${technology} official documentation`);
    }
}

module.exports = SearchEngine;
