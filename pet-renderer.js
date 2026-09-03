export const PET_STATES = Object.freeze({
    IDLE: 'idle',
    LISTENING: 'listening',
    THINKING: 'thinking',
    HAPPY: 'happy',
    CONFUSED: 'confused',
    PETTING: 'petting',
    SLEEPING: 'sleeping',
    WAVE: 'wave',
});

const DESIGN_SIZE = 500;
// The pet is at most 303 CSS px wide. A 750 px backing store remains crisp at
// that size while avoiding a 1000 x 1000 redraw on high-DPR iPhones.
const MAX_PIXEL_RATIO = 1.5;
const SKIN_URL = new URL('./assets/xiaoyugao-base-v1.png', import.meta.url).href;
const CLOSED_EYES_URL = new URL('./assets/xiaoyugao-closed-eyes-v1.png', import.meta.url).href;

function ellipse(ctx, x, y, radiusX, radiusY, fillStyle) {
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
}

function roundedTriangle(ctx, top, left, right, radius = 12) {
    const midpoint = {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
    };

    ctx.beginPath();
    ctx.moveTo(midpoint.x, midpoint.y);
    ctx.lineTo(left.x + radius, left.y - radius * 0.15);
    ctx.quadraticCurveTo(left.x, left.y, left.x + radius * 0.55, left.y - radius);
    ctx.lineTo(top.x - radius * 0.4, top.y + radius);
    ctx.quadraticCurveTo(top.x, top.y, top.x + radius * 0.75, top.y + radius * 0.75);
    ctx.lineTo(right.x - radius, right.y - radius * 0.1);
    ctx.quadraticCurveTo(right.x, right.y, right.x - radius * 0.85, right.y + radius * 0.2);
    ctx.closePath();
}

function drawHeart(ctx, x, y, size, color, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(size / 30, size / 30);
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.bezierCurveTo(-22, -5, -15, -24, 0, -13);
    ctx.bezierCurveTo(15, -24, 22, -5, 0, 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

/**
 * Canvas renderer for Xiaoyugao's painted skin and lightweight state animation.
 * The original vector kitten remains available only as an emergency fallback
 * when the bundled transparent artwork cannot be loaded.
 */
export class XiaoyugaoRenderer {
    constructor(canvas) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('XiaoyugaoRenderer needs a canvas element.');
        }

        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.state = PET_STATES.IDLE;
        this.stateStartedAt = performance.now();
        this.reducedMotion = false;
        this.settingsPreviewMode = false;
        this.running = false;
        this.frameId = 0;
        this.lastFrameAt = 0;
        this.pulseUntil = 0;
        this.skinImage = null;
        this.skinReady = false;
        this.skinFailed = false;
        this.closedEyesImage = null;
        this.closedEyesReady = false;
        this.boundLoop = this.loop.bind(this);
        this.boundVisibilityChange = this.handleVisibilityChange.bind(this);

        this.resizeBackingStore();
        this.loadSkin();
        this.loadClosedEyes();
    }

    loadSkin() {
        const image = new Image();
        image.decoding = 'async';
        image.addEventListener('load', () => {
            this.skinImage = image;
            this.skinReady = true;
            this.skinFailed = false;
            this.draw(performance.now());
        }, { once: true });
        image.addEventListener('error', () => {
            this.skinImage = null;
            this.skinReady = false;
            this.skinFailed = true;
            console.warn('[Xiaoyugao Pet] Painted skin failed to load; using the emergency fallback.');
            this.draw(performance.now());
        }, { once: true });
        image.src = SKIN_URL;
    }

    loadClosedEyes() {
        const image = new Image();
        image.decoding = 'async';
        image.addEventListener('load', () => {
            this.closedEyesImage = image;
            this.closedEyesReady = true;
            this.draw(performance.now());
        }, { once: true });
        image.addEventListener('error', () => {
            this.closedEyesImage = null;
            this.closedEyesReady = false;
            console.warn('[Xiaoyugao Pet] Closed-eye skin failed to load; keeping Xiaoyugao\'s eyes open.');
            this.draw(performance.now());
        }, { once: true });
        image.src = CLOSED_EYES_URL;
    }

    resizeBackingStore() {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const size = Math.round(DESIGN_SIZE * pixelRatio);

        if (this.canvas.width !== size || this.canvas.height !== size) {
            this.canvas.width = size;
            this.canvas.height = size;
        }

        this.pixelRatio = pixelRatio;
        this.draw(performance.now());
    }

    setState(nextState) {
        if (!Object.values(PET_STATES).includes(nextState)) {
            return;
        }

        if (this.state !== nextState) {
            this.state = nextState;
            this.stateStartedAt = performance.now();
        }

        this.draw(performance.now());
    }

    setReducedMotion(enabled) {
        this.reducedMotion = Boolean(enabled);
        this.draw(performance.now());
    }

    setSettingsPreviewMode(enabled) {
        const nextValue = Boolean(enabled);
        if (this.settingsPreviewMode === nextValue) {
            return;
        }

        this.settingsPreviewMode = nextValue;
        this.draw(performance.now());
    }

    pulse() {
        this.pulseUntil = performance.now() + 260;
    }

    start() {
        if (this.running) {
            return;
        }

        this.running = true;
        this.lastFrameAt = 0;
        document.addEventListener('visibilitychange', this.boundVisibilityChange);
        this.frameId = requestAnimationFrame(this.boundLoop);
    }

    stop() {
        this.running = false;
        cancelAnimationFrame(this.frameId);
        document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }

    destroy() {
        this.stop();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    handleVisibilityChange() {
        if (!document.hidden && this.running) {
            this.lastFrameAt = 0;
            cancelAnimationFrame(this.frameId);
            this.frameId = requestAnimationFrame(this.boundLoop);
        }
    }

    loop(now) {
        if (!this.running) {
            return;
        }

        if (document.hidden) {
            this.frameId = requestAnimationFrame(this.boundLoop);
            return;
        }

        const minimumFrameTime = Math.max(
            this.reducedMotion ? 180 : 1000 / 24,
            this.settingsPreviewMode ? 1000 / 12 : 0,
        );
        if (now - this.lastFrameAt >= minimumFrameTime) {
            this.draw(now);
            this.lastFrameAt = now;
        }

        this.frameId = requestAnimationFrame(this.boundLoop);
    }

    draw(now) {
        const ctx = this.ctx;
        if (!ctx) {
            return;
        }

        const ratio = this.pixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, DESIGN_SIZE, DESIGN_SIZE);

        if (this.skinReady && this.skinImage) {
            this.drawPaintedSkin(ctx, now);
            return;
        }

        // Avoid flashing the old vector skin while the local PNG is decoding.
        if (!this.skinFailed) {
            return;
        }

        const seconds = (now - this.stateStartedAt) / 1000;
        const still = this.reducedMotion;
        const sleeping = this.state === PET_STATES.SLEEPING;
        const breathing = still ? 0 : Math.sin(seconds * (sleeping ? 1.8 : 2.7)) * (sleeping ? 3.2 : 1.4);
        const celebratoryBounce = !still && [PET_STATES.HAPPY, PET_STATES.PETTING].includes(this.state)
            ? -Math.abs(Math.sin(seconds * 5.2)) * 5
            : 0;
        const streamingPulse = !still && now < this.pulseUntil
            ? Math.sin((this.pulseUntil - now) / 260 * Math.PI) * 2.5
            : 0;
        const confusedTilt = this.state === PET_STATES.CONFUSED ? -0.075 : 0;
        const listeningTilt = this.state === PET_STATES.LISTENING ? 0.035 : 0;
        const bodyY = breathing + celebratoryBounce - streamingPulse;

        ctx.save();
        ctx.translate(250, 270 + bodyY);
        ctx.rotate(confusedTilt + listeningTilt);
        ctx.translate(-250, -270);

        this.drawShadow(ctx, bodyY);
        this.drawTail(ctx, seconds, still);

        // Xiaoyugao is fluffy, not round: keep a light cat-fox silhouette while the
        // oversized tail stays gloriously plush behind her.
        ctx.save();
        ctx.translate(250, 270);
        ctx.scale(0.84, 1.025);
        ctx.translate(-250, -270);
        this.drawBody(ctx, breathing);
        this.drawHead(ctx, seconds, still);
        this.drawFace(ctx, seconds, still);
        this.drawPaws(ctx, seconds, still);
        this.drawStateAccents(ctx, seconds, still);
        ctx.restore();

        ctx.restore();
    }

    drawPaintedSkin(ctx, now) {
        const seconds = (now - this.stateStartedAt) / 1000;
        const still = this.reducedMotion;
        const wave = still ? 0 : Math.sin(seconds * 2.5);
        const quickWave = still ? 0 : Math.sin(seconds * 6.2);
        const streamPulse = !still && now < this.pulseUntil
            ? Math.sin((this.pulseUntil - now) / 260 * Math.PI)
            : 0;

        let offsetX = 0;
        let offsetY = 0;
        let rotation = 0;
        let scaleX = 1;
        let scaleY = 1;
        let alpha = 1;

        switch (this.state) {
            case PET_STATES.LISTENING:
                rotation = still ? 0.018 : 0.018 + wave * 0.008;
                scaleX = 1.008;
                scaleY = 1.008;
                break;
            case PET_STATES.THINKING:
                if (still) {
                    rotation = -0.008;
                } else {
                    // Two tiny nods followed by a short attentive pause. The
                    // motion stays obvious at iPhone scale without turning the
                    // whole cat into a bouncing ball.
                    const nodWindow = seconds % 2.8;
                    const nod = nodWindow < 1.1
                        ? Math.sin((nodWindow / 1.1) * Math.PI * 2) ** 2
                        : 0;
                    offsetY = nod * 6.5;
                    rotation = -0.008 + Math.sin(seconds * 1.4) * 0.003;
                    scaleX = 1 + nod * 0.004;
                    scaleY = 1 - nod * 0.01;
                }
                break;
            case PET_STATES.HAPPY:
                offsetY = still ? -2 : -Math.abs(quickWave) * 7;
                scaleX = still ? 1.01 : 1.01 + Math.abs(quickWave) * 0.012;
                scaleY = still ? 1.01 : 1.01 - Math.abs(quickWave) * 0.006;
                break;
            case PET_STATES.CONFUSED:
                offsetX = -3;
                rotation = -0.045;
                break;
            case PET_STATES.PETTING:
                offsetY = still ? 2 : 2 + Math.abs(quickWave) * 2;
                scaleX = still ? 1.012 : 1.012 + Math.abs(quickWave) * 0.008;
                scaleY = still ? 0.992 : 0.992 - Math.abs(quickWave) * 0.006;
                break;
            case PET_STATES.SLEEPING:
                offsetY = 5;
                rotation = -0.012;
                scaleX = 1.006;
                scaleY = 0.988;
                alpha = 0.94;
                break;
            case PET_STATES.WAVE:
                offsetX = still ? 0 : quickWave * 2.5;
                rotation = still ? 0.018 : quickWave * 0.022;
                break;
            case PET_STATES.IDLE:
            default: {
                const breath = still ? 0 : Math.sin(seconds * 2.1);
                offsetY = breath * 1.1;
                scaleX = 1 - breath * 0.0025;
                scaleY = 1 + breath * 0.0045;
                break;
            }
        }

        offsetY -= streamPulse * 2.2;

        ctx.save();
        ctx.globalAlpha = 0.13;
        ellipse(ctx, 251, 469, 139, 13, '#1d2832');
        ctx.restore();

        const naturalWidth = this.skinImage.naturalWidth || this.skinImage.width;
        const naturalHeight = this.skinImage.naturalHeight || this.skinImage.height;
        const fitScale = Math.min(438 / naturalWidth, 472 / naturalHeight);
        const drawWidth = naturalWidth * fitScale;
        const drawHeight = naturalHeight * fitScale;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(250 + offsetX, 468 + offsetY);
        ctx.rotate(rotation);
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(this.skinImage, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
        this.drawClosedEyesOverlay(ctx, now, naturalWidth, drawWidth, drawHeight);
        ctx.restore();

        this.drawAquaticBubbles(ctx, seconds, still);
        this.drawPaintedAccents(ctx, seconds, still);
    }

    blinkAmount(now) {
        if ([PET_STATES.HAPPY, PET_STATES.PETTING, PET_STATES.SLEEPING].includes(this.state)) {
            return 1;
        }

        if (this.reducedMotion) {
            return 0;
        }

        // A quick natural blink roughly every 4.7 seconds. Using absolute time
        // prevents state changes from restarting the blink rhythm.
        const phase = (now % 4700) / 1000;
        if (phase >= 0.16) {
            return 0;
        }

        return Math.sin((phase / 0.16) * Math.PI);
    }

    drawClosedEyesOverlay(ctx, now, naturalWidth, drawWidth, drawHeight) {
        const amount = this.blinkAmount(now);
        if (amount <= 0.01 || !this.closedEyesReady || !this.closedEyesImage) {
            return;
        }

        ctx.save();
        ctx.globalAlpha *= Math.min(1, amount * 1.35);
        ctx.drawImage(this.closedEyesImage, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
        ctx.restore();
    }

    drawAquaticBubbles(ctx, seconds, still) {
        // 小鱼糕每次呼噜都会吐出一串小泡泡。泡泡由 Canvas 实时绘制，
        // 因此不会随着皮肤一起僵在原地。
        const speed = this.state === PET_STATES.HAPPY ? 0.38 : 0.24;
        const count = this.reducedMotion ? 2 : 5;
        ctx.save();
        for (let index = 0; index < count; index += 1) {
            const cycle = still ? index / count : (seconds * speed + index / count) % 1;
            const rise = cycle * 118;
            const sway = still ? 0 : Math.sin(seconds * 2.1 + index * 1.7) * (5 + index);
            const radius = 3.8 + index * 1.25 + Math.sin(cycle * Math.PI) * 1.8;
            const opacity = Math.sin(cycle * Math.PI) * 0.62;
            const x = 198 + sway - rise * 0.06;
            const y = 224 - rise;
            const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, 1, x, y, radius);
            gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
            gradient.addColorStop(0.35, `rgba(176,244,255,${opacity * 0.38})`);
            gradient.addColorStop(0.78, `rgba(113,208,238,${opacity * 0.28})`);
            gradient.addColorStop(1, 'rgba(113,208,238,0)');
            ctx.globalAlpha = opacity;
            ellipse(ctx, x, y, radius, radius, gradient);
            ctx.strokeStyle = 'rgba(221,250,255,0.78)';
            ctx.lineWidth = 1.15;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawPaintedAccents(ctx, seconds, still) {
        if (this.state === PET_STATES.LISTENING) {
            const pulse = still ? 0 : Math.sin(seconds * 4) * 2;
            ctx.save();
            ctx.strokeStyle = 'rgba(211, 163, 82, 0.78)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            for (let index = 0; index < 2; index += 1) {
                ctx.beginPath();
                ctx.arc(408, 113, 15 + index * 12 + pulse, -0.8, 0.55);
                ctx.stroke();
            }
            ctx.restore();
        }

        if (this.state === PET_STATES.THINKING) {
            for (let index = 0; index < 3; index += 1) {
                const phase = still ? index : (index + Math.floor(seconds * 3)) % 3;
                ctx.save();
                ctx.globalAlpha = 0.38 + phase * 0.25;
                ellipse(ctx, 388 + index * 22, 112 - index * 13, 6 + index, 6 + index, '#d6a457');
                ctx.restore();
            }
        }

        if (this.state === PET_STATES.HAPPY) {
            const sparkle = still ? 0.85 : 0.68 + Math.sin(seconds * 7) * 0.2;
            ctx.save();
            ctx.globalAlpha = sparkle;
            ctx.fillStyle = '#e7bb62';
            for (const [x, y, size] of [[72, 151, 9], [419, 176, 8], [389, 91, 6]]) {
                ctx.beginPath();
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size * 0.3, y - size * 0.3);
                ctx.lineTo(x + size, y);
                ctx.lineTo(x + size * 0.3, y + size * 0.3);
                ctx.lineTo(x, y + size);
                ctx.lineTo(x - size * 0.3, y + size * 0.3);
                ctx.lineTo(x - size, y);
                ctx.lineTo(x - size * 0.3, y - size * 0.3);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        if (this.state === PET_STATES.CONFUSED) {
            ctx.save();
            ctx.translate(405, 106);
            ctx.rotate(0.1);
            ctx.font = '700 48px ui-rounded, system-ui, sans-serif';
            ctx.fillStyle = '#bd8741';
            ctx.fillText('?', 0, 0);
            ctx.restore();
        }

        if (this.state === PET_STATES.PETTING) {
            const rise = still ? 0 : (seconds * 20) % 16;
            drawHeart(ctx, 79, 151 - rise * 0.22, 24, '#e99aa1', -0.2);
            drawHeart(ctx, 408, 119 - rise * 0.35, 30, '#e5aa73', 0.18);
            drawHeart(ctx, 433, 161 - rise * 0.15, 17, '#e99aa1', 0.12);
        }

        if (this.state === PET_STATES.SLEEPING) {
            const rise = still ? 0 : (seconds * 16) % 27;
            ctx.save();
            ctx.globalAlpha = 0.72;
            ctx.font = '700 27px ui-rounded, system-ui, sans-serif';
            ctx.fillStyle = '#8798a8';
            ctx.fillText('z', 385, 129 - rise * 0.23);
            ctx.font = '700 37px ui-rounded, system-ui, sans-serif';
            ctx.fillText('Z', 409, 101 - rise * 0.4);
            ctx.restore();
        }

        if (this.state === PET_STATES.WAVE) {
            const opacity = still ? 0.8 : 0.62 + Math.sin(seconds * 7) * 0.2;
            ctx.save();
            ctx.globalAlpha = opacity;
            drawHeart(ctx, 416, 139, 20, '#e6a477', 0.18);
            ctx.restore();
        }
    }

    drawShadow(ctx, bodyY) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        ellipse(ctx, 247, 449 - bodyY * 0.2, 128, 21, '#26313a');
        ctx.restore();
    }

    drawTail(ctx, seconds, still) {
        const active = [PET_STATES.HAPPY, PET_STATES.PETTING, PET_STATES.WAVE].includes(this.state);
        const amplitude = active ? 15 : 6;
        const wag = still ? 0 : Math.sin(seconds * (active ? 4.4 : 2.2)) * amplitude;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const tailGradient = ctx.createLinearGradient(325, 395, 444, 218);
        tailGradient.addColorStop(0, '#aeb8c2');
        tailGradient.addColorStop(0.52, '#e7edf2');
        tailGradient.addColorStop(1, '#fbfdff');

        ctx.beginPath();
        ctx.moveTo(325, 389);
        ctx.bezierCurveTo(420 + wag * 0.35, 422, 458 + wag, 342, 423 + wag * 0.72, 254);
        ctx.strokeStyle = 'rgba(40, 51, 64, 0.18)';
        ctx.lineWidth = 91;
        ctx.stroke();
        ctx.strokeStyle = tailGradient;
        ctx.lineWidth = 82;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(421 + wag * 0.74, 263);
        ctx.bezierCurveTo(432 + wag * 0.85, 235, 428 + wag * 0.9, 218, 414 + wag * 0.9, 205);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 62;
        ctx.stroke();
        ctx.restore();
    }

    drawBody(ctx, breathing) {
        const bodyGradient = ctx.createLinearGradient(154, 224, 345, 444);
        bodyGradient.addColorStop(0, '#f2f6f8');
        bodyGradient.addColorStop(0.58, '#d9e1e7');
        bodyGradient.addColorStop(1, '#aeb9c3');

        ctx.save();
        ctx.shadowColor = 'rgba(32, 45, 58, 0.22)';
        ctx.shadowBlur = 17;
        ctx.shadowOffsetY = 8;
        ellipse(ctx, 250, 337, 119 + breathing * 0.2, 125 + breathing, bodyGradient);
        ctx.restore();

        const bellyGradient = ctx.createRadialGradient(233, 325, 16, 250, 353, 91);
        bellyGradient.addColorStop(0, '#ffffff');
        bellyGradient.addColorStop(1, '#edf3f6');
        ellipse(ctx, 250, 354, 76, 91 + breathing * 0.3, bellyGradient);

        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#71808d';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        for (const direction of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(250 + direction * 84, 286);
            ctx.quadraticCurveTo(250 + direction * 67, 296, 250 + direction * 58, 315);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(250 + direction * 102, 324);
            ctx.quadraticCurveTo(250 + direction * 78, 330, 250 + direction * 68, 347);
            ctx.stroke();
        }
        ctx.restore();

        // Warm little moon tag: the only warm accent besides Xiaoyugao's eyes.
        ctx.save();
        ctx.strokeStyle = '#b78342';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(250, 283, 29, 0.18, Math.PI - 0.18);
        ctx.stroke();
        ellipse(ctx, 250, 309, 11, 13, '#d8a95b');
        ellipse(ctx, 255, 305, 7, 10, '#edf3f6');
        ctx.restore();
    }

    drawPaws(ctx, seconds, still) {
        const waving = this.state === PET_STATES.WAVE;
        const petting = this.state === PET_STATES.PETTING;
        const pawGradient = ctx.createLinearGradient(0, 347, 0, 440);
        pawGradient.addColorStop(0, '#d7e0e6');
        pawGradient.addColorStop(1, '#fbfdff');

        const drawPaw = (x, y, rotation = 0, showPads = false) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ellipse(ctx, 0, 0, 42, 52, pawGradient);
            if (showPads) {
                ellipse(ctx, 0, 11, 12, 14, '#d8a9aa');
                ellipse(ctx, -16, -7, 7, 9, '#e3b7b8');
                ellipse(ctx, 0, -13, 7, 9, '#e3b7b8');
                ellipse(ctx, 16, -7, 7, 9, '#e3b7b8');
            }
            ctx.restore();
        };

        drawPaw(181, 401, -0.1, petting);

        if (waving) {
            const wave = still ? -0.28 : -0.28 + Math.sin(seconds * 8) * 0.24;
            ctx.save();
            ctx.translate(362, 358);
            ctx.rotate(wave);
            ctx.translate(0, -78);
            drawPaw(0, 0, 0.2, true);
            ctx.restore();
        } else {
            drawPaw(319, 401, 0.1, petting);
        }
    }

    drawHead(ctx, seconds, still) {
        const listening = this.state === PET_STATES.LISTENING;
        const confused = this.state === PET_STATES.CONFUSED;
        const earTwitch = still ? 0 : Math.max(0, Math.sin(seconds * 3.1 - 0.4)) * (listening ? 7 : 1.5);
        const leftEarLift = listening ? -8 : 0;
        const rightEarDip = confused ? 12 : 0;

        ctx.save();
        ctx.shadowColor = 'rgba(30, 42, 54, 0.2)';
        ctx.shadowBlur = 15;
        ctx.shadowOffsetY = 7;

        roundedTriangle(
            ctx,
            { x: 162, y: 77 + leftEarLift - earTwitch },
            { x: 132, y: 196 },
            { x: 219, y: 156 },
        );
        ctx.fillStyle = '#b8c3cc';
        ctx.fill();

        roundedTriangle(
            ctx,
            { x: 342, y: 77 + rightEarDip + earTwitch * 0.4 },
            { x: 282, y: 157 },
            { x: 373, y: 196 },
        );
        ctx.fillStyle = '#b8c3cc';
        ctx.fill();
        ctx.restore();

        // Soft pink inner ears.
        ctx.save();
        ctx.globalAlpha = 0.72;
        roundedTriangle(ctx, { x: 164, y: 103 + leftEarLift }, { x: 148, y: 169 }, { x: 198, y: 151 }, 7);
        ctx.fillStyle = '#dcb8b8';
        ctx.fill();
        roundedTriangle(ctx, { x: 340, y: 104 + rightEarDip }, { x: 302, y: 152 }, { x: 358, y: 171 }, 7);
        ctx.fillStyle = '#dcb8b8';
        ctx.fill();
        ctx.restore();

        const headGradient = ctx.createLinearGradient(170, 119, 329, 278);
        headGradient.addColorStop(0, '#f7fafc');
        headGradient.addColorStop(0.58, '#e0e7ec');
        headGradient.addColorStop(1, '#b9c4cd');
        ellipse(ctx, 250, 206, 124, 105, headGradient);

        // Forehead and cheek markings keep the face readable at small sizes.
        ctx.save();
        ctx.strokeStyle = 'rgba(96, 112, 125, 0.43)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        for (const offset of [-24, 0, 24]) {
            ctx.beginPath();
            ctx.moveTo(250 + offset * 0.58, 121);
            ctx.quadraticCurveTo(250 + offset, 143, 250 + offset * 0.8, 160);
            ctx.stroke();
        }
        for (const direction of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(250 + direction * 111, 207);
            ctx.quadraticCurveTo(250 + direction * 85, 211, 250 + direction * 72, 229);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(250 + direction * 106, 232);
            ctx.quadraticCurveTo(250 + direction * 82, 234, 250 + direction * 68, 246);
            ctx.stroke();
        }
        ctx.restore();

        ellipse(ctx, 250, 237, 78, 49, '#f9fbfc');
    }

    drawFace(ctx, seconds, still) {
        const closed = [PET_STATES.HAPPY, PET_STATES.PETTING, PET_STATES.SLEEPING].includes(this.state);
        const blinkCycle = still ? 0 : seconds % 4.8;
        const blinking = !closed && blinkCycle > 4.58;
        const thinking = this.state === PET_STATES.THINKING;
        const confused = this.state === PET_STATES.CONFUSED;
        const listening = this.state === PET_STATES.LISTENING;

        if (closed || blinking) {
            ctx.save();
            ctx.strokeStyle = '#34414d';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            for (const direction of [-1, 1]) {
                ctx.beginPath();
                const y = this.state === PET_STATES.SLEEPING ? 199 : 194;
                ctx.arc(250 + direction * 49, y, 23, 0.2, Math.PI - 0.2, false);
                ctx.stroke();
            }
            ctx.restore();
        } else {
            const eyeRadiusX = listening ? 27 : 25;
            const eyeRadiusY = listening ? 31 : 28;
            const lookX = confused ? -4 : 0;
            const lookY = thinking ? -6 : 1;
            const irisGradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 19);
            irisGradient.addColorStop(0, '#fff1a8');
            irisGradient.addColorStop(0.45, '#d69a38');
            irisGradient.addColorStop(1, '#8a551e');

            for (const direction of [-1, 1]) {
                const x = 250 + direction * 49;
                ellipse(ctx, x, 196, eyeRadiusX, eyeRadiusY, '#f7fbfc');

                ctx.save();
                ctx.translate(x + lookX, 196 + lookY);
                ellipse(ctx, 0, 0, 18, 22, irisGradient);
                ellipse(ctx, 0, 1, 8, 14, '#243039');
                ellipse(ctx, -5, -7, 4.5, 6, 'rgba(255,255,255,0.92)');
                ctx.restore();

                ctx.save();
                ctx.strokeStyle = '#53616d';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.arc(x, 196, eyeRadiusX, Math.PI + 0.18, Math.PI * 2 - 0.18);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Nose, mouth and whiskers.
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(239, 229);
        ctx.quadraticCurveTo(250, 221, 261, 229);
        ctx.quadraticCurveTo(250, 242, 239, 229);
        ctx.fillStyle = '#b77d7d';
        ctx.fill();

        ctx.strokeStyle = '#5b6570';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(250, 238);
        ctx.lineTo(250, 246);
        ctx.quadraticCurveTo(239, 254, 229, 247);
        ctx.moveTo(250, 246);
        ctx.quadraticCurveTo(261, 254, 271, 247);
        ctx.stroke();

        ctx.globalAlpha = 0.54;
        ctx.lineWidth = 2.6;
        for (const direction of [-1, 1]) {
            for (let row = -1; row <= 1; row += 1) {
                ctx.beginPath();
                ctx.moveTo(250 + direction * 49, 239 + row * 9);
                ctx.quadraticCurveTo(250 + direction * 82, 235 + row * 11, 250 + direction * 111, 231 + row * 14);
                ctx.stroke();
            }
        }
        ctx.restore();

        if ([PET_STATES.HAPPY, PET_STATES.PETTING].includes(this.state)) {
            ctx.save();
            ctx.globalAlpha = 0.36;
            ellipse(ctx, 186, 229, 22, 11, '#ef9da4');
            ellipse(ctx, 314, 229, 22, 11, '#ef9da4');
            ctx.restore();
        }
    }

    drawStateAccents(ctx, seconds, still) {
        if (this.state === PET_STATES.THINKING) {
            const lift = still ? 0 : Math.sin(seconds * 3.2) * 3;
            for (let index = 0; index < 3; index += 1) {
                const alpha = 0.35 + ((index + Math.floor(seconds * 3)) % 3) * 0.24;
                ctx.save();
                ctx.globalAlpha = alpha;
                ellipse(ctx, 344 + index * 22, 109 - index * 12 + lift, 7 + index * 1.5, 7 + index * 1.5, '#d6a457');
                ctx.restore();
            }
        }

        if (this.state === PET_STATES.CONFUSED) {
            ctx.save();
            ctx.translate(356, 116);
            ctx.rotate(0.12);
            ctx.font = '700 55px ui-rounded, system-ui, sans-serif';
            ctx.fillStyle = '#b98543';
            ctx.fillText('?', 0, 0);
            ctx.restore();
        }

        if (this.state === PET_STATES.PETTING) {
            const float = still ? 0 : (seconds * 24) % 18;
            drawHeart(ctx, 151, 131 - float * 0.2, 24, '#e99aa1', -0.2);
            drawHeart(ctx, 355, 113 - float * 0.35, 31, '#e5aa73', 0.18);
            drawHeart(ctx, 382, 154 - float * 0.15, 18, '#e99aa1', 0.12);
        }

        if (this.state === PET_STATES.HAPPY) {
            const sparkle = still ? 1 : 0.72 + Math.sin(seconds * 6) * 0.2;
            ctx.save();
            ctx.globalAlpha = sparkle;
            ctx.fillStyle = '#e2b75d';
            for (const [x, y, size] of [[145, 150, 10], [365, 165, 8], [340, 102, 6]]) {
                ctx.beginPath();
                ctx.moveTo(x, y - size);
                ctx.lineTo(x + size * 0.32, y - size * 0.32);
                ctx.lineTo(x + size, y);
                ctx.lineTo(x + size * 0.32, y + size * 0.32);
                ctx.lineTo(x, y + size);
                ctx.lineTo(x - size * 0.32, y + size * 0.32);
                ctx.lineTo(x - size, y);
                ctx.lineTo(x - size * 0.32, y - size * 0.32);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        if (this.state === PET_STATES.SLEEPING) {
            const rise = still ? 0 : (seconds * 17) % 30;
            ctx.save();
            ctx.globalAlpha = 0.74;
            ctx.font = '700 28px ui-rounded, system-ui, sans-serif';
            ctx.fillStyle = '#8798a8';
            ctx.fillText('z', 347, 139 - rise * 0.25);
            ctx.font = '700 38px ui-rounded, system-ui, sans-serif';
            ctx.fillText('Z', 372, 112 - rise * 0.45);
            ctx.restore();
        }
    }
}
