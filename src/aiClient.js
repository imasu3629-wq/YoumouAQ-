/**
 * AI APIクライアント (マルチモーダル対応版)
 */
class AIClient {
    constructor({ vectorEngineKey, vectorEngineBase, geminiKey }) {
        this.vectorEngineKey = vectorEngineKey;
        this.vectorEngineBase = vectorEngineBase;
        this.geminiKey = geminiKey;
    }

    /**
     * @param {string} model 
     * @param {Array} messages [{role, content: string | Array<{type, text?, image_url?, data?, mime_type?}>}]
     * @param {string} systemPrompt 
     * @param {string} provider 
     */
    async chat(model, messages, systemPrompt, provider) {
        switch (provider) {
            case 'gemini':
                return this._chatGemini(model, messages, systemPrompt);
            case 'claude':
                return this._chatClaude(model, messages, systemPrompt);
            default:
                return this._chatOpenAI(model, messages, systemPrompt);
        }
    }

    // ── Google Gemini (画像・動画・ファイル対応) ──
    async _chatGemini(model, messages, systemPrompt) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`;

        const contents = messages.map(m => {
            const parts = [];
            if (typeof m.content === 'string') {
                parts.push({ text: m.content });
            } else {
                for (const part of m.content) {
                    if (part.type === 'text') {
                        parts.push({ text: part.text });
                    } else if (part.type === 'image' || part.type === 'file' || part.type === 'video') {
                        parts.push({
                            inlineData: {
                                mimeType: part.mime_type,
                                data: part.data // base64
                            }
                        });
                    }
                }
            }
            return {
                role: m.role === 'assistant' ? 'model' : 'user',
                parts
            };
        });

        const body = { contents };
        if (systemPrompt) {
            body.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Gemini API Error (${res.status}): ${err}`);
        }

        const data = await res.json();
        const content = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        const usage = data.usageMetadata ? {
            prompt_tokens: data.usageMetadata.promptTokenCount || 0,
            completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
            total_tokens: data.usageMetadata.totalTokenCount || 0,
        } : null;

        return { content, usage, model };
    }

    // ── VectorEngine OpenAI互換 (画像対応) ──
    async _chatOpenAI(model, messages, systemPrompt) {
        const formattedMessages = [];
        if (systemPrompt) {
            formattedMessages.push({ role: 'system', content: systemPrompt });
        }

        for (const m of messages) {
            let content;
            if (typeof m.content === 'string') {
                content = m.content;
            } else {
                content = m.content.map(p => {
                    if (p.type === 'text') return { type: 'text', text: p.text };
                    if (p.type === 'image') return {
                        type: 'image_url',
                        image_url: { url: `data:${p.mime_type};base64,${p.data}` }
                    };
                    return null;
                }).filter(Boolean);
            }
            formattedMessages.push({ role: m.role, content });
        }

        const url = `${this.vectorEngineBase}/v1/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.vectorEngineKey}`,
            },
            body: JSON.stringify({ model, messages: formattedMessages, max_tokens: 4096 }),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI API Error (${res.status}): ${err}`);
        }

        const data = await res.json();
        return {
            content: data.choices[0].message.content,
            usage: data.usage || null,
            model: data.model || model,
        };
    }

    // ── VectorEngine Claude互換 (画像対応) ──
    async _chatClaude(model, messages, systemPrompt) {
        const formattedMessages = messages.map(m => {
            let content;
            if (typeof m.content === 'string') {
                content = m.content;
            } else {
                content = m.content.map(p => {
                    if (p.type === 'text') return { type: 'text', text: p.text };
                    if (p.type === 'image') return {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: p.mime_type,
                            data: p.data
                        }
                    };
                    return null;
                }).filter(Boolean);
            }
            return { role: m.role, content };
        });

        const body = { model, messages: formattedMessages, max_tokens: 4096 };
        if (systemPrompt) body.system = systemPrompt;

        const url = `${this.vectorEngineBase}/v1/messages`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.vectorEngineKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Claude API Error (${res.status}): ${err}`);
        }

        const data = await res.json();
        const content = data.content.map(c => c.text).join('');
        const usage = data.usage ? {
            prompt_tokens: data.usage.input_tokens || 0,
            completion_tokens: data.usage.output_tokens || 0,
            total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : null;

        return { content, usage, model: data.model || model };
    }
}

module.exports = AIClient;
