const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    role: { type: String, enum: ['admin', 'whitelist', 'regular'], default: 'regular' },
    addedBy: { type: String },
    createdAt: { type: Date, default: Date.now },
    // 追加: ユーザー設定保存用
    settings: {
        lastModel: { type: String },
        systemPrompt: { type: String }
    }
});

const User = mongoose.model('User', userSchema);

async function connectDB(uri) {
    if (!uri) {
        console.warn('⚠️ MONGODB_URI が設定されていません。データベース機能は制限されます。');
        return;
    }
    try {
        await mongoose.connect(uri);
        console.log('📦 MongoDB に接続しました');
    } catch (err) {
        console.error('❌ MongoDB 接続エラー:', err);
    }
}

module.exports = { User, connectDB };
