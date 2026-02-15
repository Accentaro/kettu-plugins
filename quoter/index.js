(() => {
    const MODULE_TAG = "KettuQuoter";
    const BUILD_ID = "2026-02-15";

    const DEFAULTS = {
        grayscale: true,
        showWatermark: false,
        watermark: "Made with Kettu",
    };

    const storage = vendetta?.plugin?.storage ?? {};
    const patches = [];

    const metro = vendetta.metro;
    const common = metro.common;
    const React = common.React;
    const ReactNative = common.ReactNative;

    const { findInReactTree } = vendetta.utils;
    const { showConfirmationAlert } = vendetta.ui.alerts;
    const { showToast } = vendetta.ui.toasts;
    const { getAssetIDByName } = vendetta.ui.assets;
    const logger = vendetta.logger ?? console;

    const LazyActionSheet = metro.findByProps("openLazy", "hideActionSheet");
    const UserStore = typeof metro.findByStoreName === "function"
        ? metro.findByStoreName("UserStore")
        : null;
    const AvatarUtils = metro.findByProps("getUserAvatarURL");
    const WebView = metro.find(module => module?.WebView && !module?.default)?.WebView ?? null;

    const CANVAS_CONFIG = {
        width: 1200,
        height: 600,
        quoteAreaWidth: 520,
        quoteAreaX: 640,
        maxContentHeight: 480,
    };

    const FONT_SIZES = {
        initial: 42,
        minimum: 18,
        decrement: 2,
        lineHeightMultiplier: 1.25,
        authorMultiplier: 0.6,
        usernameMultiplier: 0.45,
        authorMinimum: 22,
        usernameMinimum: 18,
        watermark: 18,
    };

    const SPACING = {
        authorTop: 60,
        username: 10,
        gradientWidth: 400,
        watermarkPadding: 20,
    };

    const UPLOAD_METHOD_NAMES = [
        "promptToUpload",
        "showUploadDialog",
        "uploadFiles",
        "handleUpload",
    ];

    const UPLOAD_SIGNATURES = [
        "Unexpected mismatch between files and file metadata",
        "showLargeMessageDialog",
        "canUploadLongMessages",
        "promptToUpload",
        "MESSAGE_CREATE_ATTACHMENT_UPLOAD",
        "MESSAGE_DELETE_UPLOAD",
        "uploadAttachment",
        "uploads",
    ];

    const UPLOAD_KEY_HINTS = [
        "upload",
        "attach",
        "attachment",
        "draft",
        "file",
        "media",
        "prompt",
        "large",
        "picker",
    ];

    function ensureDefaults() {
        storage.grayscale ??= DEFAULTS.grayscale;
        storage.showWatermark ??= DEFAULTS.showWatermark;
        storage.watermark ??= DEFAULTS.watermark;
    }

    function toast(message, iconName = "Check") {
        const icon = getAssetIDByName(iconName);
        showToast(message, icon);
    }

    function errorToast(message) {
        toast(message, "Small");
    }

    function normalizeText(text) {
        if (!text) return "";
        return String(text).replace(/\s+/g, " ").trim();
    }

    function sizeUpgrade(url) {
        if (!url || typeof url !== "string") return "";
        try {
            const parsed = new URL(url);
            parsed.searchParams.set("size", "512");
            if (parsed.hostname === "cdn.discordapp.com" || parsed.hostname === "media.discordapp.net") {
                parsed.pathname = parsed.pathname.replace(/\.(webp|gif|jpg|jpeg)$/i, ".png");
                parsed.searchParams.set("format", "png");
            }
            return parsed.toString();
        } catch {
            return url;
        }
    }

    function fixUpQuote(rawQuote) {
        let result = String(rawQuote ?? "").replace(/<a?:(\w+):(\d+)>/g, "");
        const mentionMatches = result.match(/<@!?\d+>/g);
        if (!mentionMatches) return normalizeText(result);

        for (const match of mentionMatches) {
            const userId = match.replace(/[<@!>]/g, "");
            const user = UserStore?.getUser?.(userId);
            if (user?.username) {
                result = result.replace(match, `@${user.username}`);
            }
        }

        return normalizeText(result);
    }

    function getMessageAuthor(message) {
        return message?.author ?? {};
    }

    function getDisplayName(author) {
        return author?.globalName || author?.global_name || author?.username || "Unknown";
    }

    function getAuthorUsername(author) {
        return String(author?.username || "unknown").replace(/[^\w.-]/g, "").slice(0, 32) || "unknown";
    }

    function getAvatarUrl(author) {
        try {
            if (typeof author?.getAvatarURL === "function") {
                return sizeUpgrade(author.getAvatarURL());
            }
        } catch { }

        try {
            if (AvatarUtils && typeof AvatarUtils.getUserAvatarURL === "function") {
                return sizeUpgrade(AvatarUtils.getUserAvatarURL(author, false));
            }
        } catch { }

        if (author?.id && author?.avatar) {
            return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=512`;
        }

        return "https://cdn.discordapp.com/embed/avatars/0.png?size=512";
    }

    function getMessageChannelId(message) {
        return message?.channel_id || message?.channelId || message?.channel?.id || null;
    }

    function buildFileName(message) {
        const content = fixUpQuote(message?.content || "");
        const preview = content.split(" ").filter(Boolean).slice(0, 6).join(" ");
        const safePreview = (preview || "quote").replace(/[^\w.-]/g, "_").slice(0, 48);
        const username = getAuthorUsername(getMessageAuthor(message));
        return `${safePreview}-${username}.png`;
    }

    function buildPayload(message, options) {
        const author = getMessageAuthor(message);
        return {
            quote: fixUpQuote(message?.content || "").slice(0, 420) || " ",
            displayName: getDisplayName(author).slice(0, 64),
            username: `@${getAuthorUsername(author)}`,
            avatarUrl: getAvatarUrl(author),
            grayscale: Boolean(options.grayscale),
            showWatermark: Boolean(options.showWatermark),
            watermark: String(options.watermark || "").slice(0, 32),
            quoteFont: "M PLUS Rounded 1c",
            canvas: CANVAS_CONFIG,
            fonts: FONT_SIZES,
            spacing: SPACING,
        };
    }

    function buildRendererHtml(payload) {
        const safePayload = JSON.stringify(payload).replace(/<\/script/gi, "<\\/script");

        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
@import url('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@300&display=swap');
html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
}
canvas {
    width: 100%;
    height: 100%;
    display: block;
}
</style>
</head>
<body>
<canvas id="q" width="1200" height="600"></canvas>
<script>
const payload = ${safePayload};

function post(data) {
    try {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
    } catch {}
}

function calculateTextLines(ctx, text, fontSize, font, maxWidth) {
    ctx.font = "300 " + fontSize + "px '" + font + "', sans-serif";
    const words = String(text || "").split(" ");
    const lines = [];
    let currentLine = [];

    for (const word of words) {
        const testLine = [...currentLine, word].join(" ");
        if (ctx.measureText(testLine).width > maxWidth && currentLine.length) {
            lines.push(currentLine.join(" "));
            currentLine = [word];
        } else {
            currentLine.push(word);
        }
    }

    if (currentLine.length) lines.push(currentLine.join(" "));
    return lines;
}

function calculateFont(ctx, quote, font, cfg, fs, sp) {
    let fontSize = fs.initial;
    while (fontSize >= fs.minimum) {
        const lines = calculateTextLines(ctx, quote, fontSize, font, cfg.quoteAreaWidth);
        const lineHeight = fontSize * fs.lineHeightMultiplier;
        const authorFontSize = Math.max(fs.authorMinimum, fontSize * fs.authorMultiplier);
        const usernameFontSize = Math.max(fs.usernameMinimum, fontSize * fs.usernameMultiplier);
        const totalHeight = (lines.length * lineHeight) + sp.authorTop + authorFontSize + sp.username + usernameFontSize;
        if (totalHeight <= cfg.maxContentHeight) {
            return { lines, fontSize, lineHeight, authorFontSize, usernameFontSize, totalHeight };
        }
        fontSize -= fs.decrement;
    }

    const lines = calculateTextLines(ctx, quote, fs.minimum, font, cfg.quoteAreaWidth);
    const lineHeight = fs.minimum * fs.lineHeightMultiplier;
    return {
        lines,
        fontSize: fs.minimum,
        lineHeight,
        authorFontSize: fs.authorMinimum,
        usernameFontSize: fs.usernameMinimum,
        totalHeight: (lines.length * lineHeight) + sp.authorTop + fs.authorMinimum + sp.username + fs.usernameMinimum,
    };
}

async function loadAvatar(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch avatar image.");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    try {
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to load avatar image."));
            img.src = blobUrl;
        });
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

async function render() {
    const cfg = payload.canvas;
    const fs = payload.fonts;
    const sp = payload.spacing;
    const quoteFont = payload.quoteFont || "M PLUS Rounded 1c";

    const canvas = document.getElementById("q");
    canvas.width = cfg.width;
    canvas.height = cfg.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cfg.width, cfg.height);

    const avatar = await loadAvatar(payload.avatarUrl);
    ctx.drawImage(avatar, 0, 0, cfg.height, cfg.height);

    if (payload.grayscale) {
        ctx.globalCompositeOperation = "saturation";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cfg.width, cfg.height);
        ctx.globalCompositeOperation = "source-over";
    }

    const gradient = ctx.createLinearGradient(cfg.height - sp.gradientWidth, 0, cfg.height, 0);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 1)");
    ctx.fillStyle = gradient;
    ctx.fillRect(cfg.height - sp.gradientWidth, 0, sp.gradientWidth, cfg.height);

    const quote = String(payload.quote || " ");
    const calculation = calculateFont(ctx, quote, quoteFont, cfg, fs, sp);

    ctx.fillStyle = "#fff";
    ctx.font = "300 " + calculation.fontSize + "px '" + quoteFont + "', sans-serif";
    let quoteY = (cfg.height - calculation.totalHeight) / 2;
    for (const line of calculation.lines) {
        const xOffset = (cfg.quoteAreaWidth - ctx.measureText(line).width) / 2;
        quoteY += calculation.lineHeight;
        ctx.fillText(line, cfg.quoteAreaX + xOffset, quoteY);
    }

    const authorText = "- " + String(payload.displayName || "Unknown");
    ctx.font = "italic 300 " + calculation.authorFontSize + "px 'M PLUS Rounded 1c', sans-serif";
    ctx.fillStyle = "#fff";
    const authorX = cfg.quoteAreaX + (cfg.quoteAreaWidth - ctx.measureText(authorText).width) / 2;
    const authorY = quoteY + sp.authorTop;
    ctx.fillText(authorText, authorX, authorY);

    const usernameText = String(payload.username || "@unknown");
    ctx.font = "300 " + calculation.usernameFontSize + "px 'M PLUS Rounded 1c', sans-serif";
    ctx.fillStyle = "#888";
    const usernameX = cfg.quoteAreaX + (cfg.quoteAreaWidth - ctx.measureText(usernameText).width) / 2;
    const usernameY = authorY + sp.username + calculation.usernameFontSize;
    ctx.fillText(usernameText, usernameX, usernameY);

    if (payload.showWatermark && payload.watermark) {
        const watermarkText = String(payload.watermark).slice(0, 32);
        ctx.fillStyle = "#888";
        ctx.font = "300 " + fs.watermark + "px 'M PLUS Rounded 1c', sans-serif";
        const watermarkX = cfg.width - ctx.measureText(watermarkText).width - sp.watermarkPadding;
        const watermarkY = cfg.height - sp.watermarkPadding;
        ctx.fillText(watermarkText, watermarkX, watermarkY);
    }

    const dataUrl = canvas.toDataURL("image/png");
    post({ type: "result", dataUrl, renderId: payload.renderId });
}

render().catch(error => {
    post({
        type: "error",
        renderId: payload.renderId,
        message: String(error && error.message ? error.message : error),
    });
});
</script>
</body>
</html>`;
    }

    function getOptions() {
        return {
            grayscale: Boolean(storage.grayscale),
            showWatermark: Boolean(storage.showWatermark),
            watermark: String(storage.watermark ?? DEFAULTS.watermark),
        };
    }

    function setOptions(options) {
        storage.grayscale = Boolean(options.grayscale);
        storage.showWatermark = Boolean(options.showWatermark);
        storage.watermark = String(options.watermark ?? "");
    }

    function safeFind(factory, fallback = null) {
        try {
            const value = factory?.();
            return value ?? fallback;
        } catch {
            return fallback;
        }
    }

    function getChannelModule() {
        return safeFind(() => (typeof metro.findByStoreName === "function" ? metro.findByStoreName("ChannelStore") : null))
            ?? safeFind(() => metro.findByProps("getChannel", "getDMFromUserId"))
            ?? safeFind(() => metro.findByProps("getChannel"));
    }

    let cachedUploadCandidates = null;
    let lastUploadLookupDiagnostics = "lookup not run";

    function normalizeLower(value) {
        return String(value || "").toLowerCase();
    }

    function logDebug(message, data) {
        const suffix = data === undefined ? "" : ` ${typeof data === "string" ? data : JSON.stringify(data)}`;
        try {
            logger?.log?.(`[${MODULE_TAG}] ${message}${suffix}`);
        } catch { }
        try {
            console.log(`[${MODULE_TAG}] ${message}${suffix}`);
        } catch { }
    }

    function logError(message, error) {
        const detail = error instanceof Error ? (error.stack || error.message) : String(error);
        try {
            logger?.error?.(`[${MODULE_TAG}] ${message}: ${detail}`);
        } catch { }
        try {
            console.error(`[${MODULE_TAG}] ${message}: ${detail}`);
        } catch { }
    }

    function includesAny(value, list) {
        for (const item of list) {
            if (value.includes(item)) return true;
        }
        return false;
    }

    function functionContainsUploadSignature(fn) {
        if (typeof fn !== "function") return false;
        try {
            const source = String(fn);
            return UPLOAD_SIGNATURES.some(signature => source.includes(signature));
        } catch {
            return false;
        }
    }

    function collectPropertyNames(value, maxProtoDepth = 2) {
        const keys = new Set();
        let current = value;
        let depth = 0;

        while (current && depth <= maxProtoDepth) {
            try {
                for (const key of Object.getOwnPropertyNames(current)) keys.add(key);
            } catch { }
            current = Object.getPrototypeOf(current);
            depth++;
        }

        return Array.from(keys);
    }

    function keyLooksUploadRelated(key) {
        const keyLower = normalizeLower(key);
        return includesAny(keyLower, UPLOAD_KEY_HINTS);
    }

    function scoreUploadFunction(key, fn) {
        const keyLower = normalizeLower(key);
        let score = 0;

        if (key === "promptToUpload") score += 200;
        if (keyLower.includes("prompt")) score += 60;
        if (keyLower.includes("upload")) score += 60;
        if (keyLower.includes("attachment")) score += 30;
        if (keyLower.includes("file")) score += 20;
        if (functionContainsUploadSignature(fn)) score += 120;
        if (typeof fn.length === "number" && fn.length >= 1 && fn.length <= 5) score += 10;
        if (/^[A-Z0-9_]+$/.test(String(key)) && String(key).includes("_")) score -= 45;
        if (keyLower.includes("config") || keyLower.includes("limit") || keyLower.includes("roadblock") || keyLower.includes("error")) score -= 35;
        if (keyLower.startsWith("get") && !keyLower.includes("upload")) score -= 20;

        return score;
    }

    function getPromptCandidateFromObject(root) {
        if (!root || (typeof root !== "object" && typeof root !== "function")) return null;

        if (typeof root === "function") {
            const fnName = normalizeLower(root.name);
            if (fnName === "prompttoupload" || functionContainsUploadSignature(root)) {
                return { fn: root, ctx: null, key: root.name || "<function>", score: scoreUploadFunction(root.name || "<function>", root) };
            }
        }

        for (const name of UPLOAD_METHOD_NAMES) {
            try {
                const fn = root?.[name];
                if (typeof fn === "function") return { fn, ctx: root, key: name, score: scoreUploadFunction(name, fn) };
            } catch { }
        }

        const queue = [{ value: root, depth: 0 }];
        const seen = new Set();
        let scannedNodes = 0;

        while (queue.length && scannedNodes < 450) {
            scannedNodes++;
            const { value, depth } = queue.shift();
            if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
            if (seen.has(value)) continue;
            seen.add(value);

            const keys = collectPropertyNames(value, 1);

            for (const key of keys.slice(0, 180)) {
                let child;
                try {
                    child = value[key];
                } catch {
                    continue;
                }

                if (typeof child === "function") {
                    const uploadNameHint = keyLooksUploadRelated(key);
                    if (key === "promptToUpload" || (uploadNameHint && functionContainsUploadSignature(child)) || functionContainsUploadSignature(child)) {
                        return { fn: child, ctx: value, key, score: scoreUploadFunction(key, child) };
                    }
                } else if ((typeof child === "object" || typeof child === "function") && child && depth < 3) {
                    queue.push({ value: child, depth: depth + 1 });
                }
            }
        }

        return null;
    }

    function getMetroModuleEntries() {
        const modules = metro?.modules ?? globalThis?.modules;
        if (!modules) return [];
        if (modules instanceof Map) return Array.from(modules.entries());
        if (typeof modules === "object") return Object.entries(modules);
        return [];
    }

    function getInitializedModuleExports(entry) {
        if (!entry || typeof entry !== "object") return null;
        const exports = entry?.publicModule?.exports;
        return exports ?? null;
    }

    function getFactorySource(factory) {
        if (typeof factory !== "function") return "";
        try {
            return String(factory);
        } catch {
            return "";
        }
    }

    function hasUploadKeyHints(value) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
        if (typeof value === "function") {
            return functionContainsUploadSignature(value) || keyLooksUploadRelated(value.name);
        }

        const keys = collectPropertyNames(value, 1);

        for (const key of keys.slice(0, 80)) {
            if (UPLOAD_METHOD_NAMES.includes(key)) return true;
            if (keyLooksUploadRelated(key)) return true;
        }

        return false;
    }

    function createUploadCandidate(fn, ctx, key, sourceLabel) {
        return {
            fn,
            ctx: ctx ?? null,
            key: key || "<unknown>",
            source: sourceLabel || "unknown",
            score: scoreUploadFunction(key || "<unknown>", fn),
        };
    }

    function pushUploadCandidate(target, seen, candidate) {
        if (!candidate || typeof candidate.fn !== "function") return;
        if (seen.has(candidate.fn)) return;
        seen.add(candidate.fn);
        target.push(candidate);
    }

    function collectUploadFunctionsFromObject(root, sourceLabel, maxNodes = 280) {
        const out = [];
        const seenFns = new Set();
        if (!root || (typeof root !== "object" && typeof root !== "function")) return out;

        const queue = [{ value: root, depth: 0 }];
        const seenNodes = new Set();
        let scanned = 0;

        while (queue.length && scanned < maxNodes) {
            scanned++;
            const { value, depth } = queue.shift();
            if (!value || (typeof value !== "object" && typeof value !== "function")) continue;
            if (seenNodes.has(value)) continue;
            seenNodes.add(value);

            if (typeof value === "function") {
                const fnName = value.name || "<function>";
                if (keyLooksUploadRelated(fnName) || functionContainsUploadSignature(value)) {
                    pushUploadCandidate(out, seenFns, createUploadCandidate(value, null, fnName, sourceLabel));
                }
            }

            const keys = collectPropertyNames(value, 1);
            for (const key of keys.slice(0, 220)) {
                let child;
                try {
                    child = value[key];
                } catch {
                    continue;
                }

                if (typeof child === "function") {
                    if (keyLooksUploadRelated(key) || key === "promptToUpload" || functionContainsUploadSignature(child)) {
                        pushUploadCandidate(out, seenFns, createUploadCandidate(child, value, key, sourceLabel));
                    }
                } else if ((typeof child === "object" || typeof child === "function") && child && depth < 3) {
                    queue.push({ value: child, depth: depth + 1 });
                }
            }
        }

        return out;
    }

    function getMetroLookupCandidates() {
        const candidates = [];
        const append = (value, label) => {
            if (value == null) return;
            if (Array.isArray(value)) {
                value.forEach((item, index) => append(item, `${label}[${index}]`));
                return;
            }
            candidates.push({ value, label });
        };

        append(safeFind(() => metro.findByProps("promptToUpload")), "findByProps(promptToUpload)");
        append(safeFind(() => metro.findByProps("showUploadFileSizeExceededError", "promptToUpload")), "findByProps(showUploadFileSizeExceededError,promptToUpload)");
        append(safeFind(() => metro.findByProps("showUploadFileSizeExceededError")), "findByProps(showUploadFileSizeExceededError)");
        append(safeFind(() => metro.findByProps("promptToUpload", "showUploadDialog")), "findByProps(promptToUpload,showUploadDialog)");
        append(safeFind(() => metro.findByProps("showUploadDialog", "canUploadLongMessages")), "findByProps(showUploadDialog,canUploadLongMessages)");
        append(safeFind(() => metro.findByProps("showUploadDialog")), "findByProps(showUploadDialog)");
        append(safeFind(() => metro.findByProps("showLargeMessageDialog")), "findByProps(showLargeMessageDialog)");
        append(safeFind(() => metro.findByProps("clearAll", "addFile")), "findByProps(clearAll,addFile)");
        append(safeFind(() => metro.findByPropsAll("promptToUpload")), "findByPropsAll(promptToUpload)");
        append(safeFind(() => metro.findByPropsAll("showUploadFileSizeExceededError", "promptToUpload")), "findByPropsAll(showUploadFileSizeExceededError,promptToUpload)");
        append(safeFind(() => metro.findByName("promptToUpload", false)), "findByName(promptToUpload,false)");
        append(safeFind(() => metro.findByName("showUploadDialog", false)), "findByName(showUploadDialog,false)");
        append(safeFind(() => metro.find(candidate => hasUploadKeyHints(candidate))), "find(hasUploadKeyHints)");

        return candidates;
    }

    function getFactoryHintScore(factorySource) {
        if (!factorySource) return 0;
        const src = normalizeLower(factorySource);
        let score = 0;
        for (const hint of UPLOAD_KEY_HINTS) {
            if (src.includes(hint)) score += 1;
        }
        for (const signature of UPLOAD_SIGNATURES) {
            if (factorySource.includes(signature)) score += 3;
        }
        return score;
    }

    function buildUploadFunctionCandidates(force = false) {
        if (!force && Array.isArray(cachedUploadCandidates)) return cachedUploadCandidates;
        lastUploadLookupDiagnostics = "lookup started";
        const uploadCandidates = [];
        const seenFns = new Set();

        const directCandidates = getMetroLookupCandidates();
        for (const candidate of directCandidates) {
            const match = getPromptCandidateFromObject(candidate.value);
            if (match?.fn) {
                const directBoost = candidate.label.includes("showUploadFileSizeExceededError,promptToUpload")
                    ? 1200
                    : candidate.label.includes("findByProps(promptToUpload)")
                        ? 900
                        : 300;
                pushUploadCandidate(uploadCandidates, seenFns, {
                    ...createUploadCandidate(match.fn, match.ctx, match.key, candidate.label),
                    score: (match.score || 0) + directBoost,
                });
            }

            const discovered = collectUploadFunctionsFromObject(candidate.value, candidate.label, 200);
            for (const item of discovered) pushUploadCandidate(uploadCandidates, seenFns, item);
        }

        const moduleEntries = getMetroModuleEntries();
        let initializedWithHints = 0;
        let initializedScanned = 0;
        for (const [id, entry] of moduleEntries) {
            const exports = getInitializedModuleExports(entry);
            if (!exports || !hasUploadKeyHints(exports)) continue;
            initializedWithHints++;
            initializedScanned++;

            const label = `initialized-module:${id}`;
            const match = getPromptCandidateFromObject(exports) ?? getPromptCandidateFromObject(exports?.default);
            if (match?.fn) {
                pushUploadCandidate(uploadCandidates, seenFns, {
                    ...createUploadCandidate(match.fn, match.ctx, match.key, label),
                    score: (match.score || 0) + 220,
                });
            }

            const discovered = collectUploadFunctionsFromObject(exports, label, 160);
            for (const item of discovered) pushUploadCandidate(uploadCandidates, seenFns, item);
        }

        const metroRequire = typeof globalThis?.__r === "function" ? globalThis.__r : null;
        let requiredCandidateCount = 0;
        let requiredScanned = 0;
        if (metroRequire) {
            const candidateIds = [];

            for (const [id, entry] of moduleEntries) {
                if (!entry || typeof entry !== "object") continue;
                const source = getFactorySource(entry.factory);
                if (!source) continue;

                const hintScore = getFactoryHintScore(source);
                if (hintScore > 0) {
                    candidateIds.push({ id, hintScore });
                }
            }

            candidateIds.sort((a, b) => b.hintScore - a.hintScore);
            requiredCandidateCount = candidateIds.length;

            for (const candidateMeta of candidateIds.slice(0, 220)) {
                const id = candidateMeta.id;
                let exports;
                try {
                    exports = metroRequire(Number(id));
                } catch {
                    continue;
                }
                requiredScanned++;

                const label = `required-module:${id}`;
                const match = getPromptCandidateFromObject(exports) ?? getPromptCandidateFromObject(exports?.default);
                if (match?.fn) {
                    pushUploadCandidate(uploadCandidates, seenFns, {
                        ...createUploadCandidate(match.fn, match.ctx, match.key, label),
                        score: (match.score || 0) + 260 + (candidateMeta.hintScore || 0),
                    });
                }

                const discovered = collectUploadFunctionsFromObject(exports, label, 160);
                for (const item of discovered) pushUploadCandidate(uploadCandidates, seenFns, item);
            }
        }

        uploadCandidates.sort((a, b) => b.score - a.score);
        cachedUploadCandidates = uploadCandidates;

        const top = uploadCandidates.slice(0, 5).map(candidate =>
            `${candidate.key}@${candidate.source}[${candidate.score}]`,
        );
        const directLabels = directCandidates.map(candidate => candidate.label).slice(0, 6);

        lastUploadLookupDiagnostics = [
            `directCandidates=${directCandidates.length}`,
            `directLabels=${directLabels.join("|") || "none"}`,
            `initializedHintedModules=${initializedWithHints}`,
            `requiredFactoryCandidates=${requiredCandidateCount}`,
            `uploadFns=${uploadCandidates.length}`,
            `initializedScanned=${initializedScanned}`,
            `requiredScanned=${requiredScanned}`,
            `top=${top.join(",") || "none"}`,
        ].join(", ");

        logDebug("Upload lookup diagnostics", lastUploadLookupDiagnostics);
        return uploadCandidates;
    }

    function invokeUploadCandidate(candidate, uploadable, channel, channelId, draftType, fileName) {
        const fn = candidate?.fn;
        if (typeof fn !== "function") return Promise.reject(new Error("Invalid upload candidate."));

        const call = function () {
            return fn.apply(candidate.ctx ?? null, arguments);
        };
        const attempts = [
            () => call([uploadable], channel, 0),
            () => call([uploadable], channel, draftType),
            () => call([uploadable], channel),
            () => call([uploadable], channelId, 0),
            () => call([uploadable], channelId, draftType),
            () => call([uploadable], channelId),
            () => call(channel, [uploadable], draftType),
            () => call(channelId, [uploadable], draftType),
            () => call({
                channel,
                channelId,
                files: [uploadable],
                uploads: [uploadable],
                draftType,
            }),
            () => call({
                channel,
                files: [uploadable],
                draftType,
            }),
        ];

        const beforeUploads = getUploadsForChannel(channelId, draftType).length;
        const hasStore = Boolean(getUploadAttachmentStore());
        const primaryCandidate = isLikelyPrimaryUploaderCandidate(candidate);

        let lastError = null;
        return new Promise((resolve, reject) => {
            const runAttempt = index => {
                if (index >= attempts.length) {
                    reject(lastError instanceof Error ? lastError : new Error("All upload call signatures failed."));
                    return;
                }

                let result;
                try {
                    result = attempts[index]();
                } catch (error) {
                    lastError = error;
                    runAttempt(index + 1);
                    return;
                }

                Promise.resolve(result).then(() => {
                    if (primaryCandidate || !hasStore) {
                        resolve();
                        return;
                    }

                    const waitForUploadEntry = () => new Promise((res, rej) => {
                        const startedAt = Date.now();
                        const poll = () => {
                            const afterUploads = getUploadsForChannel(channelId, draftType).length;
                            const fileFound = hasUploadForFile(channelId, fileName, draftType);
                            if (fileFound || afterUploads > beforeUploads) {
                                res(true);
                                return;
                            }

                            if (Date.now() - startedAt >= 900) {
                                rej(new Error("No upload entry was created."));
                                return;
                            }

                            waitMs(120).then(poll).catch(rej);
                        };

                        waitMs(140).then(poll).catch(rej);
                    });

                    waitForUploadEntry()
                        .then(() => {
                            resolve();
                        })
                        .catch(error => {
                            lastError = error;
                            runAttempt(index + 1);
                        });
                }).catch(error => {
                    lastError = error;
                    runAttempt(index + 1);
                });
            };

            runAttempt(0);
        });
    }

    function getChannelMessageDraftType() {
        const DraftType = safeFind(() => metro.findByProps("ChannelMessage", "SlashCommand"));
        const value = DraftType?.ChannelMessage;
        return Number.isFinite(value) ? value : 0;
    }

    function normalizeBase64Payload(base64) {
        let normalized = String(base64 || "").trim();
        if (!normalized) return "";

        if (normalized.includes("%")) {
            try {
                normalized = decodeURIComponent(normalized);
            } catch { }
        }

        normalized = normalized
            .replace(/\s+/g, "")
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        const pad = normalized.length % 4;
        if (pad === 2) normalized += "==";
        else if (pad === 3) normalized += "=";
        else if (pad === 1) normalized = normalized.slice(0, normalized.length - 1);

        return normalized;
    }

    function decodeBase64ToBytes(base64) {
        const normalized = normalizeBase64Payload(base64);
        if (!normalized) return new Uint8Array();

        if (typeof atob === "function") {
            try {
                const binary = atob(normalized);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes;
            } catch { }
        }

        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const out = [];
        let buffer = 0;
        let bits = 0;

        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            if (ch === "=") break;
            const value = alphabet.indexOf(ch);
            if (value < 0) continue;

            buffer = (buffer << 6) | value;
            bits += 6;

            if (bits >= 8) {
                bits -= 8;
                out.push((buffer >> bits) & 0xff);
            }
        }

        return new Uint8Array(out);
    }

    function encodeBytesToBase64(bytes) {
        if (!bytes || !bytes.length) return "";

        if (typeof btoa === "function") {
            try {
                let binary = "";
                const chunkSize = 0x8000;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    const chunk = bytes.subarray(i, i + chunkSize);
                    binary += String.fromCharCode.apply(null, Array.from(chunk));
                }
                return btoa(binary);
            } catch { }
        }

        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let output = "";
        let i = 0;

        for (; i + 2 < bytes.length; i += 3) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            output += alphabet[(n >> 18) & 63];
            output += alphabet[(n >> 12) & 63];
            output += alphabet[(n >> 6) & 63];
            output += alphabet[n & 63];
        }

        const remaining = bytes.length - i;
        if (remaining === 1) {
            const n = bytes[i] << 16;
            output += alphabet[(n >> 18) & 63];
            output += alphabet[(n >> 12) & 63];
            output += "==";
        } else if (remaining === 2) {
            const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
            output += alphabet[(n >> 18) & 63];
            output += alphabet[(n >> 12) & 63];
            output += alphabet[(n >> 6) & 63];
            output += "=";
        }

        return output;
    }

    function parseDataUrl(dataUrl) {
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
        const commaIndex = dataUrl.indexOf(",");
        if (commaIndex < 0) return null;

        const meta = dataUrl.slice(5, commaIndex);
        const body = dataUrl.slice(commaIndex + 1);
        const isBase64 = meta.includes(";base64");
        const mime = (meta.split(";")[0] || "image/png").trim() || "image/png";

        return {
            meta,
            body,
            isBase64,
            mime,
            normalized: `data:${meta},${body}`,
        };
    }

    function makeUriUploadable(uri, mimeType, fileName) {
        return {
            uri,
            name: fileName,
            fileName,
            filename: fileName,
            mimeType: String(mimeType || "image/png"),
            type: String(mimeType || "image/png"),
        };
    }

    function decorateBlobUploadable(blob, mimeType, fileName, fallbackUri) {
        if (!blob) return fallbackUri ? makeUriUploadable(fallbackUri, mimeType, fileName) : null;
        const mime = String(mimeType || blob.type || "image/png");

        if (typeof File === "function") {
            try {
                return new File([blob], fileName, { type: mime });
            } catch (error) {
                logDebug("File constructor failed; falling back to blob object", String(error));
            }
        }

        try {
            return Object.assign(blob, {
                name: fileName,
                fileName,
                filename: fileName,
                mimeType: mime,
                type: mime,
            });
        } catch (error) {
            logDebug("Blob decoration failed; falling back to URI uploadable", String(error));
            return fallbackUri ? makeUriUploadable(fallbackUri, mime, fileName) : null;
        }
    }

    function bytesToUploadable(bytes, mimeType, fileName) {
        if (!bytes || !bytes.length) return null;
        const mime = String(mimeType || "image/png");
        const base64 = encodeBytesToBase64(bytes);
        if (!base64) return null;
        return makeUriUploadable(`data:${mime};base64,${base64}`, mime, fileName);
    }

    function dataUrlToUploadable(dataUrl, fileName) {
        const parsed = parseDataUrl(dataUrl);
        if (!parsed) return Promise.resolve(null);

        const tryDecode = () => {
            let bytes = null;
            if (parsed.isBase64) {
                const decoded = decodeBase64ToBytes(parsed.body);
                if (decoded && decoded.length) bytes = decoded;
            } else {
                try {
                    const text = decodeURIComponent(parsed.body);
                    if (typeof TextEncoder === "function") {
                        bytes = new TextEncoder().encode(text);
                    } else {
                        const arr = new Uint8Array(text.length);
                        for (let i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i) & 0xff;
                        bytes = arr;
                    }
                } catch { }
            }

            return bytesToUploadable(bytes, parsed.mime, fileName);
        };

        const tryFetch = () => {
            if (typeof fetch !== "function") return Promise.resolve(null);
            return Promise.resolve(fetch(parsed.normalized)).then(response => {
                if (!response || response.ok === false) return null;
                if (typeof response.blob !== "function") return null;
                return Promise.resolve(response.blob()).then(blob => {
                    if (!blob) return null;
                    const mime = blob.type || parsed.mime || "image/png";
                    return decorateBlobUploadable(blob, mime, fileName, parsed.normalized);
                }).catch(() => null);
            }).catch(() => null);
        };

        return tryFetch().then(uploadable => uploadable ?? tryDecode() ?? makeUriUploadable(parsed.normalized, parsed.mime, fileName));
    }

    function resolveChannel(channelId) {
        const channelModule = getChannelModule();
        if (!channelModule) return channelId ? { id: channelId } : null;

        const candidates = [
            channelModule?.getChannel?.(channelId),
            channelModule?.getDMFromUserId?.(channelId),
        ];

        for (const channel of candidates) {
            if (channel && typeof channel === "object") return channel;
        }

        return null;
    }

    function getUploadAttachmentStore() {
        return safeFind(() => (typeof metro.findByStoreName === "function" ? metro.findByStoreName("UploadAttachmentStore") : null));
    }

    function getUploadsForChannel(channelId, draftType = 0) {
        const store = getUploadAttachmentStore();
        if (!store || typeof store.getUploads !== "function") return [];

        let uploads = [];
        try {
            uploads = store.getUploads(channelId, draftType);
        } catch {
            try {
                uploads = store.getUploads(channelId);
            } catch {
                uploads = [];
            }
        }

        return Array.isArray(uploads) ? uploads : [];
    }

    function hasUploadForFile(channelId, fileName, draftType = 0) {
        if (!channelId || !fileName) return false;

        const uploads = getUploadsForChannel(channelId, draftType);
        for (const upload of uploads) {
            if (!upload || typeof upload !== "object") continue;
            if (upload.filename === fileName || upload.name === fileName) return true;

            const item = upload.item;
            if (item && typeof item === "object") {
                if (item.fileName === fileName || item.filename === fileName || item.name === fileName) return true;
                const uri = String(item.uri || "");
                if (uri.endsWith(`/${fileName}`)) return true;
            }
        }

        return false;
    }

    function waitMs(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isLikelyPrimaryUploaderCandidate(candidate) {
        const key = normalizeLower(candidate?.key || "");
        const source = normalizeLower(candidate?.source || "");
        if (key === "prompttoupload") return true;
        if (key.includes("message_create_attachment_upload")) return true;
        if (key.includes("instantbatchupload")) return true;
        if (source.includes("showuploadfilesizeexceedederror,prompttoupload")) return true;
        if (source.includes("findbyprops(prompttoupload)")) return true;

        try {
            const text = String(candidate?.fn || "");
            return text.includes("Unexpected mismatch between files and file metadata");
        } catch {
            return false;
        }
    }

    function shouldSkipUploadCandidate(candidate) {
        const key = normalizeLower(candidate?.key || "");
        if (!key) return false;
        if (key.startsWith("can") || key.startsWith("is") || key.startsWith("get") || key.startsWith("set") || key.startsWith("use")) {
            return !key.includes("upload");
        }
        if (key.includes("config") || key.includes("limit") || key.includes("roadblock") || key.includes("error")) {
            return true;
        }
        return false;
    }

    function getUploadManager() {
        return safeFind(() => metro.findByProps("clearAll", "addFile"));
    }

    function getMessageActionsModule() {
        return safeFind(() => metro.findByProps("sendMessage", "receiveMessage"))
            ?? safeFind(() => metro.findByProps("sendMessage", "editMessage"))
            ?? safeFind(() => metro.findByProps("sendMessage"));
    }

    function trySendDraftWithAttachment(channelId) {
        const MessageActions = getMessageActionsModule();
        if (!MessageActions || typeof MessageActions.sendMessage !== "function") {
            return Promise.reject(new Error("sendMessage handler unavailable."));
        }

        const payload = {
            content: "",
            tts: false,
            invalidEmojis: [],
            validNonShortcutEmojis: [],
        };

        const attempts = [
            () => MessageActions.sendMessage(channelId, payload, false, { nonce: Date.now().toString() }),
            () => MessageActions.sendMessage(channelId, payload, true, { nonce: Date.now().toString() }),
            () => MessageActions.sendMessage(channelId, payload),
        ];

        let lastError = null;
        for (const attempt of attempts) {
            try {
                return Promise.resolve(attempt());
            } catch (error) {
                lastError = error;
            }
        }

        return Promise.reject(lastError instanceof Error ? lastError : new Error("Unable to dispatch sendMessage."));
    }

    function tryUploadViaUploadManager(uploadable, channel, channelId, draftType, fileName) {
        const manager = getUploadManager();
        if (!manager || typeof manager.addFile !== "function") {
            return Promise.reject(new Error("UploadManager.addFile is unavailable."));
        }

        const candidate = createUploadCandidate(manager.addFile, manager, "addFile", "UploadManager");
        return invokeUploadCandidate(candidate, uploadable, channel, channelId, draftType, fileName).then(() => {
            return waitMs(120).then(() => {
                if (!hasUploadForFile(channelId, fileName, draftType)) {
                    throw new Error("UploadManager did not create a file upload entry.");
                }
            }).then(() => trySendDraftWithAttachment(channelId));
        });
    }

    function invokePromptUploadDirect(candidate, uploadable, channel, channelId, draftType) {
        const fn = candidate?.fn;
        if (typeof fn !== "function") return Promise.reject(new Error("Invalid upload candidate."));

        const call = function () {
            return fn.apply(candidate.ctx ?? null, arguments);
        };
        const attempts = [
            () => call([uploadable], channel, draftType),
            () => call([uploadable], channel, 0),
            () => call([uploadable], channel),
            () => call([uploadable], channelId, draftType),
            () => call([uploadable], channelId, 0),
            () => call([uploadable], channelId),
        ];

        let lastError = null;
        for (const attempt of attempts) {
            try {
                return Promise.resolve(attempt());
            } catch (error) {
                lastError = error;
            }
        }

        return Promise.reject(lastError instanceof Error ? lastError : new Error("Failed to invoke promptToUpload."));
    }

    function sendGeneratedImage(message, dataUrl) {
        const uploadCandidates = buildUploadFunctionCandidates(true).slice();
        if (!uploadCandidates.length) {
            return Promise.reject(new Error(`Upload handler unavailable on this build. ${lastUploadLookupDiagnostics}`));
        }

        const channelId = getMessageChannelId(message);
        if (!channelId) return Promise.reject(new Error("Unable to resolve message channel."));

        const channel = resolveChannel(channelId);
        if (!channel) return Promise.reject(new Error("Unable to resolve channel object."));

        const fileName = buildFileName(message);
        return Promise.resolve(dataUrlToUploadable(dataUrl, fileName)).then(uploadable => {
            if (!uploadable) throw new Error("Invalid rendered quote image.");

            const draftType = getChannelMessageDraftType();
            const primaryCandidates = uploadCandidates
                .filter(isLikelyPrimaryUploaderCandidate)
                .filter(candidate => !shouldSkipUploadCandidate(candidate));
            const secondaryCandidates = uploadCandidates
                .filter(candidate => !isLikelyPrimaryUploaderCandidate(candidate))
                .filter(candidate => !shouldSkipUploadCandidate(candidate));
            const rankedCandidates = [...primaryCandidates, ...secondaryCandidates].slice(0, 80);

            if (!rankedCandidates.length) {
                throw new Error(`Upload handler unavailable on this build. ${lastUploadLookupDiagnostics}`);
            }

            logDebug("Send quote using upload candidates", rankedCandidates.map(c => `${c.key}@${c.source}[${c.score}]`).join(", "));

            return new Promise((resolve, reject) => {
                let index = 0;
                let lastError = null;
                const shortErrors = [];

                const run = () => {
                    if (index >= rankedCandidates.length) {
                        const detail = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
                        const summary = shortErrors.length ? ` tried=${shortErrors.join(" | ")}` : "";
                        reject(new Error(`Upload handler invocation failed: ${detail}.${summary} ${lastUploadLookupDiagnostics}`));
                        return;
                    }

                    const candidate = rankedCandidates[index++];
                    invokeUploadCandidate(candidate, uploadable, channel, channelId, draftType, fileName).then(() => {
                        logDebug("Upload candidate succeeded", `${candidate.key}@${candidate.source}[${candidate.score}]`);
                        resolve();
                    }).catch(error => {
                        lastError = error;
                        const msg = error instanceof Error ? error.message : String(error);
                        if (shortErrors.length < 6) shortErrors.push(`${candidate.key}:${msg}`);
                        run();
                    });
                };

                run();
            });
        });
    }

    function QuotePreviewCard({ message, onStateChange }) {
        const [options, setLocalOptions] = React.useState(getOptions);
        const [dataUrl, setDataUrl] = React.useState("");
        const [error, setError] = React.useState("");

        const renderId = React.useMemo(
            () => `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            [message, options.grayscale, options.showWatermark, options.watermark],
        );

        const payload = React.useMemo(
            () => ({
                ...buildPayload(message, options),
                renderId,
            }),
            [message, options.grayscale, options.showWatermark, options.watermark, renderId],
        );

        const html = React.useMemo(() => buildRendererHtml(payload), [payload]);

        React.useEffect(() => {
            setOptions(options);
        }, [options]);

        React.useEffect(() => {
            setDataUrl("");
            setError("");
        }, [renderId]);

        React.useEffect(() => {
            onStateChange?.({
                dataUrl,
                options,
            });
        }, [dataUrl, options, onStateChange]);

        const setOption = (key, value) => {
            setLocalOptions(current => ({ ...current, [key]: value }));
        };

        const onWebViewMessage = event => {
            const raw = event?.nativeEvent?.data;
            if (typeof raw !== "string") return;

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                return;
            }

            if (parsed?.renderId !== renderId) return;

            if (parsed.type === "result" && typeof parsed.dataUrl === "string") {
                setDataUrl(parsed.dataUrl);
                setError("");
                return;
            }

            if (parsed.type === "error") {
                setError(String(parsed.message || "Failed to render quote image."));
            }
        };

        const previewWidth = Math.max(
            230,
            Math.min((ReactNative?.Dimensions?.get?.("window")?.width ?? 360) - 88, 420),
        );
        const previewHeight = Math.round(previewWidth * (CANVAS_CONFIG.height / CANVAS_CONFIG.width));

        return React.createElement(
            ReactNative.ScrollView,
            {
                style: { maxHeight: 470 },
                contentContainerStyle: { paddingTop: 10, paddingBottom: 4 },
            },
            [
                React.createElement(
                    ReactNative.View,
                    {
                        key: "quote-preview-wrap",
                        style: {
                            width: previewWidth,
                            height: previewHeight,
                            alignSelf: "center",
                            borderRadius: 14,
                            overflow: "hidden",
                            backgroundColor: "#0f0f0f",
                            justifyContent: "center",
                            alignItems: "center",
                        },
                    },
                    dataUrl
                        ? React.createElement(ReactNative.Image, {
                            source: { uri: dataUrl },
                            resizeMode: "cover",
                            style: {
                                width: "100%",
                                height: "100%",
                            },
                        })
                        : React.createElement(ReactNative.Text, {
                            style: {
                                color: "#bbb",
                                textAlign: "center",
                                fontSize: 12,
                                paddingHorizontal: 12,
                            },
                        }, "Generating preview..."),
                ),
                WebView
                    ? React.createElement(WebView, {
                        key: `quote-renderer-${renderId}`,
                        source: {
                            html,
                            baseUrl: "https://localhost",
                        },
                        javaScriptEnabled: true,
                        domStorageEnabled: true,
                        onMessage: onWebViewMessage,
                        style: {
                            width: 1,
                            height: 1,
                            opacity: 0,
                            position: "absolute",
                            left: -9999,
                            top: -9999,
                        },
                    })
                    : null,
                React.createElement(
                    ReactNative.Text,
                    {
                        key: "quote-preview-caption",
                        style: {
                            color: "#aaa",
                            marginTop: 8,
                            textAlign: "center",
                            fontSize: 12,
                        },
                    },
                    "Preview generated from selected message",
                ),
                error
                    ? React.createElement(
                        ReactNative.Text,
                        {
                            key: "quote-preview-error",
                            style: {
                                color: "#f66",
                                marginTop: 8,
                                textAlign: "center",
                                fontSize: 12,
                            },
                        },
                        error,
                    )
                    : null,
                React.createElement(
                    ReactNative.View,
                    {
                        key: "toggle-grayscale",
                        style: {
                            marginTop: 10,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                        },
                    },
                    [
                        React.createElement(ReactNative.Text, { style: { color: "#fff", fontSize: 15 } }, "Grayscale"),
                        ReactNative.Switch
                            ? React.createElement(ReactNative.Switch, {
                                value: options.grayscale,
                                onValueChange: value => setOption("grayscale", value),
                            })
                            : React.createElement(
                                ReactNative.Pressable,
                                { onPress: () => setOption("grayscale", !options.grayscale) },
                                React.createElement(
                                    ReactNative.Text,
                                    { style: { color: "#fff", fontSize: 13 } },
                                    options.grayscale ? "ON" : "OFF",
                                ),
                            ),
                    ],
                ),
                React.createElement(
                    ReactNative.View,
                    {
                        key: "toggle-watermark",
                        style: {
                            marginTop: 10,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                        },
                    },
                    [
                        React.createElement(ReactNative.Text, { style: { color: "#fff", fontSize: 15 } }, "Show Watermark"),
                        ReactNative.Switch
                            ? React.createElement(ReactNative.Switch, {
                                value: options.showWatermark,
                                onValueChange: value => setOption("showWatermark", value),
                            })
                            : React.createElement(
                                ReactNative.Pressable,
                                { onPress: () => setOption("showWatermark", !options.showWatermark) },
                                React.createElement(
                                    ReactNative.Text,
                                    { style: { color: "#fff", fontSize: 13 } },
                                    options.showWatermark ? "ON" : "OFF",
                                ),
                            ),
                    ],
                ),
                options.showWatermark
                    ? React.createElement(ReactNative.TextInput, {
                        key: "watermark-input",
                        value: options.watermark,
                        onChangeText: value => setOption("watermark", value),
                        placeholder: "Watermark text (max 32 characters)",
                        placeholderTextColor: "#666",
                        maxLength: 32,
                        style: {
                            color: "#fff",
                            borderWidth: 1,
                            borderColor: "#444",
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            marginTop: 10,
                        },
                    })
                    : null,
            ],
        );
    }

    function openQuoteModal(message) {
        let modalState = {
            dataUrl: "",
            options: getOptions(),
        };

        showConfirmationAlert({
            title: "Create Quote",
            content: "Generate and send quote image.",
            children: React.createElement(QuotePreviewCard, {
                message,
                onStateChange: state => {
                    if (state && typeof state === "object") {
                        modalState = {
                            ...modalState,
                            ...state,
                        };
                    }
                },
            }),
            confirmText: "Send",
            cancelText: "Cancel",
            onConfirm: () => {
                if (!modalState.dataUrl) {
                    errorToast("Failed to send quote: Quote image is not ready yet.");
                    return;
                }

                sendGeneratedImage(message, modalState.dataUrl).then(() => {
                    toast("Quote sent as image.");
                }).catch(error => {
                    const msg = error instanceof Error ? error.message : String(error);
                    errorToast(`Failed to send quote: ${msg}`);
                });
            },
        });
    }

    function injectQuoteButton(sheetTree, message) {
        const rows = findInReactTree(sheetTree, node =>
            Array.isArray(node) && (
                node[0]?.type?.name === "ButtonRow"
                || node[0]?.type?.name === "ActionSheetRow"
                || node[0]?.type?.name === "TableRow"
            ),
        );

        if (!rows || !Array.isArray(rows)) return sheetTree;
        if (rows.some(row => String(row?.props?.message ?? row?.props?.label ?? "") === "Quote")) return sheetTree;

        const template = rows.find(Boolean);
        if (!template?.type) return sheetTree;

        const icon = getAssetIDByName("ChatXIcon") ?? template.props?.icon;
        const onPress = () => {
            try {
                LazyActionSheet?.hideActionSheet?.();
            } catch { }
            setTimeout(() => openQuoteModal(message), 0);
        };

        const quoteRow = React.createElement(template.type, {
            ...template.props,
            key: "kettu-quoter-button",
            label: "Quote",
            message: "Quote",
            title: "Quote",
            text: "Quote",
            icon,
            isDestructive: false,
            variant: undefined,
            onPress,
            action: onPress,
        });

        const index = Math.max(
            rows.findIndex(row => {
                const label = String(row?.props?.message ?? row?.props?.label ?? row?.props?.title ?? "");
                return label === "Mark Unread";
            }),
            0,
        );

        rows.splice(index, 0, quoteRow);
        return sheetTree;
    }

    function patchMessageLongPressSheet() {
        if (!LazyActionSheet || typeof LazyActionSheet.openLazy !== "function") {
            throw new Error("Action sheet module unavailable.");
        }

        const unpatch = vendetta.patcher.before("openLazy", LazyActionSheet, ([component, key, ctx]) => {
            const message = ctx?.message;
            if (key !== "MessageLongPressActionSheet" || !message?.content) return;

            Promise.resolve(component).then(mod => {
                if (!mod || typeof mod.default !== "function") return;

                const unpatchRender = vendetta.patcher.after("default", mod, (_, sheetTree) => {
                    React.useEffect(() => () => unpatchRender(), []);
                    return injectQuoteButton(sheetTree, message);
                });
            }).catch(() => { });
        });

        patches.push(unpatch);
    }

    function SettingsPanel() {
        const h = React.createElement;
        const [, forceUpdate] = React.useReducer(value => value + 1, 0);

        const setValue = (key, value) => {
            storage[key] = value;
            forceUpdate();
        };

        const textStyle = { color: "#fff", fontSize: 16, marginBottom: 6 };
        const hintStyle = { color: "#999", fontSize: 13, marginBottom: 14 };
        const inputStyle = {
            color: "#fff",
            borderWidth: 1,
            borderColor: "#444",
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 14,
        };

        const sectionTitle = (title, hint) => h(ReactNative.View, { style: { marginBottom: 4 } }, [
            h(ReactNative.Text, { style: textStyle }, title),
            hint ? h(ReactNative.Text, { style: hintStyle }, hint) : null,
        ]);

        const toggleRow = (title, key) => h(
            ReactNative.View,
            {
                style: {
                    marginBottom: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                },
            },
            [
                h(ReactNative.Text, { style: { color: "#fff", fontSize: 16 } }, title),
                ReactNative.Switch
                    ? h(ReactNative.Switch, {
                        value: Boolean(storage[key]),
                        onValueChange: value => setValue(key, value),
                    })
                    : h(
                        ReactNative.Pressable,
                        {
                            onPress: () => setValue(key, !storage[key]),
                            style: {
                                borderWidth: 1,
                                borderColor: "#666",
                                borderRadius: 6,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                            },
                        },
                        h(
                            ReactNative.Text,
                            { style: { color: "#fff", fontSize: 13 } },
                            Boolean(storage[key]) ? "ON" : "OFF",
                        ),
                    ),
            ],
        );

        return h(
            ReactNative.ScrollView,
            {
                contentContainerStyle: {
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    gap: 2,
                },
            },
            [
                sectionTitle(
                    "Watermark Text",
                    "Only used when watermark is enabled. Max 32 chars.",
                ),
                h(ReactNative.TextInput, {
                    value: String(storage.watermark ?? ""),
                    onChangeText: value => setValue("watermark", value),
                    autoCapitalize: "sentences",
                    autoCorrect: false,
                    style: inputStyle,
                    placeholder: "Made with Kettu",
                    placeholderTextColor: "#666",
                    maxLength: 64,
                }),
                toggleRow("Grayscale", "grayscale"),
                toggleRow("Show Watermark", "showWatermark"),
            ],
        );
    }

    return {
        onLoad() {
            try {
                ensureDefaults();
                patchMessageLongPressSheet();
                logDebug("Plugin loaded", `build=${BUILD_ID}`);
                toast(`Quoter loaded (${BUILD_ID}).`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errorToast(`Quoter failed to load: ${msg}`);
                throw error;
            }
        },

        onUnload() {
            while (patches.length) {
                try {
                    patches.pop()?.();
                } catch { }
            }
        },

        settings: SettingsPanel,
    };
})();
