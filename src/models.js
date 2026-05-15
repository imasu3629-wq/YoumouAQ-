/**
 * 利用可能なAIモデル定義
 */
const MODELS = {
    // ── OpenAI / GPT (VectorEngine経由) ──
    'gpt-5.5': {
        name: 'GPT-5.5',
        provider: 'openai',
        emoji: '💎',
        description: 'OpenAI最上位。複雑な推論や長文作成に最適。\n入力 💰5.000 / 出力 💰30.000 (1M)',
    },
    'gpt-5.4-mini': {
        name: 'GPT-5.4 mini',
        provider: 'openai',
        emoji: '🟢',
        description: '速度と精度のバランスが良く、日常的な利用に。\n入力 💰0.7500 / 出力 💰4.5000 (1M)',
    },
    'gpt-5.4-nano': {
        name: 'GPT-5.4 nano',
        provider: 'openai',
        emoji: '⚡',
        description: '超高速・低コスト。簡単な質問や挨拶に最適。\n入力 💰0.2000 / 出力 💰1.2500 (1M)',
    },
    'grok-3-image': {
        name: 'Grok-3 Image',
        provider: 'openai',
        emoji: '🎨',
        description: '画像生成専用。プロンプトから高品質な画像を作成。\n💰0.050 / 回',
    },

    // ── Claude (VectorEngine経由) ──
    'claude-4.7-opus': {
        name: 'Claude 4.7 Opus',
        provider: 'claude',
        emoji: '💜',
        description: 'Anthropic最高峰。極めて自然で深い理解力を持つ。\n入力 💰5.0000 / 出力 💰25.0000 (1M)',
    },
    'claude-4.6-sonnet': {
        name: 'Claude 4.6 Sonnet',
        provider: 'claude',
        emoji: '🟠',
        description: 'コーディングや文章添削に非常に強い万能モデル。\n入力 💰3.0000 / 出力 💰15.0000 (1M)',
    },
};

const DEFAULT_MODEL = 'gpt-5.4-nano';

// デフォルトモデル用の軽量システムプロンプト
const DEFAULT_SYSTEM_PROMPT = 'YoumouAIです。';

module.exports = { MODELS, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT };
