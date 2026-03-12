const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');

class MemoryEngine {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.dbPath = path.join(dataDir, 'conversations.db');
        this.memoryDir = path.join(dataDir, 'memory');
        this.learnedDir = path.join(dataDir, 'learned');
        this.db = null;
        this.ollamaUrl = 'http://localhost:11434';
    }

    async initialize() {
        // Ensure directories
        [this.memoryDir, this.learnedDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Initialize SQLite
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_message TEXT NOT NULL,
                ai_response TEXT NOT NULL,
                model TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS memory_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                embedding_json TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS knowledge_updates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);
        `);
    }

    saveConversation(userMessage, aiResponse, model) {
        const stmt = this.db.prepare(
            'INSERT INTO conversations (user_message, ai_response, model) VALUES (?, ?, ?)'
        );
        stmt.run(userMessage, aiResponse, model || 'unknown');
    }

    getRecentConversations(limit = 50) {
        const stmt = this.db.prepare(
            'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?'
        );
        return stmt.all(limit);
    }

    searchConversations(query) {
        const stmt = this.db.prepare(
            `SELECT * FROM conversations
             WHERE user_message LIKE ? OR ai_response LIKE ?
             ORDER BY timestamp DESC LIMIT 20`
        );
        const pattern = `%${query}%`;
        return stmt.all(pattern, pattern);
    }

    async addToLongTermMemory(userMessage, aiResponse) {
        const combined = `User: ${userMessage}\nAI: ${aiResponse.substring(0, 500)}`;

        try {
            const embedding = await this.generateEmbedding(combined);
            const stmt = this.db.prepare(
                'INSERT INTO memory_entries (content, category, embedding_json) VALUES (?, ?, ?)'
            );
            stmt.run(combined, 'conversation', JSON.stringify(embedding));
        } catch (e) {
            // Save without embedding if Ollama is unavailable
            const stmt = this.db.prepare(
                'INSERT INTO memory_entries (content, category) VALUES (?, ?)'
            );
            stmt.run(combined, 'conversation');
        }
    }

    async searchMemory(query) {
        try {
            const queryEmbedding = await this.generateEmbedding(query);

            const entries = this.db.prepare(
                'SELECT * FROM memory_entries WHERE embedding_json IS NOT NULL ORDER BY timestamp DESC LIMIT 100'
            ).all();

            if (entries.length === 0) {
                return this.searchConversations(query);
            }

            // Calculate cosine similarity
            const scored = entries.map(entry => {
                try {
                    const entryEmbedding = JSON.parse(entry.embedding_json);
                    const similarity = this.cosineSimilarity(queryEmbedding, entryEmbedding);
                    return { ...entry, similarity };
                } catch (e) {
                    return { ...entry, similarity: 0 };
                }
            });

            scored.sort((a, b) => b.similarity - a.similarity);
            return scored.slice(0, 5);
        } catch (e) {
            return this.searchConversations(query);
        }
    }

    async getRelevantContext(query) {
        try {
            const results = await this.searchMemory(query);
            if (!results || results.length === 0) return '';

            return results
                .filter(r => (r.similarity || 0) > 0.3)
                .map(r => r.content)
                .join('\n---\n')
                .substring(0, 3000);
        } catch (e) {
            return '';
        }
    }

    saveKnowledgeUpdate(topic, content, source) {
        const stmt = this.db.prepare(
            'INSERT INTO knowledge_updates (topic, content, source) VALUES (?, ?, ?)'
        );
        stmt.run(topic, content, source || 'auto-update');
    }

    getKnowledgeUpdates(topic) {
        const stmt = this.db.prepare(
            'SELECT * FROM knowledge_updates WHERE topic LIKE ? ORDER BY timestamp DESC LIMIT 10'
        );
        return stmt.all(`%${topic}%`);
    }

    async generateEmbedding(text) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.ollamaUrl);
            const body = JSON.stringify({
                model: 'nomic-embed-text',
                prompt: text.substring(0, 2000)
            });

            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: '/api/embeddings',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 15000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.embedding || []);
                    } catch (e) {
                        reject(new Error('Failed to parse embedding response'));
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Embedding request timed out'));
            });
            req.write(body);
            req.end();
        });
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length || a.length === 0) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        if (denominator === 0) return 0;

        return dotProduct / denominator;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MemoryEngine;
