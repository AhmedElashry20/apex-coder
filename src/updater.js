const SearchEngine = require('./search');

class Updater {
    constructor(ollamaEngine, memoryEngine) {
        this.ollama = ollamaEngine;
        this.memory = memoryEngine;
        this.searchEngine = new SearchEngine();
        this.updateInterval = null;

        // Top technologies to track
        this.technologies = [
            'React', 'Next.js', 'Vue.js', 'Angular', 'Svelte',
            'Node.js', 'Deno', 'Bun', 'Express.js', 'Fastify',
            'Python', 'Django', 'FastAPI', 'Flask',
            'TypeScript', 'Rust', 'Go', 'Swift', 'Kotlin',
            'Docker', 'Kubernetes', 'Terraform',
            'PostgreSQL', 'MongoDB', 'Redis', 'SQLite',
            'TailwindCSS', 'Electron', 'Tauri',
            'OpenAI API', 'LangChain', 'LlamaIndex', 'Ollama',
            'PyTorch', 'TensorFlow', 'Hugging Face',
            'AWS', 'Google Cloud', 'Azure', 'Vercel', 'Cloudflare',
            'Git', 'GitHub Actions', 'CI/CD',
            'GraphQL', 'tRPC', 'gRPC',
            'Playwright', 'Cypress', 'Jest', 'Vitest',
            'Prisma', 'Drizzle ORM', 'SQLAlchemy',
            'Nginx', 'Caddy',
            'Linux kernel', 'macOS updates', 'iOS development', 'Android development'
        ];
    }

    startAutoUpdate(intervalMs = 7 * 24 * 60 * 60 * 1000) {
        // Weekly updates
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(() => {
            this.updateKnowledge().catch(err => {
                console.error('Auto-update failed:', err.message);
            });
        }, intervalMs);
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    async updateKnowledge() {
        console.log('Starting knowledge update...');
        const results = [];
        const batchSize = 5;

        for (let i = 0; i < this.technologies.length; i += batchSize) {
            const batch = this.technologies.slice(i, i + batchSize);
            const batchPromises = batch.map(tech => this.updateTechnology(tech));

            const batchResults = await Promise.allSettled(batchPromises);
            batchResults.forEach((result, idx) => {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(result.value);
                }
            });

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log(`Knowledge update complete. Updated ${results.length} technologies.`);
        return results;
    }

    async updateTechnology(techName) {
        try {
            const query = `${techName} latest release changelog 2024 2025`;
            const searchResults = await this.searchEngine.search(query, 3);

            if (searchResults.length === 0) return null;

            let content = '';
            for (const result of searchResults.slice(0, 2)) {
                try {
                    const page = await this.searchEngine.fetchPage(result.url);
                    content += `\n\nSource: ${result.url}\n${page.content.substring(0, 2000)}`;
                } catch (e) {
                    content += `\n\n${result.title}: ${result.snippet}`;
                }
            }

            if (!content.trim()) return null;

            // Use AI to summarize
            let summary;
            try {
                const messages = [
                    {
                        role: 'system',
                        content: 'Summarize the latest updates for this technology in 3-5 bullet points. Focus on: version numbers, new features, breaking changes, deprecations. Be concise.'
                    },
                    {
                        role: 'user',
                        content: `Technology: ${techName}\n\nRaw content:\n${content.substring(0, 4000)}`
                    }
                ];

                summary = await this.ollama.chat('qwen2.5-coder:7b', messages);
            } catch (e) {
                summary = content.substring(0, 500);
            }

            // Save to memory
            this.memory.saveKnowledgeUpdate(techName, summary, 'auto-update');

            return { technology: techName, summary };
        } catch (error) {
            console.error(`Failed to update ${techName}:`, error.message);
            return null;
        }
    }
}

module.exports = Updater;
