require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    Partials,
    SlashCommandBuilder,
    REST,
    Routes,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
} = require('discord.js');
const cheerio = require('cheerio');

const AIClient = require('./src/aiClient');
const { MODELS, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } = require('./src/models');
const { estimateTokens, splitMessage, formatDuration, formatUsage } = require('./src/utils');
const { User, connectDB } = require('./src/database');

// ── 初期管理者リスト ──
const ADMIN_IDS = ['1278574483195559977', '1356921196796706981'];

// ── クライアント初期化 ──
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const ai = new AIClient({
    vectorEngineKey: process.env.VECTORENGINE_API_KEY,
    vectorEngineBase: process.env.VECTORENGINE_BASE_URL,
    geminiKey: process.env.GEMINI_API_KEY,
});

const sessions = new Map();
const MAX_HISTORY_TOKENS = 2500;

async function getSession(userId) {
    if (!sessions.has(userId)) {
        const role = await getUserRole(userId);
        let model = DEFAULT_MODEL;
        let systemPrompt = DEFAULT_SYSTEM_PROMPT;
        if (role !== 'regular') {
            const dbUser = await User.findOne({ discordId: userId });
            if (dbUser && dbUser.settings) {
                if (dbUser.settings.lastModel && MODELS[dbUser.settings.lastModel]) model = dbUser.settings.lastModel;
                if (dbUser.settings.systemPrompt !== undefined) systemPrompt = dbUser.settings.systemPrompt;
            }
        }
        sessions.set(userId, { model, modelChanged: model !== DEFAULT_MODEL, history: [], systemPrompt, totalTokens: { input: 0, output: 0 }, messageCount: 0 });
    }
    return sessions.get(userId);
}

async function saveUserSettings(userId, session) {
    const role = await getUserRole(userId);
    if (role === 'regular') return;
    await User.findOneAndUpdate({ discordId: userId }, { $set: { 'settings.lastModel': session.model, 'settings.systemPrompt': session.systemPrompt } }, { upsert: true });
}

async function getUserRole(userId) {
    if (ADMIN_IDS.includes(userId)) return 'admin';
    const user = await User.findOne({ discordId: userId });
    return user ? user.role : 'regular';
}

async function updateSessionModel(userId, session, newModel) {
    session.model = newModel;
    session.modelChanged = (newModel !== DEFAULT_MODEL);
    session.systemPrompt = session.modelChanged ? '' : DEFAULT_SYSTEM_PROMPT;
    await saveUserSettings(userId, session);
}

function getProvider(session) {
    const info = MODELS[session.model];
    if (info) return info.provider;
    return 'openai';
}

function getModelDisplay(session) {
    const info = MODELS[session.model];
    return info ? `${info.emoji} ${info.name}` : `🤖 ${session.model}`;
}

function getModelColor(model) {
    if (model.includes('gpt')) return 0x10A37F;
    if (model.includes('claude')) return 0xD97706;
    return 0x5865F2;
}

// ══════════════════════════════════════════
//  イベント & コマンド
// ══════════════════════════════════════════
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} がオンラインになりました！`);
    await connectDB(process.env.MONGODB_URI);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示'),
        new SlashCommandBuilder().setName('dash').setDescription('ダッシュボードを表示'),
        new SlashCommandBuilder().setName('stats').setDescription('統計情報を表示'),
        new SlashCommandBuilder().setName('whitelist').setDescription('ホワイトリスト管理'),
    ];
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const isDM = !message.guild;
    const content = message.content.trim();
    const role = await getUserRole(message.author.id);

    if (content.startsWith('!')) {
        const args = content.slice(1).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();
        if (cmd === 'dash') return await showDashboard(message, message.author.id, role);
        if (cmd === 'help') return await showHelp(message);
        if (cmd === 'stats') return await showStats(message, message.author.id);
        if (cmd === 'whitelist') return await showWhitelistDashboard(message, 0);
        if (cmd === 'clear') { (await getSession(message.author.id)).history = []; return message.reply('🗑️ 履歴をクリアしました。'); }
    }
    if (isDM && !content.startsWith('!')) await handleChat(message, content);
});

client.on('interactionCreate', async (interaction) => {
    const role = await getUserRole(interaction.user.id);
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'help') return await showHelp(interaction, true);
        if (interaction.commandName === 'dash') return await showDashboard(interaction, interaction.user.id, role, true);
        if (interaction.commandName === 'stats') return await showStats(interaction, interaction.user.id, true);
        if (interaction.commandName === 'whitelist') return await showWhitelistDashboard(interaction, 0, true);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'modal_whitelist_add') {
        const id = interaction.fields.getTextInputValue('input_discord_id');
        await User.findOneAndUpdate({ discordId: id }, { role: 'whitelist', addedBy: interaction.user.id }, { upsert: true });
        await interaction.reply({ content: `✅ 追加しました: ${id}`, ephemeral: true });
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) await handleDashboardInteraction(interaction, role);
});

// ── リアクション操作 ──
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message;
    if (message.author.id !== client.user.id) return;

    const emoji = reaction.emoji.name;
    let promptPrefix = '';
    if (emoji === '📝') promptPrefix = '以下のメッセージを簡潔に要約してください：\n\n';
    else if (emoji === '🌐') promptPrefix = '以下のメッセージを日本語に翻訳してください（日本語の場合は英語に）：\n\n';
    else if (emoji === '🔍') promptPrefix = '以下のメッセージの内容を詳しく解説してください：\n\n';
    else return;

    // リアクションを消す
    await reaction.users.remove(user.id).catch(() => {});

    // AIで処理
    const session = await getSession(user.id);
    await message.channel.sendTyping();
    const result = await ai.chat(session.model, [{ role: 'user', content: promptPrefix + message.content }], '', getProvider(session));
    await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${emoji} クイックアクション結果`).setDescription(result.content)] });
});

// ══════════════════════════════════════════
//  UIコンポーネント
// ══════════════════════════════════════════
async function showStats(ctx, userId, isSlash = false) {
    const session = await getSession(userId);
    const total = session.totalTokens.input + session.totalTokens.output;
    const embed = new EmbedBuilder()
        .setTitle('📈 統計レポート')
        .setColor(0x5865F2)
        .addFields(
            { name: '📥 入力トークン', value: `\`${session.totalTokens.input.toLocaleString()}\``, inline: true },
            { name: '📤 出力トークン', value: `\`${session.totalTokens.output.toLocaleString()}\``, inline: true },
            { name: '📊 合計トークン', value: `\`${total.toLocaleString()}\``, inline: true },
            { name: '💬 メッセージ数', value: `\`${session.messageCount}\` 回`, inline: true },
        )
        .setTimestamp();
    isSlash ? await ctx.reply({ embeds: [embed] }) : await ctx.reply({ embeds: [embed] });
}

async function showHelp(ctx, isSlash = false) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 YoumouAI 総合ヘルプ')
        .setColor(0x5865F2)
        .setDescription('**マルチモデル対応の次世代AIアシスタント**')
        .addFields(
            { name: '📝 リアクション・クイック操作', value: 'ボットの返信に以下のリアクションをすると即座に実行します：\n・📝 : メッセージを要約\n・🌐 : 翻訳 (日↔英)\n・🔍 : 詳しく解説' },
            { name: '📈 統計確認', value: '`!stats` / `/stats` であなたのトークン使用状況を確認できます。' },
            { name: '⚙️ ダッシュボード', value: '`!dash` / `/dash` でモデル変更や履歴リセットが可能です。' },
            { name: '🛡️ 権限', value: '・Regular: デフォルトのみ\n・Whitelist: モデル変更保存可\n・Admin: 全機能' }
        );
    isSlash ? await ctx.reply({ embeds: [embed] }) : await ctx.reply({ embeds: [embed] });
}

// (他、Dashboard/Whitelistなどの関数は簡略化して維持)
async function handleDashboardInteraction(interaction, role) {
    const userId = interaction.user.id;
    const session = await getSession(userId);
    const cid = interaction.customId;
    if (cid === 'dash_model_change') {
        const options = Object.entries(MODELS).slice(0, 25).map(([id, m]) => ({ label: m.name, value: id, emoji: m.emoji }));
        await interaction.reply({ content: '選択:', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('dash_model_select').addOptions(options))], ephemeral: true });
    } else if (cid === 'dash_model_select') {
        await updateSessionModel(userId, session, interaction.values[0]);
        await interaction.update({ content: '✅ 変更しました。', components: [] });
    } else if (cid === 'dash_clear') {
        session.history = [];
        await interaction.reply({ content: '🗑️ クリアしました。', ephemeral: true });
    }
}

async function showDashboard(ctx, userId, role, isSlash = false) {
    const session = await getSession(userId);
    const embed = new EmbedBuilder().setTitle('📊 ダッシュボード').setColor(0x5865F2).addFields({ name: '🤖 モデル', value: getModelDisplay(session) });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_model_change').setLabel('モデル変更').setStyle(ButtonStyle.Primary).setDisabled(role === 'regular'),
        new ButtonBuilder().setCustomId('dash_clear').setLabel('履歴クリア').setStyle(ButtonStyle.Danger)
    );
    await ctx.reply({ embeds: [embed], components: [row] });
}

async function showWhitelistDashboard(ctx, page = 0, isSlash = false, isUpdate = false) {
    const role = await getUserRole(ctx.user?.id || ctx.author?.id);
    if (role !== 'admin') return ctx.reply({ content: '❌ Admin専用です。', ephemeral: true });
    const users = await User.find({ role: 'whitelist' }).skip(page * 10).limit(10);
    const embed = new EmbedBuilder().setTitle('🛡️ ホワイトリスト').setDescription(users.map(u => `<@${u.discordId}>`).join('\n') || 'なし');
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('wl_add').setLabel('追加').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('wl_remove_menu').setLabel('削除').setStyle(ButtonStyle.Danger)
    );
    isUpdate ? await ctx.update({ embeds: [embed], components: [row] }) : await ctx.reply({ embeds: [embed], components: [row] });
}

// ── AIチャット処理 ──
async function extractWebContent(text) {
    if (!text) return text;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    if (!urls) return text;

    let augmentedText = text;
    for (const url of urls) {
        try {
            const res = await fetch(url);
            const html = await res.text();
            const $ = cheerio.load(html);
            $('script, style, noscript, iframe, img, svg, video').remove();
            let pageText = $('body').text().replace(/\s+/g, ' ').trim();
            if (pageText.length > 2000) pageText = pageText.substring(0, 2000) + '...';
            augmentedText += `\n\n[Web Reference: ${url}]\n${pageText}`;
        } catch (e) {
            console.error(`URL fetch error ${url}:`, e);
        }
    }
    return augmentedText;
}

function trimHistoryByTokens(history, maxTokens) {
    let currentTokens = 0;
    const trimmed = [];
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        let msgTokens = 0;
        if (typeof msg.content === 'string') {
            msgTokens = estimateTokens(msg.content);
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') msgTokens += estimateTokens(part.text);
                else msgTokens += 500; // rough image estimate
            }
        }
        if (currentTokens + msgTokens > maxTokens) break;
        currentTokens += msgTokens;
        trimmed.unshift(msg);
    }
    return trimmed;
}

async function handleChat(message, userMessage) {
    const session = await getSession(message.author.id);
    await message.channel.sendTyping();
    const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);
    try {
        const contentParts = [];
        if (userMessage) {
            const augmentedMessage = await extractWebContent(userMessage);
            contentParts.push({ type: 'text', text: augmentedMessage });
        }
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                const buffer = await (await fetch(attachment.url)).arrayBuffer();
                contentParts.push({ type: attachment.contentType?.startsWith('image/') ? 'image' : 'video', mime_type: attachment.contentType, data: Buffer.from(buffer).toString('base64') });
            }
        }
        session.history.push({ role: 'user', content: contentParts.length === 1 && contentParts[0].type === 'text' ? contentParts[0].text : contentParts });
        
        session.history = trimHistoryByTokens(session.history, MAX_HISTORY_TOKENS);
        
        const result = await ai.chat(session.model, session.history, session.systemPrompt, getProvider(session));
        session.history.push({ role: 'assistant', content: result.content });
        session.messageCount++;
        if (result.usage) { session.totalTokens.input += result.usage.prompt_tokens; session.totalTokens.output += result.usage.completion_tokens; }
        await sendAIResponse(message, result, session);
    } finally { clearInterval(typingInterval); }
}

async function sendAIResponse(message, result, session) {
    const imageUrlMatch = result.content.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)/i);
    const parts = splitMessage(result.content, 4000);
    const files = [];
    if (session.model === 'grok-3-image' && imageUrlMatch) {
        const buffer = Buffer.from(await (await fetch(imageUrlMatch[0])).arrayBuffer());
        files.push(new AttachmentBuilder(buffer, { name: 'image.png' }));
    }

    for (let i = 0; i < parts.length; i++) {
        const embed = new EmbedBuilder().setColor(getModelColor(session.model)).setDescription(parts[i]);
        if (i === 0) embed.setAuthor({ name: getModelDisplay(session) });
        if (i === parts.length - 1 && imageUrlMatch && session.model !== 'grok-3-image') embed.setImage(imageUrlMatch[0]);
        const payload = { embeds: [embed] };
        if (i === parts.length - 1 && files.length > 0) payload.files = files;
        
        const sent = await (i === 0 ? message.reply(payload) : message.channel.send(payload));
        
        // リアクションを自動追加
        if (i === parts.length - 1) {
            await sent.react('📝').catch(() => {});
            await sent.react('🌐').catch(() => {});
            await sent.react('🔍').catch(() => {});
        }
    }
}

client.login(process.env.DISCORD_TOKEN);
