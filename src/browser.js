const { chromium } = require('playwright');
const cheerio = require('cheerio');

class BrowserEngine {
    constructor() {
        this.browser = null;
    }

    async ensureBrowser() {
        if (!this.browser || !this.browser.isConnected()) {
            try {
                this.browser = await chromium.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
            } catch (e) {
                throw new Error(`Failed to launch browser: ${e.message}`);
            }
        }
        return this.browser;
    }

    async getPageContent(url) {
        const browser = await this.ensureBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);

            const html = await page.content();
            const $ = cheerio.load(html);

            // Remove scripts, styles, navs, footers
            $('script, style, nav, footer, header, iframe, noscript, svg').remove();
            $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

            // Extract main content
            let mainContent = '';

            const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post-content', '.article-body'];
            for (const selector of mainSelectors) {
                const el = $(selector);
                if (el.length > 0) {
                    mainContent = el.text();
                    break;
                }
            }

            if (!mainContent) {
                mainContent = $('body').text();
            }

            // Clean up whitespace
            mainContent = mainContent
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n')
                .trim()
                .substring(0, 10000);

            const title = $('title').text().trim();
            const description = $('meta[name="description"]').attr('content') || '';
            const links = [];
            $('a[href]').each((i, el) => {
                if (i >= 20) return false;
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    links.push({ text: text.substring(0, 100), href });
                }
            });

            return {
                title,
                description,
                content: mainContent,
                links,
                url
            };
        } catch (error) {
            throw new Error(`Failed to load page: ${error.message}`);
        } finally {
            await context.close();
        }
    }

    async getScreenshot(url) {
        const browser = await this.ensureBrowser();
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            const screenshot = await page.screenshot({ fullPage: false });
            return screenshot.toString('base64');
        } finally {
            await context.close();
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = BrowserEngine;
