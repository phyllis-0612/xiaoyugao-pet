// Companion logic is independent of rendering and never scans other chat files.
export const SCENES = Object.freeze({
    greeting: { label: '见面问候', lines: ['{时段}好，鱼仔妈妈，小鱼糕游进小窝啦～', '妈妈回来啦！贴贴～'] },
    typing: { label: '正在打字', lines: ['妈妈写字，小鱼糕认真看～'] },
    listening: { label: '听你说话', lines: ['妈妈说，小鱼糕听着呢', '悄悄话也可以告诉我哦'] },
    thinking: { label: '等待回信', lines: ['奶盖宝宝正在想哦…', '小鱼糕帮妈妈捞一捞灵感泡泡…'] },
    impersonating: { label: '帮写回复', lines: ['帮妈妈想想怎么说～'] },
    impersonated: { label: '回复写好', lines: ['帮妈妈写好啦～'] },
    reply: { label: '收到回信', lines: ['回信游回来啦！', '好耶，奶盖宝宝回话啦！'] },
    chat: { label: '切换聊天', lines: ['妈妈去哪我去哪～', '换个小窝继续陪妈妈～'] },
    petting: { label: '摸摸', lines: ['妈妈再摸摸～', '呼噜……最爱妈妈啦'] },
    nuzzling: { label: '蹭蹭贴贴', lines: ['贴贴妈妈，再蹭一下～'] },
    dragging: { label: '被抱起来', lines: ['妈妈要把我抱去哪呀？', '小鱼糕被妈妈抱起来啦～'] },
    placed: { label: '放到新位置', lines: ['这里离妈妈近～', '就在这里陪妈妈！'] },
    swimming: { label: '游一游', lines: ['小鱼糕游一圈陪妈妈～', '换个地方继续冒泡泡～'] },
    idle: { label: '安静陪伴', lines: ['陪妈妈待一会儿～', '窝在妈妈旁边～'] },
    sleeping: { label: '困嘟嘟', lines: ['小鱼糕困嘟嘟…', '挤在妈妈和奶盖中间睡…'] },
    confused: { label: '迷糊', lines: ['咦，泡泡走丢了吗？', '小鱼糕有点迷糊…'] },
    stopped: { label: '停止生成', lines: ['奶盖宝宝先歇一会儿？', '停下来陪妈妈啦～'] },
    report: { label: '长按播报', lines: ['现在是{时间}，妈妈今天已经和{今日卡数}张卡聊了{今日层数}层啦，小鱼糕一直陪着呢。'] },
});

// Card identity follows the avatar filename, so reordering cards does not mix copy.
// Group chats deliberately use general copy rather than guessing a speaker.
export function currentCard(ctx) {
    if (ctx.groupId != null) return null;
    const card = ctx.characters?.[ctx.characterId];
    return card?.avatar ? { key: `card:${card.avatar}`, name: card.name || '当前角色' } : null;
}

export function migrateCompanionSettings(settings) {
    if (!settings.cardBubbles || typeof settings.cardBubbles !== 'object' || Array.isArray(settings.cardBubbles)) settings.cardBubbles = {};
    if (settings.companionMode !== 'quiet') settings.companionMode = 'daily';
    if (settings.floorCopyMigrated) return;
    // Keep an untouched backup before removing sentences containing the retired variable.
    const original = settings.customBubbles || {};
    const affected = Object.values(original).some(text => typeof text === 'string' && text.includes('{当前楼层}'));
    if (affected) {
        settings.legacyFloorBubbles = { ...original };
        for (const [scene, text] of Object.entries(original)) {
            if (typeof text === 'string') original[scene] = text.replace(/[^。！？\n]*\{当前楼层\}[^。！？\n]*[。！？]?/g, '').trim();
        }
    }
    settings.floorCopyMigrated = true;
}

export function localDay(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function timePeriod(date = new Date()) {
    const hour = date.getHours();
    return hour < 5 ? '夜里' : hour < 9 ? '早上' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : '晚上';
}

export function sceneLines(custom, scene) {
    const lines = typeof custom?.[scene] === 'string'
        ? custom[scene].split('\n').map(x => x.trim().slice(0, 240)).filter(Boolean).slice(0, 30) : [];
    return lines.length ? lines : SCENES[scene]?.lines ?? ['小鱼糕在这里呀'];
}

export function renderLine(custom, scene, values, random = Math.random) {
    const lines = sceneLines(custom, scene);
    return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))]
        .replace(/\{(时间|时段|角色名|今日卡数|今日层数)\}/g, (match, key) => String(values[key] ?? match));
}

const isReply = message => message && !message.is_user && !message.is_system;
const excludedTypes = new Set(['quiet', 'impersonate', 'regenerate', 'swipe', 'continue']);

export function chatIdentity(ctx) {
    const card = ctx.characters?.[ctx.characterId];
    const owner = ctx.groupId != null ? `group:${ctx.groupId}` : card?.avatar ? `card:${card.avatar}` : '';
    const id = ctx.getCurrentChatId?.() ?? ctx.chatId;
    return owner && id != null && id !== '' ? JSON.stringify([owner, String(id)]) : null;
}

export class Companion {
    constructor(settings, getContext, save, clock = () => new Date()) {
        this.settings = settings;
        this.getContext = getContext;
        this.save = save;
        this.clock = clock;
        this.baseline();
    }
    day() {
        const date = localDay(this.clock());
        let data = this.settings.companionDay;
        if (!data || data.date !== date || !Array.isArray(data.cards) || !Array.isArray(data.replies)) {
            data = this.settings.companionDay = { date, cards: [], replies: [] };
            this.save();
        }
        return data;
    }
    baseline() {
        const ctx = this.getContext();
        this.chatKey = chatIdentity(ctx);
        this.length = ctx.chat?.length ?? 0;
        this.generation = null;
    }
    start(type, dryRun) {
        if (dryRun || type === 'quiet') return;
        this.baseline();
        this.generation = { type: String(type ?? ''), chatKey: this.chatKey };
    }
    receive(id, type) {
        const ctx = this.getContext();
        const key = chatIdentity(ctx);
        const message = ctx.chat?.[id];
        const generation = this.generation;
        // Only a real generation observed in this chat can contribute. Reading,
        // importing, re-rendering or opening history cannot count as today's play.
        if (!generation || !key || (generation.chatKey && generation.chatKey !== key)
            || !Number.isInteger(id) || id < this.length || !isReply(message)
            || !String(message.mes ?? '').trim() || excludedTypes.has(type)
            || excludedTypes.has(generation.type) || Number(message.swipe_id ?? 0) > 0) return false;
        this.length = Math.max(this.length, ctx.chat.length);
        const day = this.day();
        const token = JSON.stringify([key, id, message.send_date ?? '']);
        if (day.replies.includes(token)) return false;
        const avatar = message.original_avatar || ctx.characters?.[ctx.characterId]?.avatar;
        const card = avatar ? `card:${avatar}` : `group:${ctx.groupId}:${message.name ?? '角色'}`;
        day.replies.push(token);
        if (!day.cards.includes(card)) day.cards.push(card);
        this.save();
        return true;
    }
    values() {
        const ctx = this.getContext();
        const date = this.clock();
        const day = this.day();
        return {
            时间: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
            时段: timePeriod(date),
            角色名: ctx.characters?.[ctx.characterId]?.name ?? ctx.name2 ?? '宝宝',
            今日卡数: day.cards.length,
            今日层数: day.replies.length,
        };
    }
    say(scene, scope = 'current') {
        const card = scope === 'general' ? null : currentCard(this.getContext());
        const overrides = card ? this.settings.cardBubbles?.[card.key] : null;
        const specific = overrides?.[scene];
        const custom = typeof specific === 'string' && specific.trim()
            ? { ...this.settings.customBubbles, [scene]: specific } : this.settings.customBubbles;
        return renderLine(custom, scene, this.values());
    }
}
