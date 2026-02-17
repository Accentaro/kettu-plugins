(() => {
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

    function parseDataUrl(dataUrl) {
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
        const commaIndex = dataUrl.indexOf(",");
        if (commaIndex < 0) return null;

        const meta = dataUrl.slice(5, commaIndex);
        const body = dataUrl.slice(commaIndex + 1);
        const isBase64 = meta.includes(";base64");
        const mime = (meta.split(";")[0] || "image/png").trim() || "image/png";

        return { body, isBase64, mime };
    }

    // --- Upload + Send ---

    function getNativeFileModule() {
        const nmp = window.nativeModuleProxy;
        if (!nmp) return null;
        return nmp.NativeFileModule || nmp.RTNFileManager || nmp.DCDFileManager || null;
    }

    function getUploadModule() {
        try {
            return metro.findByProps("clearAll", "addFile");
        } catch {
            return null;
        }
    }

    function getPromptUploadModule() {
        try {
            return metro.findByProps("promptToUpload")
                ?? metro.findByProps("showUploadFileSizeExceededError", "promptToUpload")
                ?? metro.findByProps("showUploadDialog", "promptToUpload")
                ?? metro.find(module => typeof module?.promptToUpload === "function");
        } catch {
            return null;
        }
    }

    function getUploadStore() {
        try {
            return (typeof metro.findByStoreName === "function"
                ? metro.findByStoreName("UploadAttachmentStore")
                : null)
                ?? metro.findByProps("getUploads", "getUpload");
        } catch {
            return null;
        }
    }

    function getInstantBatchUploader() {
        try {
            return metro.find(module => module?.upload && typeof module?.instantBatchUpload === "function")
                ?? metro.findByProps("instantBatchUpload");
        } catch {
            return null;
        }
    }

    function getChannelStore() {
        try {
            return (typeof metro.findByStoreName === "function"
                ? metro.findByStoreName("ChannelStore")
                : null)
                ?? metro.findByProps("getChannel", "getDMFromUserId")
                ?? metro.findByProps("getChannel");
        } catch {
            return null;
        }
    }

    function resolveChannel(channelId) {
        const store = getChannelStore();
        if (!store || typeof store.getChannel !== "function") return channelId;
        try {
            return store.getChannel(channelId) ?? channelId;
        } catch {
            return channelId;
        }
    }

    function getDraftType() {
        try {
            const DraftType = metro.findByProps("ChannelMessage", "SlashCommand");
            const value = DraftType?.ChannelMessage;
            return Number.isFinite(value) ? value : 0;
        } catch {
            return 0;
        }
    }

    function getMessageActions() {
        if (common?.messageUtil?.sendMessage) return common.messageUtil;

        try {
            return metro.findByProps("sendMessage", "editMessage")
                ?? metro.findByProps("sendMessage", "receiveMessage")
                ?? metro.findByProps("sendMessage");
        } catch {
            return null;
        }
    }

    function getMessageStore() {
        try {
            return (typeof metro.findByStoreName === "function"
                ? metro.findByStoreName("MessageStore")
                : null)
                ?? metro.findByProps("getMessages", "getMessage");
        } catch {
            return null;
        }
    }

    function cleanupTempFile(fileModule, tempPath) {
        try {
            const maybePromise = fileModule?.removeFile?.("cache", tempPath);
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise.catch(() => { });
            }
        } catch { }
    }

    function invokeInstantBatchUpload(instantUploader, channelId, draftType, uploadable) {
        const fn = instantUploader?.instantBatchUpload;
        if (typeof fn !== "function") throw new Error("instantBatchUpload unavailable.");

        if (fn.length === 3) {
            fn(channelId, [uploadable], false);
            return;
        }

        fn({
            channelId,
            draftType,
            files: [uploadable],
            isThumbnail: false,
            isClip: false,
        });
    }

    function getUploadAttempts(promptUploadModule, uploadModule, instantUploader, channel, channelId, draftType, uploadable) {
        const promptToUpload = promptUploadModule?.promptToUpload;
        const addFile = uploadModule?.addFile;
        return [
            ...(typeof promptToUpload === "function" ? [
                () => promptToUpload([uploadable], channel, draftType),
                () => promptToUpload([uploadable], channel, 0),
                () => promptToUpload([uploadable], channel),
                () => promptToUpload([uploadable], channelId, draftType),
                () => promptToUpload([uploadable], channelId, 0),
                () => promptToUpload([uploadable], channelId),
            ] : []),
            ...(typeof addFile === "function" ? [
                () => addFile(channelId, draftType, uploadable),
                () => addFile(channelId, uploadable, draftType),
                () => addFile(channelId, uploadable),
                () => addFile(channel, draftType, uploadable),
                () => addFile(channel, uploadable, draftType),
                () => addFile(channel, uploadable),
                () => addFile(uploadable, channelId, draftType),
                () => addFile({ channelId, draftType, file: uploadable }),
                () => addFile({ channel, channelId, draftType, file: uploadable }),
                () => addFile({ channelId, draftType, files: [uploadable] }),
            ] : []),
            ...(typeof instantUploader?.instantBatchUpload === "function" ? [
                () => invokeInstantBatchUpload(instantUploader, channelId, draftType, uploadable),
            ] : []),
        ];
    }

    function getUploads(uploadStore, channelId, draftType = 0) {
        if (!uploadStore || typeof uploadStore.getUploads !== "function") return [];

        const collected = [];
        const seen = new Set();
        const pushUploads = uploads => {
            if (!Array.isArray(uploads)) return;
            for (const upload of uploads) {
                if (!upload || seen.has(upload)) continue;
                seen.add(upload);
                collected.push(upload);
            }
        };
        const readByType = type => {
            try {
                pushUploads(uploadStore.getUploads(channelId, type));
            } catch { }
        };

        readByType(draftType);
        readByType(0);
        readByType(1);
        readByType(2);
        readByType(3);
        try {
            pushUploads(uploadStore.getUploads(channelId));
        } catch { }

        return collected;
    }

    function waitForUploadEntry(uploadStore, channelId, fileName, draftType, beforeCount, tempName) {
        if (!uploadStore || typeof uploadStore.getUploads !== "function") {
            return Promise.resolve(false);
        }

        const started = Date.now();
        return new Promise(resolve => {
            const poll = () => {
                const uploads = getUploads(uploadStore, channelId, draftType);
                const hasEntry = uploads.some(upload => {
                    if (!upload || typeof upload !== "object") return false;
                    if (upload.filename === fileName || upload.name === fileName) return true;

                    const item = upload.item;
                    if (!item || typeof item !== "object") return false;

                    const uri = String(item.uri || "");
                    return item.fileName === fileName
                        || item.filename === fileName
                        || item.name === fileName
                        || uri.includes(fileName)
                        || (tempName && uri.includes(tempName));
                });
                const hasNewEntry = uploads.length > beforeCount;

                if (hasEntry || hasNewEntry || Date.now() - started >= 1800) {
                    resolve(hasEntry || hasNewEntry);
                    return;
                }

                setTimeout(poll, 100);
            };

            setTimeout(poll, 100);
        });
    }

    function getChannelMessages(messageStore, channelId) {
        if (!messageStore || typeof messageStore.getMessages !== "function") return [];

        let messages;
        try {
            messages = messageStore.getMessages(channelId);
        } catch {
            return [];
        }

        if (!messages) return [];
        if (Array.isArray(messages)) return messages;
        if (Array.isArray(messages._array)) return messages._array;

        try {
            if (typeof messages.toArray === "function") {
                const arrayValue = messages.toArray();
                if (Array.isArray(arrayValue)) return arrayValue;
            }
        } catch { }

        try {
            if (typeof messages.values === "function") return Array.from(messages.values());
        } catch { }

        return [];
    }

    function waitForMessageByNonce(messageStore, channelId, nonce, timeoutMs = 4500) {
        if (!messageStore || typeof messageStore.getMessages !== "function") {
            return Promise.resolve(null);
        }

        const started = Date.now();
        return new Promise(resolve => {
            const poll = () => {
                const found = getChannelMessages(messageStore, channelId).find(message =>
                    String(message?.nonce ?? "") === nonce,
                );

                if (found || Date.now() - started >= timeoutMs) {
                    resolve(found ?? null);
                    return;
                }

                setTimeout(poll, 120);
            };

            setTimeout(poll, 120);
        });
    }

    function invokeSendMessage(messageActions, messageStore, channelId) {
        const payload = {
            content: "",
            tts: false,
            invalidEmojis: [],
            validNonShortcutEmojis: [],
        };
        const nonce = Date.now().toString();

        const send = args => Promise.resolve(messageActions.sendMessage(...args)).then(result => {
            if (result && typeof result === "object" && result.ok === false) {
                throw new Error("sendMessage returned ok=false.");
            }
            return result;
        });

        return send([channelId, payload, void 0, { nonce }])
            .catch(() => send([channelId, payload, false, { nonce }]))
            .then(() => waitForMessageByNonce(messageStore, channelId, nonce))
            .then(message => {
                if (!message) throw new Error("Message dispatch was not observed.");
                return message;
            });
    }

    function sendGeneratedImage(message, dataUrl) {
        const channelId = getMessageChannelId(message);
        if (!channelId) return Promise.reject(new Error("Unable to resolve message channel."));

        const parsed = parseDataUrl(dataUrl);
        if (!parsed || !parsed.isBase64 || !parsed.body) {
            return Promise.reject(new Error("Invalid rendered quote image."));
        }

        const fileName = buildFileName(message);
        const mime = parsed.mime || "image/png";
        const fileModule = getNativeFileModule();
        const promptUploadModule = getPromptUploadModule();
        const uploadModule = getUploadModule();
        const instantUploader = getInstantBatchUploader();
        const uploadStore = getUploadStore();
        const messageActions = getMessageActions();
        const messageStore = getMessageStore();
        const draftType = getDraftType();

        if (!fileModule) return Promise.reject(new Error("NativeFileModule unavailable."));
        if ((!promptUploadModule || typeof promptUploadModule.promptToUpload !== "function")
            && (!uploadModule || typeof uploadModule.addFile !== "function")
            && (!instantUploader || typeof instantUploader.instantBatchUpload !== "function")) {
            return Promise.reject(new Error("Upload module unavailable."));
        }
        if (!messageActions || typeof messageActions.sendMessage !== "function") {
            return Promise.reject(new Error("sendMessage unavailable."));
        }

        const tempPath = `kettu-quoter/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
        const tempName = tempPath.split("/").pop() || "";
        const channel = resolveChannel(channelId);

        return fileModule.writeFile("cache", tempPath, parsed.body, "base64").then(filePath => {
            const normalizedPath = String(filePath || "");
            if (!normalizedPath) throw new Error("Failed to write rendered image.");

            const uri = normalizedPath.startsWith("file://") ? normalizedPath : `file://${normalizedPath}`;
            const uploadable = {
                uri,
                type: mime,
                name: fileName,
                filename: fileName,
                fileName,
                mimeType: mime,
            };

            const attempts = getUploadAttempts(
                promptUploadModule,
                uploadModule,
                instantUploader,
                channel,
                channelId,
                draftType,
                uploadable,
            );
            if (!attempts.length) throw new Error("Upload module unavailable.");

            let index = 0;
            let lastError = null;

            const run = () => {
                if (index >= attempts.length) {
                    throw (lastError instanceof Error ? lastError : new Error("Failed to enqueue upload."));
                }

                const attempt = attempts[index++];
                const beforeCount = getUploads(uploadStore, channelId, draftType).length;

                return Promise.resolve().then(() => {
                    attempt();
                    return waitForUploadEntry(uploadStore, channelId, fileName, draftType, beforeCount, tempName);
                }).then(queued => {
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            invokeSendMessage(messageActions, messageStore, channelId).then(resolve).catch(reject);
                        }, queued ? 220 : 360);
                    });
                }).catch(error => {
                    lastError = error;
                    return run();
                });
            };

            return run();
        }).finally(() => {
            setTimeout(() => cleanupTempFile(fileModule, tempPath), 15000);
        });
    }

    // --- UI Components ---

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
})()
