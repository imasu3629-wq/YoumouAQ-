/**
 * ユーティリティ関数群
 */

/**
 * テキストのトークン数を推定
 * 英語: ~4文字/トークン, 日本語: ~1.5文字/トークン
 */
function estimateTokens(text) {
    if (!text) return 0;
    const jpChars = (text.match(/[\u3000-\u9fff\uff00-\uffef]/g) || []).length;
    const otherChars = text.length - jpChars;
    return Math.ceil(jpChars / 1.5 + otherChars / 4);
}

/**
 * Discord 2000文字制限に合わせてメッセージを分割
 */
function splitMessage(text, maxLength = 1900) {
    if (text.length <= maxLength) return [text];

    const parts = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            parts.push(remaining);
            break;
        }

        // コードブロック内かチェック
        let splitIndex = -1;

        // 改行で分割を試みる
        splitIndex = remaining.lastIndexOf('\n', maxLength);
        if (splitIndex < maxLength * 0.3) {
            // スペースで分割
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitIndex < maxLength * 0.3 || splitIndex === -1) {
            splitIndex = maxLength;
        }

        parts.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).trimStart();
    }

    return parts;
}

/**
 * 経過時間をフォーマット
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}秒`;
}

/**
 * トークン使用量の表示文字列を生成
 */
function formatUsage(usage) {
    if (!usage) return '使用量データなし';
    const input = usage.prompt_tokens || usage.input_tokens || 0;
    const output = usage.completion_tokens || usage.output_tokens || 0;
    const total = input + output;
    return `📥 ${input} | 📤 ${output} | 合計 ${total} トークン`;
}

module.exports = { estimateTokens, splitMessage, formatDuration, formatUsage };
