import { XiaoyugaoRenderer, PET_STATES, getSwimStrideLength, NUZZLE_DURATION_MS, WAVE_DURATION_MS } from './pet-renderer.js';

import { Companion, SCENES, sceneLines, currentCard, migrateCompanionSettings } from './companion.js';

const MODULE_NAME = 'xiaoyugao_pet';
const DEFAULT_EXTENSION_NAME = 'third-party/xiaoyugao-pet';
const POSITION_MARGIN = 10;
const DRAG_THRESHOLD = 7;
// Fur tips are soft; only clearly painted pixels count as Xiaoyugao, and the
// touch forgiveness ring is kept small so buttons beside her stay tappable.
const HIT_ALPHA = 72;
const HIT_RADIUS_TOUCH = 8;
const HIT_RADIUS_MOUSE = 3;
// Only swallow the browser's own synthetic click that follows a tap on
// Xiaoyugao; it lands within a few hundred ms at the same spot.
const CLICK_GUARD_DURATION = 450;
const CLICK_GUARD_RADIUS = 24;
// A press that never receives pointerup/pointercancel (app switch, system
// gesture) must not leave the page's touches blocked forever.
const STALE_PRESS_TIMEOUT = 15000;
const DOUBLE_TAP_WINDOW = 320;
const DOUBLE_TAP_RADIUS = 42;
const LONG_PRESS_DURATION = 600;
const REPORT_BUBBLE_DURATION = 5000;
const AMBIENT_BUBBLE_INTERVAL = 10000;
const TYPING_IDLE_DELAY = 3000;
const THINKING_COMPANION_DELAY = 20000;
const AUTO_LIE_DELAY = 12000;
const AUTO_SWIM_MIN_DELAY = 42000;
const AUTO_SWIM_JITTER = 36000;
const SWIM_MIN_DISTANCE = 52;
const SWIM_MAX_DISTANCE = 92;
const SWIM_DURATION = 3200;
// Reasoning models can sit silent for minutes. Streaming tokens re-arm this.
const GENERATION_WATCHDOG_DELAY = 300000;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    scale: 100,
    opacity: 100,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    showBubble: true,
    autoSwim: true,
    customBubbles: {},
    cardBubbles: {},
    companionMode: 'daily',
    position: {
        x: 0.82,
        y: 0.68,
    },
});

const stateLabels = Object.freeze({
    [PET_STATES.IDLE]: '小鱼糕正在陪你',
    [PET_STATES.LISTENING]: '小鱼糕在听',
    [PET_STATES.THINKING]: '小鱼糕在认真想',
    [PET_STATES.HAPPY]: '小鱼糕很开心',
    [PET_STATES.CONFUSED]: '小鱼糕有点迷糊',
    [PET_STATES.PETTING]: '小鱼糕被摸摸了',
    [PET_STATES.NUZZLING]: '小鱼糕在蹭蹭你',
    [PET_STATES.SLEEPING]: '小鱼糕睡着了',
    [PET_STATES.WAVE]: '小鱼糕在挥爪打招呼',
});

let context;
let coreApi;
let settings;
let companion;
let reportUntil = 0;
let nextAmbientBubbleAt = 0;
let refreshBubbleEditor;
let renderer;
let ui;
let initializePromise;
let reactionTimer;
let bubbleTimer;
let bubbleFollowTimer;
let positionFrame;
let hoverFrame;
let bootTimer;
let settingsLayerFrame;
let settingsLayerTimer;
let generationWatchdog;
let generationEndTimer;
let replyArrived = false;
let awaitingLateReply = false;
let currentGenerationType = '';
let lastSignalStatus = '待命，等你发消息';
let currentPriority = 0;
let priorityUntil = 0;
let isGenerating = false;
let publicApi;
let clickGuard;
let longPressTimer;
let stalePressTimer;
let pendingTap;
let typingIdleTimer;
let typingAttentionActive = false;
let thinkingBubble20Timer;
let thinkingBubble40Timer;
let thinkingCompanionMessage = '奶盖宝宝正在想哦…';
let poseTimer;
let roamTimer;
let roamFrame;
let roamRun;

const cleanups = [];

function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
}

function onEventSource(source, eventType, handler) {
    source.on(eventType, handler);
    cleanups.push(() => {
        if (typeof source.off === 'function') {
            source.off(eventType, handler);
        } else {
            source.removeListener?.(eventType, handler);
        }
    });
}

const drag = {
    active: false,
    moved: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    longPress: false,
};

function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function inferExtensionName() {
    try {
        const pathname = decodeURIComponent(new URL(import.meta.url).pathname);
        const marker = '/scripts/extensions/';
        const markerIndex = pathname.indexOf(marker);
        if (markerIndex === -1) {
            return DEFAULT_EXTENSION_NAME;
        }

        const relativePath = pathname.slice(markerIndex + marker.length);
        return relativePath.replace(/\/index\.js(?:\?.*)?$/, '');
    } catch {
        return DEFAULT_EXTENSION_NAME;
    }
}

function getSettings() {
    const { extensionSettings } = context;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = cloneDefaults();
    }

    const stored = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(stored, key)) {
            stored[key] = cloneDefaults()[key];
        }
    }

    if (!stored.customBubbles || typeof stored.customBubbles !== 'object' || Array.isArray(stored.customBubbles)) stored.customBubbles = {};

    const needsCompanionMigration = !stored.floorCopyMigrated;
    migrateCompanionSettings(stored);

    stored.position = {
        ...DEFAULT_SETTINGS.position,
        ...(stored.position ?? {}),
    };

    stored.scale = clamp(finiteNumber(stored.scale, DEFAULT_SETTINGS.scale), 40, 150);
    stored.opacity = clamp(finiteNumber(stored.opacity, DEFAULT_SETTINGS.opacity), 40, 100);
    stored.position.x = clamp(finiteNumber(stored.position.x, DEFAULT_SETTINGS.position.x), 0, 1);
    stored.position.y = clamp(finiteNumber(stored.position.y, DEFAULT_SETTINGS.position.y), 0, 1);

    if (needsCompanionMigration) saveSettings();
    return stored;
}

function saveSettings() {
    context?.saveSettingsDebounced?.();
}

function createPetUi() {
    const existing = document.getElementById('xiaoyugao-pet-root');
    existing?.remove();

    const root = document.createElement('div');
    root.id = 'xiaoyugao-pet-root';
    root.className = 'xiaoyugao-pet-root';
    root.setAttribute('role', 'button');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', stateLabels[PET_STATES.IDLE]);
    root.innerHTML = `
        <div class="xiaoyugao-speech" aria-live="polite"></div>
        <canvas class="xiaoyugao-canvas" width="500" height="500" aria-hidden="true"></canvas>
        <span class="xiaoyugao-drag-hint" aria-hidden="true">拖动 · 点摸摸 · 长按报数</span>
    `;

    document.body.append(root);

    const canvas = root.querySelector('.xiaoyugao-canvas');
    const bubble = root.querySelector('.xiaoyugao-speech');
    const hint = root.querySelector('.xiaoyugao-drag-hint');

    // The root itself is click-through. A document-level capture listener only
    // claims input that lands on Xiaoyugao's painted pixels.
    on(document, 'pointerdown', handlePointerDown, { capture: true });
    on(document, 'click', handleClickGuard, { capture: true });
    on(document, 'touchstart', handleTouchStartGuard, { capture: true, passive: false });
    on(document, 'pointermove', handlePointerMove, { capture: true, passive: false });
    on(document, 'pointerup', handlePointerUp, { capture: true });
    on(document, 'pointercancel', handlePointerCancel, { capture: true });
    on(document, 'touchend', handleTouchEndBackstop, { capture: true, passive: true });
    on(document, 'touchcancel', handleTouchEndBackstop, { capture: true, passive: true });
    on(window, 'blur', abandonPointerInteraction);
    on(document, 'visibilitychange', () => {
        if (document.hidden) {
            abandonPointerInteraction();
        }
    });
    on(document, 'contextmenu', handleContextMenuGuard, { capture: true });
    on(document, 'pointermove', handleHoverHint, { passive: true });
    on(document, 'input', handleTypingInput, { capture: true, passive: true });
    on(root, 'keydown', handlePetKeydown);

    return { root, canvas, bubble, hint };
}

/**
 * Xiaoyugao's root is pointer-events: none, so the browser never reports her as
 * the element under a point. Switch that on for one synchronous hit test to
 * learn whether anything (a drawer, a popup, a settings panel) is stacked
 * above her there. If it is, the tap belongs to that element, not to her.
 */
function xiaoyugaoIsTopmostAt(clientX, clientY) {
    if (typeof document.elementFromPoint !== 'function') {
        return true;
    }

    const root = ui.root;
    const previous = root.style.pointerEvents;
    root.style.pointerEvents = 'auto';
    let topmost;
    try {
        topmost = document.elementFromPoint(clientX, clientY);
    } catch {
        topmost = null;
    } finally {
        root.style.pointerEvents = previous;
    }

    // Outside the viewport (or hit-testing unavailable): fall back to pixels.
    return !topmost || topmost === root || root.contains(topmost);
}

function hitsXiaoyugao(clientX, clientY, pointerType = 'mouse') {
    if (!ui?.root || !renderer?.ctx || !settings?.enabled) {
        return false;
    }

    const rect = ui.root.getBoundingClientRect();
    if (
        clientX < rect.left
        || clientX > rect.right
        || clientY < rect.top
        || clientY > rect.bottom
        || rect.width <= 0
    ) {
        return false;
    }

    if (!xiaoyugaoIsTopmostAt(clientX, clientY)) {
        return false;
    }

    const radius = pointerType === 'mouse' ? HIT_RADIUS_MOUSE : HIT_RADIUS_TOUCH;
    const toCanvas = ui.canvas.width / rect.width;
    const centerX = (clientX - rect.left) * toCanvas;
    const centerY = (clientY - rect.top) * toCanvas;
    const sampleRadius = Math.max(1, Math.round(radius * toCanvas));
    const x = clamp(Math.round(centerX - sampleRadius), 0, ui.canvas.width - 1);
    const y = clamp(Math.round(centerY - sampleRadius), 0, ui.canvas.height - 1);
    const width = Math.min(ui.canvas.width - x, sampleRadius * 2 + 1);
    const height = Math.min(ui.canvas.height - y, sampleRadius * 2 + 1);

    try {
        const pixels = renderer.ctx.getImageData(x, y, width, height).data;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] > HIT_ALPHA) {
                return true;
            }
        }
    } catch (error) {
        console.warn('[Xiaoyugao Pet] Pixel hit test failed; using the pet box.', error);
        return true;
    }

    return false;
}

function handleTouchStartGuard(event) {
    if (!drag.active) {
        return;
    }

    event.stopImmediatePropagation();
    event.preventDefault();
}

function handleTouchEndBackstop(event) {
    // Pointer events normally end the press. If the browser dropped that
    // pointerup, the last finger leaving the screen still releases Xiaoyugao.
    if (drag.active && event.touches.length === 0) {
        abandonPointerInteraction();
    }
}

function abandonPointerInteraction() {
    if (!drag.active) {
        return;
    }

    const wasDragged = drag.moved;
    const wasLongPress = drag.longPress;
    finishPointerInteraction();
    if (wasDragged) {
        rememberCurrentPosition();
    }
    if (wasDragged || wasLongPress) {
        returnToAmbient();
    }
}

function handleHoverHint(event) {
    if (event.pointerType !== 'mouse' || drag.active) {
        return;
    }

    window.cancelAnimationFrame(hoverFrame);
    hoverFrame = window.requestAnimationFrame(() => {
        ui?.root.classList.toggle('is-hover', hitsXiaoyugao(event.clientX, event.clientY, 'mouse'));
    });
}

function armClickGuard(event) {
    clickGuard = {
        x: event.clientX,
        y: event.clientY,
        expiresAt: performance.now() + CLICK_GUARD_DURATION,
    };
}

function handleClickGuard(event) {
    if (!clickGuard) {
        return;
    }

    const isFresh = performance.now() <= clickGuard.expiresAt;
    const isNearby = Math.hypot(event.clientX - clickGuard.x, event.clientY - clickGuard.y) <= CLICK_GUARD_RADIUS;
    clickGuard = undefined;

    if (isFresh && isNearby) {
        event.stopImmediatePropagation();
        event.preventDefault();
    }
}

async function createSettingsUi() {
    if (document.getElementById('xiaoyugao-settings')) {
        return;
    }

    const settingsHost = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!settingsHost) {
        console.warn('[Xiaoyugao Pet] Could not find the extensions settings panel.');
        return;
    }

    let html;
    try {
        const extensionName = inferExtensionName();
        html = await context.renderExtensionTemplateAsync(extensionName, 'settings');
    } catch (error) {
        console.warn('[Xiaoyugao Pet] Template renderer failed; using direct template fetch.', error);
        const response = await fetch(new URL('./settings.html', import.meta.url));
        if (!response.ok) {
            throw new Error(`Unable to load settings.html (${response.status})`);
        }
        html = await response.text();
    }

    settingsHost.insertAdjacentHTML('beforeend', html);
    bindSettingsControls();
    syncSettingsControls();
    bindSettingsPreviewLayer();
}

function settingsPanelIsVisible() {
    const panel = document.getElementById('xiaoyugao-settings');
    const content = panel?.querySelector('.inline-drawer-content');
    if (!content) {
        return false;
    }

    const styles = window.getComputedStyle(content);
    const rect = content.getBoundingClientRect();
    const viewport = viewportBox();
    const viewportRight = viewport.left + viewport.width;
    const viewportBottom = viewport.top + viewport.height;
    const intersectsViewport = (
        rect.right > viewport.left
        && rect.left < viewportRight
        && rect.bottom > viewport.top
        && rect.top < viewportBottom
    );

    return (
        styles.display !== 'none'
        && styles.visibility !== 'hidden'
        && styles.opacity !== '0'
        && rect.width > 1
        && rect.height > 1
        && intersectsViewport
    );
}

function syncSettingsPreviewLayer() {
    const isPreviewing = settingsPanelIsVisible();
    ui?.root?.classList.toggle('is-settings-preview', isPreviewing);
    renderer?.setSettingsPreviewMode(isPreviewing);
}

function scheduleSettingsPreviewLayer() {
    window.cancelAnimationFrame(settingsLayerFrame);
    window.clearTimeout(settingsLayerTimer);
    settingsLayerFrame = window.requestAnimationFrame(syncSettingsPreviewLayer);
    settingsLayerTimer = window.setTimeout(syncSettingsPreviewLayer, 320);
}

function bindSettingsPreviewLayer() {
    on(document, 'click', scheduleSettingsPreviewLayer, { capture: true });
    on(document, 'keydown', scheduleSettingsPreviewLayer, { capture: true });
    on(document, 'scroll', scheduleSettingsPreviewLayer, { capture: true, passive: true });
    scheduleSettingsPreviewLayer();
}

function bindSettingsControls() {
    const sceneSelect = document.getElementById('xiaoyugao-bubble-scene');
    const editor = document.getElementById('xiaoyugao-bubble-lines');
    if (sceneSelect && editor) {
        for (const [key, scene] of Object.entries(SCENES)) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = scene.label;
            sceneSelect.append(option);
        }
        const scope = document.getElementById('xiaoyugao-bubble-scope');
        const scopeLabel = document.getElementById('xiaoyugao-bubble-scope-label');
        const reset = document.getElementById('xiaoyugao-bubble-reset');
        const target = (create = false) => {
            const card = currentCard(SillyTavern.getContext());
            if (scope.value !== 'card' || !card) return settings.customBubbles;
            if (create && !settings.cardBubbles[card.key]) settings.cardBubbles[card.key] = {};
            return settings.cardBubbles[card.key] ?? {};
        };
        refreshBubbleEditor = () => {
            const card = currentCard(SillyTavern.getContext());
            scope.options[1].disabled = !card;
            if (!card) scope.value = 'general';
            scopeLabel.textContent = card ? `当前角色：${card.name}` : '未选择单人角色卡；群聊使用通用台词。';
            const specific = scope.value === 'card';
            editor.value = specific ? target()[sceneSelect.value] ?? '' : sceneLines(settings.customBubbles, sceneSelect.value).join('\n');
            editor.placeholder = specific ? `留空继承通用台词：\n${sceneLines(settings.customBubbles, sceneSelect.value).join('\n')}` : '写下你想听小鱼糕说的话';
            reset.textContent = specific ? '恢复此场景通用台词' : '恢复此场景默认';
        };
        refreshBubbleEditor();
        on(sceneSelect, 'change', refreshBubbleEditor);
        on(scope, 'change', refreshBubbleEditor);
        on(editor, 'input', () => {
            target(true)[sceneSelect.value] = editor.value.slice(0, 7500);
            saveSettings();
        });
        on(reset, 'click', () => {
            delete target()[sceneSelect.value];
            refreshBubbleEditor();
            saveSettings();
        });
        on(document.getElementById('xiaoyugao-bubble-preview'), 'click', () => {
            reportUntil = 0;
            showBubble(companion.say(sceneSelect.value, scope.value === 'card' ? 'current' : 'general'), 5000, true);
        });
        on(document.getElementById('xiaoyugao-report'), 'click', showCompanionReport);
    }

    const mode = document.getElementById('xiaoyugao-companion-mode');
    if (mode) {
        mode.value = settings.companionMode;
        on(mode, 'change', () => {
            settings.companionMode = mode.value === 'quiet' ? 'quiet' : 'daily';
            reportUntil = 0;
            hideBubble();
            nextAmbientBubbleAt = 0;
            saveSettings();
        });
    }
    const enabled = document.getElementById('xiaoyugao-enabled');
    const scale = document.getElementById('xiaoyugao-scale');
    const opacity = document.getElementById('xiaoyugao-opacity');
    const reducedMotion = document.getElementById('xiaoyugao-reduced-motion');
    const showBubble = document.getElementById('xiaoyugao-show-bubble');
    const autoSwim = document.getElementById('xiaoyugao-auto-swim');
    const resetPosition = document.getElementById('xiaoyugao-reset-position');
    const previewSwim = document.getElementById('xiaoyugao-preview-swim');

    if (enabled) {
        on(enabled, 'change', (event) => {
            settings.enabled = event.currentTarget.checked;
            applyVisualSettings();
            saveSettings();
        });
    }

    if (scale) {
        on(scale, 'input', (event) => {
            settings.scale = clamp(Number(event.currentTarget.value), 40, 150);
            applyVisualSettings({ reposition: true });
            syncSettingsControls();
            saveSettings();
        });
    }

    if (opacity) {
        on(opacity, 'input', (event) => {
            settings.opacity = clamp(Number(event.currentTarget.value), 40, 100);
            applyVisualSettings();
            syncSettingsControls();
            saveSettings();
        });
    }

    if (reducedMotion) {
        on(reducedMotion, 'change', (event) => {
            settings.reducedMotion = event.currentTarget.checked;
            renderer?.setReducedMotion(settings.reducedMotion);
            if (settings.reducedMotion) {
                clearAutoSwimTimer();
                cancelAutoSwim();
            } else {
                scheduleAutoSwim();
            }
            saveSettings();
        });
    }

    if (showBubble) {
        on(showBubble, 'change', (event) => {
            settings.showBubble = event.currentTarget.checked;
            if (!settings.showBubble) {
                reportUntil = 0;
                hideBubble();
            } else if (isGenerating) {
                showBubble('奶盖宝宝正在想哦…', 0);
            }
            saveSettings();
        });
    }

    if (autoSwim) {
        on(autoSwim, 'change', (event) => {
            settings.autoSwim = event.currentTarget.checked;
            if (settings.autoSwim) {
                scheduleAutoSwim();
            } else {
                clearAutoSwimTimer();
                cancelAutoSwim();
            }
            saveSettings();
        });
    }

    if (resetPosition) {
        on(resetPosition, 'click', () => {
            settings.position = { ...DEFAULT_SETTINGS.position };
            applyStoredPosition();
            transitionTo(PET_STATES.WAVE, {
                duration: 1500,
                bubble: '小鱼糕游回右下角啦～',
                manual: true,
                priority: 30,
                force: true,
            });
            saveSettings();
        });
    }

    if (previewSwim) {
        on(previewSwim, 'click', () => {
            startAutoSwim(0, 2700, { announce: true });
        });
    }

    document.querySelectorAll('[data-xiaoyugao-preview]').forEach((button) => {
        on(button, 'click', () => {
            const state = button.dataset.xiaoyugaoPreview;
            if (!Object.values(PET_STATES).includes(state)) {
                return;
            }

            transitionTo(state, {
                duration: state === PET_STATES.NUZZLING ? NUZZLE_DURATION_MS : state === PET_STATES.SLEEPING ? 3000 : 1800,
                bubble: previewBubbleFor(state),
                manual: true,
                priority: 35,
                force: true,
            });
        });
    });
}

function syncSettingsControls() {
    const enabled = document.getElementById('xiaoyugao-enabled');
    const scale = document.getElementById('xiaoyugao-scale');
    const scaleValue = document.getElementById('xiaoyugao-scale-value');
    const opacity = document.getElementById('xiaoyugao-opacity');
    const opacityValue = document.getElementById('xiaoyugao-opacity-value');
    const reducedMotion = document.getElementById('xiaoyugao-reduced-motion');
    const showBubble = document.getElementById('xiaoyugao-show-bubble');
    const autoSwim = document.getElementById('xiaoyugao-auto-swim');

    if (enabled) enabled.checked = Boolean(settings.enabled);
    if (scale) scale.value = String(settings.scale);
    if (scaleValue) scaleValue.textContent = `${settings.scale}%`;
    if (opacity) opacity.value = String(settings.opacity);
    if (opacityValue) opacityValue.textContent = `${settings.opacity}%`;
    if (reducedMotion) reducedMotion.checked = Boolean(settings.reducedMotion);
    if (showBubble) showBubble.checked = Boolean(settings.showBubble);
    if (autoSwim) autoSwim.checked = Boolean(settings.autoSwim);
}

function previewBubbleFor(state) {
    const bubbles = {
        [PET_STATES.IDLE]: '陪妈妈待一会儿～',
        [PET_STATES.LISTENING]: '妈妈说，小鱼糕听着呢',
        [PET_STATES.THINKING]: '奶盖宝宝正在想哦…',
        [PET_STATES.HAPPY]: '回信游回来啦！',
        [PET_STATES.CONFUSED]: '咦，泡泡走丢了吗？',
        [PET_STATES.PETTING]: '妈妈再摸摸～',
        [PET_STATES.NUZZLING]: '贴贴妈妈，再蹭一下～',
        [PET_STATES.SLEEPING]: '小鱼糕困嘟嘟…',
        [PET_STATES.WAVE]: '妈妈回来啦！贴贴～',
    };
    return bubbles[state] ?? '';
}

function applyVisualSettings({ reposition = false } = {}) {
    if (!ui?.root) {
        return;
    }

    ui.root.classList.toggle('is-disabled', !settings.enabled);
    if (settings.enabled) {
        renderer?.start();
        if (renderer?.state === PET_STATES.IDLE) {
            scheduleAutoLie();
            scheduleAutoSwim();
        }
    } else {
        reportUntil = 0;
        renderer?.stop();
        clearPoseTimer();
        cancelAutoSwim({ settle: false });
        clearAutoSwimTimer();
        hideBubble();
        window.clearTimeout(reactionTimer);
    }
    ui.root.style.setProperty('--xiaoyugao-scale', String(settings.scale / 100));
    ui.root.style.setProperty('--xiaoyugao-opacity', String(settings.opacity / 100));
    renderer?.setReducedMotion(settings.reducedMotion);
    scheduleSettingsPreviewLayer();

    if (reposition) {
        window.cancelAnimationFrame(positionFrame);
        positionFrame = window.requestAnimationFrame(applyStoredPosition);
    }
}

function viewportBox() {
    const visualViewport = window.visualViewport;
    if (visualViewport) {
        return {
            left: visualViewport.offsetLeft,
            top: visualViewport.offsetTop,
            width: visualViewport.width,
            height: visualViewport.height,
        };
    }

    return {
        left: 0,
        top: 0,
        width: document.documentElement.clientWidth || window.innerWidth,
        height: document.documentElement.clientHeight || window.innerHeight,
    };
}

function movementBounds() {
    const viewport = viewportBox();
    const rect = ui.root.getBoundingClientRect();
    const styles = window.getComputedStyle(ui.root);
    const safeTop = Number.parseFloat(styles.getPropertyValue('--xiaoyugao-safe-top')) || 0;
    const safeRight = Number.parseFloat(styles.getPropertyValue('--xiaoyugao-safe-right')) || 0;
    const safeBottom = Number.parseFloat(styles.getPropertyValue('--xiaoyugao-safe-bottom')) || 0;
    const safeLeft = Number.parseFloat(styles.getPropertyValue('--xiaoyugao-safe-left')) || 0;
    const minimumLeft = viewport.left + POSITION_MARGIN + safeLeft;
    const minimumTop = viewport.top + POSITION_MARGIN + safeTop;
    const maximumLeft = Math.max(
        minimumLeft,
        viewport.left + viewport.width - rect.width - POSITION_MARGIN - safeRight,
    );
    const maximumTop = Math.max(
        minimumTop,
        viewport.top + viewport.height - rect.height - POSITION_MARGIN - safeBottom,
    );

    return {
        minimumLeft,
        minimumTop,
        maximumLeft,
        maximumTop,
    };
}

function setPixelPosition(left, top) {
    const bounds = movementBounds();
    ui.root.style.left = `${clamp(left, bounds.minimumLeft, bounds.maximumLeft)}px`;
    ui.root.style.top = `${clamp(top, bounds.minimumTop, bounds.maximumTop)}px`;
    if (ui.bubble.classList.contains('is-visible')) positionBubble();
}

function applyStoredPosition() {
    if (!ui?.root) {
        return;
    }

    const bounds = movementBounds();
    const horizontalRange = Math.max(0, bounds.maximumLeft - bounds.minimumLeft);
    const verticalRange = Math.max(0, bounds.maximumTop - bounds.minimumTop);
    const left = bounds.minimumLeft + horizontalRange * clamp(settings.position.x, 0, 1);
    const top = bounds.minimumTop + verticalRange * clamp(settings.position.y, 0, 1);
    setPixelPosition(left, top);
}

function rememberCurrentPosition() {
    const bounds = movementBounds();
    const rect = ui.root.getBoundingClientRect();
    const horizontalRange = Math.max(1, bounds.maximumLeft - bounds.minimumLeft);
    const verticalRange = Math.max(1, bounds.maximumTop - bounds.minimumTop);

    settings.position = {
        x: clamp((rect.left - bounds.minimumLeft) / horizontalRange, 0, 1),
        y: clamp((rect.top - bounds.minimumTop) / verticalRange, 0, 1),
    };
    saveSettings();
}

function handlePointerDown(event) {
    // A deliberate new pointer action must never inherit an old synthetic-click guard.
    clickGuard = undefined;
    if (event.button !== undefined && event.button !== 0) {
        return;
    }
    if (
        drag.active
        || !event.isPrimary
        || !hitsXiaoyugao(event.clientX, event.clientY, event.pointerType || 'mouse')
    ) {
        return;
    }

    event.stopImmediatePropagation();
    wakeXiaoyugao();
    const rect = ui.root.getBoundingClientRect();
    drag.active = true;
    drag.moved = false;
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.startLeft = rect.left;
    drag.startTop = rect.top;
    drag.longPress = false;
    ui.root.classList.add('is-pressed');
    scheduleLongPress();
    armStalePressTimer();
    armClickGuard(event);
    event.preventDefault();
}

function handlePointerMove(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
        drag.moved = true;
        clearLongPressTimer();
        ui.root.classList.add('is-dragging');
        transitionTo(PET_STATES.LISTENING, {
            bubble: '妈妈要把我抱去哪呀？',
            manual: true,
            priority: 45,
            force: true,
        });
    }

    if (drag.moved) {
        setPixelPosition(drag.startLeft + deltaX, drag.startTop + deltaY);
    }
    armStalePressTimer();

    event.stopImmediatePropagation();
    event.preventDefault();
}

function handlePointerUp(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
    }

    event.stopImmediatePropagation();
    event.preventDefault();
    armClickGuard(event);
    const wasDragged = drag.moved;
    const wasLongPress = drag.longPress;
    const tapX = event.clientX;
    const tapY = event.clientY;
    finishPointerInteraction();

    if (wasDragged) {
        rememberCurrentPosition();
        transitionTo(PET_STATES.WAVE, {
            duration: 1100,
            bubble: '这里离妈妈近～',
            manual: true,
            priority: 35,
            force: true,
        });
    } else if (wasLongPress) {
        returnToAmbient();
    } else {
        registerTap(tapX, tapY);
    }
}

function handlePointerCancel(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) {
        return;
    }

    event.stopImmediatePropagation();
    event.preventDefault();
    armClickGuard(event);
    const wasDragged = drag.moved;
    const wasLongPress = drag.longPress;
    finishPointerInteraction();
    if (wasDragged) {
        rememberCurrentPosition();
    }
    if (wasDragged || wasLongPress) {
        returnToAmbient();
    }
}

function armStalePressTimer() {
    window.clearTimeout(stalePressTimer);
    stalePressTimer = window.setTimeout(abandonPointerInteraction, STALE_PRESS_TIMEOUT);
}

function finishPointerInteraction() {
    window.clearTimeout(stalePressTimer);
    stalePressTimer = undefined;
    clearLongPressTimer();
    ui.root.classList.remove('is-pressed', 'is-dragging');
    drag.active = false;
    drag.moved = false;
    drag.pointerId = null;
    drag.longPress = false;
}

function clearLongPressTimer() {
    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
}

function scheduleLongPress() {
    clearLongPressTimer();
    longPressTimer = window.setTimeout(() => {
        longPressTimer = undefined;
        if (!drag.active || drag.moved) {
            return;
        }

        drag.longPress = true;
        transitionTo(PET_STATES.PETTING, {
            duration: 1800,
            priority: 55,
            force: true,
        });
        showCompanionReport();
    }, LONG_PRESS_DURATION);
}

function clearPendingTap() {
    window.clearTimeout(pendingTap?.timer);
    pendingTap = undefined;
}

function registerTap(clientX, clientY) {
    const now = Date.now();
    if (
        pendingTap
        && now - pendingTap.time <= DOUBLE_TAP_WINDOW
        && Math.hypot(clientX - pendingTap.x, clientY - pendingTap.y) <= DOUBLE_TAP_RADIUS
    ) {
        clearPendingTap();
        doublePetXiaoyugao();
        return;
    }

    clearPendingTap();
    const tap = { time: now, x: clientX, y: clientY, timer: undefined };
    tap.timer = window.setTimeout(() => {
        if (pendingTap === tap) {
            pendingTap = undefined;
            petXiaoyugao();
        }
    }, DOUBLE_TAP_WINDOW);
    pendingTap = tap;
}

function doublePetXiaoyugao() {
    transitionTo(PET_STATES.NUZZLING, {
        duration: NUZZLE_DURATION_MS,
        bubble: '贴贴妈妈，再蹭一下～',
        manual: true,
        priority: 48,
        force: true,
    });
}

function handleContextMenuGuard(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return;
    }
    if (!drag.active && !hitsXiaoyugao(event.clientX, event.clientY, 'touch')) {
        return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
}

function isSendTextarea(target) {
    return target?.id === 'send_textarea' || target?.matches?.('#send_textarea');
}

function clearTypingAttention({ restore = false } = {}) {
    window.clearTimeout(typingIdleTimer);
    typingIdleTimer = undefined;
    const wasActive = typingAttentionActive;
    typingAttentionActive = false;
    if (restore && wasActive && !isGenerating && !drag.active) {
        returnToAmbient();
    }
}

function handleTypingInput(event) {
    if (!isSendTextarea(event.target)) {
        return;
    }

    const hasText = String(event.target.value ?? '').trim().length > 0;
    if (!hasText) {
        clearTypingAttention({ restore: true });
        return;
    }
    if (isGenerating || drag.longPress) {
        return;
    }

    const firstKeystroke = !typingAttentionActive;
    typingAttentionActive = true;
    window.clearTimeout(typingIdleTimer);
    if (firstKeystroke || renderer?.state !== PET_STATES.LISTENING) {
        transitionTo(PET_STATES.LISTENING, {
            priority: 22,
            force: true,
        });
    }
    if (firstKeystroke) {
        showBubble('妈妈写字，小鱼糕认真看～', 1400);
    }
    typingIdleTimer = window.setTimeout(() => {
        typingIdleTimer = undefined;
        typingAttentionActive = false;
        if (!isGenerating && !drag.active) {
            returnToAmbient();
        }
    }, TYPING_IDLE_DELAY);
}

function handlePetKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    event.preventDefault();
    if (event.shiftKey) showCompanionReport();
    else petXiaoyugao();
}

function petXiaoyugao() {
    transitionTo(PET_STATES.PETTING, {
        duration: 1900,
        bubble: '妈妈再摸摸～',
        manual: true,
        priority: 40,
        force: true,
    });
}

function clearPoseTimer() {
    window.clearTimeout(poseTimer);
    poseTimer = undefined;
}

function clearAutoSwimTimer() {
    window.clearTimeout(roamTimer);
    roamTimer = undefined;
}

function cancelAutoSwim({ settle = true, remember = true } = {}) {
    window.cancelAnimationFrame(roamFrame);
    roamFrame = undefined;
    const wasSwimming = Boolean(roamRun);
    roamRun = undefined;
    if (wasSwimming && remember && ui?.root && settings) {
        rememberCurrentPosition();
    }
    if (wasSwimming && settle) {
        renderer?.setForm('sitting');
    }
}

function wakeXiaoyugao() {
    clearPoseTimer();
    clearAutoSwimTimer();
    cancelAutoSwim({ settle: false });
    renderer?.setForm('sitting');
}

function scheduleAutoLie() {
    clearPoseTimer();
    if (isGenerating || typingAttentionActive || drag.active || !settings?.enabled) {
        return;
    }
    poseTimer = window.setTimeout(() => {
        poseTimer = undefined;
        if (isGenerating || typingAttentionActive || drag.active || renderer?.state !== PET_STATES.IDLE) {
            return;
        }
        renderer.setForm('lying');
        showBubble('陪妈妈待一会儿～', 1600);
    }, AUTO_LIE_DELAY);
}

function scheduleAutoSwim() {
    clearAutoSwimTimer();
    if (
        isGenerating
        || typingAttentionActive
        || drag.active
        || roamRun
        || !settings?.enabled
        || !settings.autoSwim
        || settings.reducedMotion
    ) {
        return;
    }
    const delay = AUTO_SWIM_MIN_DELAY + Math.random() * AUTO_SWIM_JITTER;
    roamTimer = window.setTimeout(() => {
        roamTimer = undefined;
        startAutoSwim();
    }, delay);
}

function chooseSwimTarget(preferredDirection = 0) {
    const bounds = movementBounds();
    const rect = ui.root.getBoundingClientRect();
    const startLeft = clamp(
        finiteNumber(Number.parseFloat(ui.root.style.left), rect.left),
        bounds.minimumLeft,
        bounds.maximumLeft,
    );
    const startTop = clamp(
        finiteNumber(Number.parseFloat(ui.root.style.top), rect.top),
        bounds.minimumTop,
        bounds.maximumTop,
    );
    const roomLeft = startLeft - bounds.minimumLeft;
    const roomRight = bounds.maximumLeft - startLeft;
    let direction = Math.sign(preferredDirection);

    if (!direction) {
        if (roomLeft < SWIM_MIN_DISTANCE && roomRight < SWIM_MIN_DISTANCE) {
            direction = roomRight >= roomLeft ? 1 : -1;
        } else if (roomLeft < SWIM_MIN_DISTANCE) {
            direction = 1;
        } else if (roomRight < SWIM_MIN_DISTANCE) {
            direction = -1;
        } else {
            direction = Math.random() < 0.5 ? -1 : 1;
        }
    }
    if (direction < 0 && roomLeft < Math.min(SWIM_MIN_DISTANCE, roomRight)) {
        direction = 1;
    } else if (direction > 0 && roomRight < Math.min(SWIM_MIN_DISTANCE, roomLeft)) {
        direction = -1;
    }

    const available = direction < 0 ? roomLeft : roomRight;
    const requested = SWIM_MIN_DISTANCE + Math.random() * (SWIM_MAX_DISTANCE - SWIM_MIN_DISTANCE);
    const distance = Math.min(requested, available);
    return {
        startLeft,
        startTop,
        targetLeft: startLeft + direction * distance,
        direction,
        distance,
    };
}

function startAutoSwim(preferredDirection = 0, duration = SWIM_DURATION, { announce = false } = {}) {
    if (!ui?.root || !renderer || !settings?.enabled || isGenerating || typingAttentionActive || drag.active) {
        return false;
    }
    if (!announce && renderer.state !== PET_STATES.IDLE) {
        scheduleAutoSwim();
        return false;
    }

    clearPoseTimer();
    clearAutoSwimTimer();
    cancelAutoSwim({ settle: false });
    window.clearTimeout(reactionTimer);
    currentPriority = 0;
    priorityUntil = 0;
    const path = chooseSwimTarget(preferredDirection);
    if (path.distance < 8) {
        renderer.setForm('sitting');
        scheduleAutoLie();
        scheduleAutoSwim();
        return false;
    }

    const safeDuration = clamp(finiteNumber(duration, SWIM_DURATION), 600, 6000);
    // Keep the renderer's tail rhythm tied to the actual on-screen distance.
    const strideLength = getSwimStrideLength(ui.root.getBoundingClientRect().width);
    roamRun = { ...path, duration: safeDuration, strideLength, startedAt: undefined };
    renderer.setSwimDirection(path.direction);
    renderer.setSwimProgress(0, strideLength);
    renderer.setState(PET_STATES.IDLE);
    renderer.setForm('swimming');
    ui.root.setAttribute('aria-label', '小鱼糕正在游过来陪你');
    if (announce) {
        showBubble('小鱼糕游一圈陪妈妈～', 1300, false, true);
    }

    const step = (now) => {
        if (!roamRun) {
            return;
        }
        if (roamRun.startedAt === undefined) {
            roamRun.startedAt = now;
        }
        const progress = clamp((now - roamRun.startedAt) / roamRun.duration, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        const currentLeft = roamRun.startLeft + (roamRun.targetLeft - roamRun.startLeft) * eased;
        setPixelPosition(currentLeft, roamRun.startTop);
        renderer.setSwimProgress(Math.abs(currentLeft - roamRun.startLeft), roamRun.strideLength);
        if (progress < 1) {
            roamFrame = window.requestAnimationFrame(step);
            return;
        }

        roamFrame = undefined;
        roamRun = undefined;
        rememberCurrentPosition();
        renderer.setForm('sitting');
        renderer.setState(PET_STATES.IDLE);
        ui.root.setAttribute('aria-label', stateLabels[PET_STATES.IDLE]);
        if (announce) {
            showBubble('换个地方继续冒泡泡～', 1200, false, true);
        }
        scheduleAutoLie();
        scheduleAutoSwim();
    };
    roamFrame = window.requestAnimationFrame(step);
    return true;
}

function transitionTo(state, {
    duration = 0,
    bubble = '',
    priority = 0,
    force = false,
    manual = false,
} = {}) {
    if (!renderer || !Object.values(PET_STATES).includes(state)) {
        return;
    }

    if (state === PET_STATES.WAVE) duration = Math.max(duration, WAVE_DURATION_MS);

    const now = Date.now();
    if (!force && priority < currentPriority && now < priorityUntil) {
        return;
    }

    window.clearTimeout(reactionTimer);
    if (state === PET_STATES.THINKING) {
        clearPoseTimer();
        renderer.setForm('sitting');
    } else if (state === PET_STATES.SLEEPING) {
        clearPoseTimer();
        renderer.setForm('lying');
    } else {
        wakeXiaoyugao();
    }
    currentPriority = priority;
    priorityUntil = duration > 0 ? now + duration : Number.POSITIVE_INFINITY;
    renderer.setState(state);
    ui.root.setAttribute('aria-label', stateLabels[state] ?? stateLabels[PET_STATES.IDLE]);

    if (bubble) {
        showBubble(bubble, Math.min(Math.max(duration || 1600, 1000), 2200), false, manual);
    }

    if (duration > 0) {
        reactionTimer = window.setTimeout(returnToAmbient, duration);
    }
}

function returnToAmbient() {
    window.clearTimeout(reactionTimer);
    currentPriority = 0;
    priorityUntil = 0;

    const ambientState = isGenerating ? PET_STATES.THINKING : PET_STATES.IDLE;
    if (isGenerating) {
        renderer?.setForm('sitting');
    }
    renderer?.setState(ambientState);
    ui?.root.setAttribute('aria-label', stateLabels[ambientState]);

    if (isGenerating) {
        showBubble(thinkingCompanionMessage, 0);
    } else {
        if (!bubbleTimer) hideBubble();
        scheduleAutoLie();
        scheduleAutoSwim();
    }
}

const bubbleScenes = {
    '鱼仔妈妈，我来啦～': 'greeting', '妈妈回来啦！贴贴～': 'greeting', '小鱼糕游回右下角啦～': 'greeting',
    '妈妈写字，小鱼糕认真看～': 'typing', '陪妈妈待一会儿～': 'idle', '妈妈说，小鱼糕听着呢': 'listening',
    '奶盖宝宝正在想哦…': 'thinking', '这次要多捞一会儿灵感泡泡哦～': 'thinking', '还在认真想呢…': 'thinking',
    '回信游回来啦！': 'reply', '好耶，奶盖宝宝回话啦！': 'reply', '妈妈去哪我去哪～': 'chat',
    '妈妈再摸摸～': 'petting', '贴贴妈妈，再蹭一下～': 'nuzzling',
    '妈妈要把我抱去哪呀？': 'dragging', '这里离妈妈近～': 'placed',
    '小鱼糕游一圈陪妈妈～': 'swimming', '换个地方继续冒泡泡～': 'swimming',
    '小鱼糕困嘟嘟…': 'sleeping', '咦，泡泡走丢了吗？': 'confused', '奶盖宝宝先歇一会儿？': 'stopped',
    '帮妈妈想想怎么说～': 'impersonating', '帮妈妈写好啦～': 'impersonated',
};

function bubbleViewportBox(pet) {
    const viewport = viewportBox();
    // Keyboard panning can shift Safari's client rect origin relative to the
    // fixed-position CSS coordinates. Measure that origin on the pet itself
    // so the viewport and pet use the same coordinate space (no UA guessing).
    const cssLeft = Number.parseFloat(ui.root.style.left);
    const cssTop = Number.parseFloat(ui.root.style.top);
    return {
        ...viewport,
        left: viewport.left + (Number.isFinite(cssLeft) ? pet.left - cssLeft : 0),
        top: viewport.top + (Number.isFinite(cssTop) ? pet.top - cssTop : 0),
    };
}

function followVisibleBubble() {
    window.clearTimeout(bubbleFollowTimer);
    bubbleFollowTimer = undefined;
    if (!ui?.bubble.classList.contains('is-visible')) return;
    bubbleFollowTimer = window.setTimeout(() => {
        bubbleFollowTimer = undefined;
        if (!document.hidden) positionBubble();
        followVisibleBubble();
    }, 100);
}

function positionBubble() {
    if (!ui?.bubble) return;
    const pet = ui.root.getBoundingClientRect();
    const viewport = bubbleViewportBox(pet);
    const margin = 8;
    const gap = 10;
    const leftEdge = viewport.left + margin;
    const rightEdge = viewport.left + viewport.width - margin;
    const topEdge = viewport.top + margin;
    const bottomEdge = viewport.top + viewport.height - margin;
    const speech = ui.bubble;
    speech.style.maxWidth = `${Math.min(260, Math.max(1, viewport.width - margin * 2))}px`;
    let width = speech.offsetWidth;
    let height = speech.offsetHeight;
    const headX = pet.left + pet.width / 2;
    const headY = pet.top + pet.height * 0.13;
    let placement = 'above';
    let left = headX - width / 2;
    let top = headY - height - gap;

    if (top < topEdge) {
        // At the top edge, move beside Xiaoyugao rather than over her belly.
        const leftRoom = pet.left - gap - leftEdge;
        const rightRoom = rightEdge - pet.left - pet.width - gap;
        if (Math.max(leftRoom, rightRoom) >= 100) {
            placement = leftRoom >= rightRoom ? 'left' : 'right';
            speech.style.maxWidth = `${Math.min(260, placement === 'left' ? leftRoom : rightRoom)}px`;
            width = speech.offsetWidth;
            height = speech.offsetHeight;
            left = placement === 'left' ? pet.left - gap - width : pet.left + pet.width + gap;
            top = headY - height / 2;
        } else {
            placement = 'below';
            top = pet.top + pet.height + gap;
        }
    }
    left = clamp(left, leftEdge, Math.max(leftEdge, rightEdge - width));
    top = clamp(top, topEdge, Math.max(topEdge, bottomEdge - height));
    speech.style.left = `${left - pet.left}px`;
    speech.style.top = `${top - pet.top}px`;
    speech.dataset.placement = placement;
    // Keep the tail pointing towards Xiaoyugao after viewport-edge clamping.
    speech.style.setProperty('--xiaoyugao-tail-x', `${clamp(headX - left - 5, 12, Math.max(12, width - 23))}px`);
    speech.style.setProperty('--xiaoyugao-tail-y', `${clamp(headY - top - 5, 12, Math.max(12, height - 23))}px`);
}

function showCompanionReport() {
    if (!settings?.enabled) return;
    reportUntil = 0;
    showBubble(companion.say('report'), REPORT_BUBBLE_DURATION, true);
    reportUntil = Date.now() + REPORT_BUBBLE_DURATION;
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => {
        reportUntil = 0;
        hideBubble();
        if (isGenerating) showBubble(thinkingCompanionMessage, 0);
    }, REPORT_BUBBLE_DURATION);
}

function showBubble(message, duration = 1500, literal = false, manual = literal) {
    if (Date.now() < reportUntil) return;
    if (!manual && (settings?.companionMode === 'quiet' || Date.now() < nextAmbientBubbleAt)) return;
    if (!literal && companion && bubbleScenes[message]) message = companion.say(bubbleScenes[message]);
    if (!ui?.bubble || !settings?.enabled || !settings.showBubble || !message) {
        return;
    }

    nextAmbientBubbleAt = Date.now() + AMBIENT_BUBBLE_INTERVAL;
    // Waiting still animates, but its bubble no longer occupies the page indefinitely.
    if (!manual) duration = Math.min(duration > 0 ? duration : 5000, 5000);
    window.clearTimeout(bubbleTimer);
    bubbleTimer = undefined;
    ui.bubble.textContent = message;
    ui.bubble.classList.add('is-visible');
    positionBubble();
    followVisibleBubble();
    if (Number.isFinite(duration) && duration > 0) {
        bubbleTimer = window.setTimeout(hideBubble, Math.min(5000, Math.max(duration, message.length * 100)));
    }
}

function hideBubble() {
    if (Date.now() < reportUntil) return;
    window.clearTimeout(bubbleTimer);
    bubbleTimer = undefined;
    ui?.bubble.classList.remove('is-visible');
    window.clearTimeout(bubbleFollowTimer);
    bubbleFollowTimer = undefined;
}

function listen(eventName, handler) {
    const source = coreApi?.eventSource ?? context.eventSource;
    const eventType = coreApi?.event_types?.[eventName] ?? context.event_types?.[eventName];
    if (!source || !eventType) {
        return;
    }

    onEventSource(source, eventType, handler);
}

async function loadSillyTavernCoreApi() {
    try {
        // Same stable public-module bridge used by the reference typing
        // indicator. Context remains the fallback for older layouts.
        return await import('../../../../script.js');
    } catch {
        return undefined;
    }
}

function clearGenerationWatchdog() {
    window.clearTimeout(generationWatchdog);
    generationWatchdog = undefined;
}

function clearGenerationEndTimer() {
    window.clearTimeout(generationEndTimer);
    generationEndTimer = undefined;
}

function armGenerationWatchdog() {
    clearGenerationWatchdog();
    generationWatchdog = window.setTimeout(() => {
        if (!isGenerating) {
            return;
        }

        // Give up waiting visibly, but keep listening: a reply that lands
        // after this still gets its happy welcome instead of being ignored.
        isGenerating = false;
        awaitingLateReply = true;
        clearThinkingCompanionTimers();
        setSignalStatus('等太久了，先回来陪你；回信到了照样迎接');
        transitionTo(PET_STATES.CONFUSED, {
            duration: 1700,
            bubble: '咦，泡泡走丢了吗？',
            priority: 30,
            force: true,
        });
    }, GENERATION_WATCHDOG_DELAY);
}

function clearThinkingCompanionTimers({ resetMessage = true } = {}) {
    window.clearTimeout(thinkingBubble20Timer);
    window.clearTimeout(thinkingBubble40Timer);
    thinkingBubble20Timer = undefined;
    thinkingBubble40Timer = undefined;
    if (resetMessage) {
        thinkingCompanionMessage = '奶盖宝宝正在想哦…';
    }
}

function scheduleThinkingCompanionBubbles() {
    clearThinkingCompanionTimers({ resetMessage: false });
    thinkingBubble20Timer = window.setTimeout(() => {
        thinkingBubble20Timer = undefined;
        if (!isGenerating) {
            return;
        }
        thinkingCompanionMessage = '这次要多捞一会儿灵感泡泡哦～';
        showBubble(thinkingCompanionMessage, 0);
    }, THINKING_COMPANION_DELAY);
    thinkingBubble40Timer = window.setTimeout(() => {
        thinkingBubble40Timer = undefined;
        if (!isGenerating) {
            return;
        }
        thinkingCompanionMessage = '还在认真想呢…';
        showBubble(thinkingCompanionMessage, 0);
    }, THINKING_COMPANION_DELAY * 2);
}

function setSignalStatus(message, source = '') {
    lastSignalStatus = message;
    const status = document.getElementById('xiaoyugao-signal-status');
    if (status) {
        status.textContent = `联动状态：${message}`;
    }
    if (ui?.root && source) {
        ui.root.dataset.signalSource = source;
    }
}

function beginThinking(source = 'event', message = '奶盖宝宝正在想哦…') {
    clearTypingAttention();
    clearPendingTap();
    wakeXiaoyugao();
    isGenerating = true;
    awaitingLateReply = false;
    setSignalStatus('已收到发送，正在等回信', typeof source === 'string' ? source : 'event');
    clearGenerationEndTimer();
    armGenerationWatchdog();

    transitionTo(PET_STATES.THINKING, {
        priority: 25,
        force: true,
    });
    // A typing indicator should remain visible for the entire generation,
    // not just for the first animation beat.
    thinkingCompanionMessage = message;
    showBubble(message, 0);
    scheduleThinkingCompanionBubbles();
}

function finishThinking(bubble = '回信游回来啦！') {
    clearGenerationEndTimer();
    clearGenerationWatchdog();
    clearThinkingCompanionTimers();
    isGenerating = false;
    awaitingLateReply = false;
    replyArrived = false;
    setSignalStatus('回复已到达');
    transitionTo(PET_STATES.HAPPY, {
        duration: 2100,
        bubble,
        priority: 35,
        force: true,
    });
}

function stopThinkingManually() {
    clearGenerationEndTimer();
    clearGenerationWatchdog();
    clearThinkingCompanionTimers();
    isGenerating = false;
    awaitingLateReply = false;
    setSignalStatus('生成已手动停止');
    transitionTo(PET_STATES.CONFUSED, {
        duration: 1700,
        bubble: '奶盖宝宝先歇一会儿？',
        priority: 35,
        force: true,
    });
}

/**
 * Canonical SillyTavern generation lifecycle (verified against release script.js):
 *   GENERATION_STARTED(type, args, dryRun)  -- also fires for dryRun and type==='quiet' (background
 *                                              generations from other extensions). Those NEVER emit
 *                                              MESSAGE_RECEIVED, so they must be ignored here.
 *   streaming:     hideStopButton() -> GENERATION_ENDED, then MESSAGE_RECEIVED, CHARACTER_MESSAGE_RENDERED
 *   non-streaming: MESSAGE_RECEIVED, CHARACTER_MESSAGE_RENDERED, ... then GENERATION_ENDED
 *   GENERATION_STOPPED on manual abort (GENERATION_ENDED follows).
 * So: GENERATION_ENDED is always the end. Whether it is "happy" or "confused" is decided
 * by whether a reply arrives within a short settle window around it.
 */
function bindSillyTavernEvents() {
    listen('MESSAGE_SENT', () => {
        clearTypingAttention();
        clearPendingTap();
        transitionTo(PET_STATES.LISTENING, { duration: 1200, bubble: '妈妈说，小鱼糕听着呢', priority: 25, force: true });
    });

    listen('GENERATION_STARTED', (type, _args, dryRun) => {
        if (settings.enabled) companion.start(type, dryRun);
        else companion.baseline();
        if (dryRun || type === 'quiet') {
            return; // token counting / background prompts from other extensions
        }
        replyArrived = false;
        currentGenerationType = String(type ?? '');
        clearGenerationEndTimer();
        // Impersonation writes into the textarea and never emits
        // MESSAGE_RECEIVED, so it gets its own wording and its own ending.
        beginThinking(
            `GENERATION_STARTED:${type}`,
            currentGenerationType === 'impersonate' ? '帮妈妈想想怎么说～' : '奶盖宝宝正在想哦…',
        );
    });

    listen('STREAM_TOKEN_RECEIVED', () => {
        renderer?.pulse();
        if (isGenerating) {
            armGenerationWatchdog();
        }
    });

    listen('MESSAGE_RECEIVED', (_messageId, type) => {
        if (settings.enabled) companion.receive(_messageId, type);
        if (type === 'quiet' || !isGenerating && !generationEndTimer && !awaitingLateReply) {
            return;
        }
        replyArrived = true;
        clearGenerationEndTimer();
        finishThinking();
    });

    listen('IMPERSONATE_READY', () => {
        if (!isGenerating && !generationEndTimer && !awaitingLateReply) {
            return;
        }
        replyArrived = true;
        clearGenerationEndTimer();
        finishThinking('帮妈妈写好啦～');
    });

    listen('GENERATION_STOPPED', () => {
        replyArrived = true; // suppress the "结束啦?" follow-up from GENERATION_ENDED
        clearGenerationEndTimer();
        stopThinkingManually();
    });

    listen('GENERATION_ENDED', () => {
        if (!isGenerating) {
            return;
        }
        clearGenerationWatchdog();
        clearThinkingCompanionTimers();
        isGenerating = false;
        if (replyArrived) {
            return; // non-streaming: HAPPY already played
        }
        if (currentGenerationType === 'impersonate') {
            // Older builds have no IMPERSONATE_READY; the end of the run is the result.
            finishThinking('帮妈妈写好啦～');
            return;
        }
        // streaming: MESSAGE_RECEIVED lands a few ms after this. Give it a beat.
        clearGenerationEndTimer();
        generationEndTimer = window.setTimeout(() => {
            generationEndTimer = undefined;
            if (replyArrived) {
                return;
            }
            setSignalStatus('生成结束但没有回信（报错？）', 'GENERATION_ENDED');
            transitionTo(PET_STATES.CONFUSED, { duration: 1700, bubble: '咦，泡泡走丢了吗？', priority: 30, force: true });
        }, 400);
    });

    listen('CHAT_CHANGED', () => {
        companion.baseline();
        refreshBubbleEditor?.();
        reportUntil = 0;
        hideBubble();
        clearTypingAttention();
        clearThinkingCompanionTimers();
        clearGenerationWatchdog();
        clearGenerationEndTimer();
        isGenerating = false;
        awaitingLateReply = false;
        currentGenerationType = '';
        setSignalStatus('已切换聊天，等待发送');
        transitionTo(PET_STATES.WAVE, { duration: 1700, bubble: '妈妈去哪我去哪～', priority: 30, force: true });
    });
}

function bindViewportEvents() {
    const scheduleReposition = () => {
        window.cancelAnimationFrame(positionFrame);
        positionFrame = window.requestAnimationFrame(applyStoredPosition);
        scheduleSettingsPreviewLayer();
    };

    on(window, 'resize', scheduleReposition, { passive: true });
    if (window.visualViewport) {
        on(window.visualViewport, 'resize', scheduleReposition, { passive: true });
        on(window.visualViewport, 'scroll', scheduleReposition, { passive: true });
    }
}

function bindCustomReactionEvent() {
    const react = (event) => {
        const state = event.detail?.state;
        if (!Object.values(PET_STATES).includes(state)) {
            return;
        }

        transitionTo(state, {
            duration: clamp(Number(event.detail?.duration) || (state === PET_STATES.NUZZLING ? NUZZLE_DURATION_MS : 1800), 300, 10000),
            bubble: String(event.detail?.message ?? ''),
            priority: 30,
            force: true,
        });
    };
    on(window, 'xiaoyugao:react', react);
}

export function destroy() {
    while (cleanups.length) {
        try {
            cleanups.pop()();
        } catch (error) {
            console.warn('[Xiaoyugao Pet] Cleanup failed.', error);
        }
    }

    window.clearTimeout(bootTimer);
    window.clearTimeout(reactionTimer);
    window.clearTimeout(bubbleTimer);
    window.clearTimeout(bubbleFollowTimer);
    window.cancelAnimationFrame(positionFrame);
    window.cancelAnimationFrame(hoverFrame);
    window.cancelAnimationFrame(settingsLayerFrame);
    window.clearTimeout(settingsLayerTimer);
    clearGenerationEndTimer();
    clearGenerationWatchdog();
    clearThinkingCompanionTimers();
    clearTypingAttention();
    clearLongPressTimer();
    window.clearTimeout(stalePressTimer);
    stalePressTimer = undefined;
    clearPendingTap();
    clearPoseTimer();
    clearAutoSwimTimer();
    cancelAutoSwim({ settle: false, remember: false });
    renderer?.destroy();
    ui?.root?.remove();
    document.getElementById('xiaoyugao-settings')?.remove();

    if (window.XiaoyugaoPet === publicApi) {
        delete window.XiaoyugaoPet;
    }

    context = undefined;
    coreApi = undefined;
    settings = undefined;
    companion = undefined;
    reportUntil = 0;
    nextAmbientBubbleAt = 0;
    refreshBubbleEditor = undefined;
    renderer = undefined;
    ui = undefined;
    initializePromise = undefined;
    reactionTimer = undefined;
    bubbleTimer = undefined;
    bubbleFollowTimer = undefined;
    positionFrame = undefined;
    hoverFrame = undefined;
    bootTimer = undefined;
    settingsLayerFrame = undefined;
    settingsLayerTimer = undefined;
    generationWatchdog = undefined;
    generationEndTimer = undefined;
    replyArrived = false;
    awaitingLateReply = false;
    currentGenerationType = '';
    lastSignalStatus = '待命，等你发消息';
    currentPriority = 0;
    priorityUntil = 0;
    isGenerating = false;
    publicApi = undefined;
    clickGuard = undefined;
    poseTimer = undefined;
    roamTimer = undefined;
    roamFrame = undefined;
    roamRun = undefined;
    drag.active = false;
    drag.moved = false;
    drag.pointerId = null;
    drag.longPress = false;
}

export function onDisable() {
    destroy();
}

async function initialize() {
    if (initializePromise) {
        return initializePromise;
    }

    initializePromise = (async () => {
        const previousApi = window.XiaoyugaoPet;
        if (typeof previousApi?.destroy === 'function' && previousApi.destroy !== destroy) {
            previousApi.destroy();
        }
        if (ui || renderer) {
            destroy();
        }

        context = SillyTavern.getContext();
        coreApi = await loadSillyTavernCoreApi();
        settings = getSettings();
        companion = new Companion(settings, () => SillyTavern.getContext(), saveSettings);
        ui = createPetUi();
        renderer = new XiaoyugaoRenderer(ui.canvas);
        renderer.setReducedMotion(settings.reducedMotion);
        renderer.start();

        applyVisualSettings();
        applyStoredPosition();
        await createSettingsUi();
        // SillyTavern's own events are sufficient and exact. The old DOM /
        // button / chat-observer fallbacks re-entered thinking on quiet and
        // dryRun generations and were removed in v0.3.6.
        bindSillyTavernEvents();
        bindViewportEvents();
        bindCustomReactionEvent();

        transitionTo(PET_STATES.WAVE, {
            duration: 1800,
            bubble: '鱼仔妈妈，我来啦～',
            priority: 30,
            force: true,
        });

        // Companion and animation integration surface.
        publicApi = Object.freeze({
            states: PET_STATES,
            report: showCompanionReport,
            companionStatus: () => companion?.values(),
            destroy,
            status() {
                return Object.freeze({
                    state: renderer?.state,
                    form: renderer?.currentForm(performance.now()),
                    isGenerating,
                    signal: lastSignalStatus,
                    awaitingLateReply,
                });
            },
            react(state, message = '', duration = state === PET_STATES.NUZZLING ? NUZZLE_DURATION_MS : 1800) {
                window.dispatchEvent(new CustomEvent('xiaoyugao:react', {
                    detail: { state, message, duration },
                }));
            },
            nuzzle() {
                doublePetXiaoyugao();
            },
            lieDown() {
                clearPoseTimer();
                renderer?.setForm('lying');
                showBubble('趴趴～', 1200, false, true);
            },
            sitUp() {
                wakeXiaoyugao();
            },
            swim(direction = 0, duration = SWIM_DURATION) {
                return startAutoSwim(direction, duration, { announce: true });
            },
        });
        window.XiaoyugaoPet = publicApi;

        console.info('[Xiaoyugao Pet] 小鱼糕已就位。');
    })().catch((error) => {
        destroy();
        console.error('[Xiaoyugao Pet] Initialization failed.', error);
        throw error;
    });

    return initializePromise;
}

function scheduleInitialize() {
    window.clearTimeout(bootTimer);
    bootTimer = window.setTimeout(() => {
        bootTimer = undefined;
        void initialize();
    }, 0);
}

function boot() {
    try {
        const initialContext = SillyTavern.getContext();
        const appReady = initialContext.event_types?.APP_READY;

        if (appReady) {
            // APP_READY auto-fires for late subscribers. Defer so we do not hold up ST's loader.
            onEventSource(initialContext.eventSource, appReady, scheduleInitialize);
        } else {
            scheduleInitialize();
        }
    } catch (error) {
        console.error('[Xiaoyugao Pet] Could not attach to SillyTavern.', error);
    }
}

if (document.readyState === 'loading') {
    on(document, 'DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
