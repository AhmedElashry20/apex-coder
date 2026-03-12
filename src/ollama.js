const http = require('http');

class OllamaEngine {
    constructor(baseUrl = 'http://localhost:11434') {
        this.baseUrl = baseUrl;
    }

    async checkConnection() {
        return new Promise((resolve) => {
            const url = new URL(this.baseUrl);
            const req = http.get({
                hostname: url.hostname,
                port: url.port,
                path: '/',
                timeout: 3000
            }, (res) => {
                resolve(true);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    async listModels() {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            const req = http.get({
                hostname: url.hostname,
                port: url.port,
                path: '/api/tags',
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        const models = (parsed.models || []).map(m => ({
                            name: m.name,
                            size: m.size,
                            modified: m.modified_at
                        }));
                        resolve(models);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });
            req.on('error', () => resolve([]));
        });
    }

    async chat(model, messages) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            const body = JSON.stringify({
                model,
                messages,
                stream: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: 4096
                }
            });

            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 120000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.message && parsed.message.content) {
                            resolve(parsed.message.content);
                        } else {
                            reject(new Error('Invalid response from Ollama'));
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse Ollama response'));
                    }
                });
            });

            req.on('error', (e) => reject(new Error(`Ollama connection error: ${e.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Ollama request timed out'));
            });
            req.write(body);
            req.end();
        });
    }

    async chatStream(model, messages, onChunk) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            const body = JSON.stringify({
                model,
                messages,
                stream: true,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    num_predict: 4096
                }
            });

            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 120000
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const parsed = JSON.parse(line);
                                if (parsed.message && parsed.message.content) {
                                    onChunk(parsed.message.content);
                                }
                                if (parsed.done) {
                                    resolve();
                                }
                            } catch (e) {
                                // skip malformed lines
                            }
                        }
                    }
                });
                res.on('end', () => resolve());
            });

            req.on('error', (e) => reject(new Error(`Stream error: ${e.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Stream timed out'));
            });
            req.write(body);
            req.end();
        });
    }

    async generateEmbedding(text) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            const body = JSON.stringify({
                model: 'nomic-embed-text',
                prompt: text
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
                timeout: 30000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.embedding || []);
                    } catch (e) {
                        reject(new Error('Failed to generate embedding'));
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.write(body);
            req.end();
        });
    }
}

module.exports = OllamaEngine;
