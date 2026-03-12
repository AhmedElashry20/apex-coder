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
}

module.exports = SearchEngine;
