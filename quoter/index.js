(() => {
    const MODULE_TAG = "KettuQuoter";

    const API_DEFAULTS = {
        endpoint: "https://api.popcat.xyz/quote",
        grayscale: true,
        showWatermark: false,
        saveAsGif: false,
        watermark: "Made with Kettu",
    };

    const storage = vendetta?.plugin?.storage ?? {};
    const patches = [];

    const assets = vendetta.ui.assets;
    const uiToasts = vendetta.ui.toasts;
    const alerts = vendetta.ui.alerts;
    const metro = vendetta.metro;
    const common = vendetta.metro.common;
    const React = common.React;
    const ReactNative = common.ReactNative;

    const actionSheetModule = metro.findByProps("openLazy", "hideActionSheet");
    const messageActions = metro.findByProps("sendMessage", "revealMessage")
        ?? metro.findByProps("sendMessage", "receiveMessage")
        ?? metro.findByProps("sendMessage");
    const avatarUtils = metro.findByProps("getUserAvatarURL", "getUserAvatarSource")
        ?? metro.findByProps("getUserAvatarURL");
    const clipboard = common.clipboard;
    let runtimeModules = null;

    function safeGet(factory, fallback = null) {
        try {
            const result = factory?.();
            return result ?? fallback;
        } catch {
            return fallback;
        }
    }

    function getGlobalRoot() {
        if (typeof globalThis !== "undefined") return globalThis;
        if (typeof window !== "undefined") return window;
        if (typeof self !== "undefined") return self;
        return {};
    }

    function getRuntimeModules() {
        if (runtimeModules) return runtimeModules;

        const webViewFromProps = safeGet(() => metro.findByProps("WebView"));
        const webViewFromScan = safeGet(() => metro.find(module => module && module.WebView && !module.default));
        const webView = webViewFromProps?.WebView ?? webViewFromScan?.WebView ?? null;

        const uploadHandler = safeGet(() => metro.findByProps("promptToUpload"))
            ?? safeGet(() => metro.findByProps("promptToUpload", "showUploadDialog"));
        const channelStore = safeGet(
            () => (typeof metro.findByStoreName === "function" ? metro.findByStoreName("ChannelStore") : null),
            null,
        );

        const globalRoot = getGlobalRoot();
        const nativeFileModule = globalRoot?.nativeModuleProxy?.NativeFileModule
            ?? globalRoot?.nativeModuleProxy?.DCDFileManager
            ?? null;

        runtimeModules = {
            WebView: webView,
            uploadHandler,
            channelStore,
            nativeFileModule,
        };

        return runtimeModules;
    }

    function ensureDefaults() {
        for (const [key, value] of Object.entries(API_DEFAULTS)) {
            if (storage[key] === undefined) {
                storage[key] = value;
            }
        }
    }

    function showToast(text) {
        const icon = assets.getAssetIDByName("Check");
        uiToasts.showToast(text, icon);
    }

    function showErrorToast(text) {
        const icon = assets.getAssetIDByName("Small");
        uiToasts.showToast(text, icon);
    }

    function upgradeAvatarUrl(url) {
        if (!url || typeof url !== "string") return "";
        try {
            const parsed = new URL(url);
            parsed.searchParams.set("size", "512");

            const isDiscordCdn = parsed.hostname === "cdn.discordapp.com"
                || parsed.hostname === "media.discordapp.net";
            if (isDiscordCdn) {
                // Popcat quote endpoint is picky with avatar formats; enforce static PNG.
                parsed.pathname = parsed.pathname.replace(/\.(webp|gif|jpg|jpeg)$/i, ".png");
                parsed.searchParams.set("format", "png");
            }

            return parsed.toString();
        } catch {
            return url;
        }
    }

    function normalizeText(text) {
        if (!text) return "";
        return String(text).replace(/\s+/g, " ").trim();
    }

    function getMessageAuthor(message) {
        return message?.author ?? message?.user ?? {};
    }

    function getAuthorDisplayName(author) {
        return author?.globalName || author?.global_name || author?.username || "Unknown";
    }

    function getAuthorId(author) {
        return author?.id ?? author?.userId ?? author?.user_id ?? null;
    }

    function getAuthorAvatarHash(author) {
        return author?.avatar ?? author?.avatarHash ?? author?.avatar_hash ?? null;
    }

    function getDiscordCdnAvatarUrl(author) {
        const authorId = getAuthorId(author);
        const avatarHash = getAuthorAvatarHash(author);

        if (authorId && avatarHash) {
            return `https://cdn.discordapp.com/avatars/${authorId}/${avatarHash}.png?size=512`;
        }

        return "https://cdn.discordapp.com/embed/avatars/0.png?size=512";
    }

    function getAuthorAvatarUrl(author) {
        try {
            if (avatarUtils && typeof avatarUtils.getUserAvatarURL === "function") {
                const avatarFromModule = avatarUtils.getUserAvatarURL(author, false);
                if (typeof avatarFromModule === "string" && avatarFromModule.length > 0) {
                    return upgradeAvatarUrl(avatarFromModule);
                }
            }
        } catch { }

        try {
            if (typeof author?.getAvatarURL === "function") {
                return upgradeAvatarUrl(author.getAvatarURL());
            }
        } catch { }

        if (typeof author?.avatarURL === "string") return upgradeAvatarUrl(author.avatarURL);
        if (typeof author?.avatarUrl === "string") return upgradeAvatarUrl(author.avatarUrl);
        return upgradeAvatarUrl(getDiscordCdnAvatarUrl(author));
    }

    function cleanQuoteText(text) {
        if (!text) return "";

        const noEmojiMarkup = String(text).replace(/<a?:\w+:\d+>/g, "");
        const noMentions = noEmojiMarkup.replace(/<@!?\d+>/g, "@user");
        const scriptSafe = noMentions.replace(/[<>]/g, "");
        return normalizeText(scriptSafe);
    }

    function getAuthorUsername(author) {
        return String(author?.username || "unknown").replace(/[^\w.-]/g, "").slice(0, 32) || "unknown";
    }

    function getQuoteRendererPayload(message, options) {
        const author = getMessageAuthor(message);

        return {
            quote: cleanQuoteText(message?.content || "").slice(0, 420) || " ",
            displayName: getAuthorDisplayName(author).slice(0, 64),
            username: `@${getAuthorUsername(author)}`,
            avatarUrl: getAuthorAvatarUrl(author),
            grayscale: Boolean(options?.grayscale),
            showWatermark: Boolean(options?.showWatermark),
            watermark: String(options?.watermark || "").slice(0, 32),
        };
    }

    function buildQuoteFileName(message) {
        const author = getMessageAuthor(message);
        const username = getAuthorUsername(author);
        const preview = cleanQuoteText(message?.content).split(" ").filter(Boolean).slice(0, 6).join(" ");
        const safePreview = preview.replace(/[^\w.-]/g, "_").slice(0, 48) || "quote";
        return `${safePreview}-${username}.png`;
    }

    function buildRendererHtml(payload) {
        const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");

        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
}
#quoter-canvas {
    width: 100%;
    height: 100%;
    display: block;
}
</style>
</head>
<body>
<canvas id="quoter-canvas" width="1200" height="675"></canvas>
<script>
const payload = ${payloadJson};

const postResult = data => {
    try {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
    } catch {}
};

const fitLines = (ctx, text, maxWidth, maxHeight) => {
    let size = 72;
    const min = 24;
    const lineMult = 1.2;
    const words = text.split(" ");

    const withSize = current => {
        ctx.font = "300 " + current + "px sans-serif";
        const lines = [];
        let line = "";
        for (const word of words) {
            const next = line ? line + " " + word : word;
            if (ctx.measureText(next).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
        return lines;
    };

    while (size >= min) {
        const lines = withSize(size);
        const neededHeight = lines.length * (size * lineMult);
        if (neededHeight <= maxHeight) {
            return { lines, size, lineHeight: size * lineMult };
        }
        size -= 2;
    }

    const lines = withSize(min);
    return { lines, size: min, lineHeight: min * lineMult };
};

const render = () => {
    const canvas = document.getElementById("quoter-canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        postResult({ type: "error", message: "Canvas context unavailable." });
        return;
    }

    const W = canvas.width;
    const H = canvas.height;
    const leftW = H;
    const rightX = leftW;
    const quoteX = rightX + 30;
    const quoteW = W - quoteX - 30;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const avatar = new Image();
    avatar.crossOrigin = "anonymous";
    avatar.onload = () => {
        if (payload.grayscale) ctx.filter = "grayscale(1)";
        ctx.drawImage(avatar, 0, 0, leftW, H);
        ctx.filter = "none";

        const fade = ctx.createLinearGradient(leftW - 200, 0, leftW, 0);
        fade.addColorStop(0, "rgba(0,0,0,0)");
        fade.addColorStop(1, "rgba(0,0,0,1)");
        ctx.fillStyle = fade;
        ctx.fillRect(leftW - 200, 0, 200, H);

        ctx.fillStyle = "#000";
        ctx.fillRect(rightX, 0, W - rightX, H);

        const text = fitLines(ctx, payload.quote, quoteW, H - 230);
        ctx.fillStyle = "#fff";
        ctx.font = "300 " + text.size + "px sans-serif";
        ctx.textBaseline = "alphabetic";

        const blockHeight = text.lines.length * text.lineHeight;
        let y = Math.max(160, (H - blockHeight) / 2);
        for (const line of text.lines) {
            const x = quoteX + (quoteW - ctx.measureText(line).width) / 2;
            y += text.lineHeight;
            ctx.fillText(line, x, y);
        }

        const author = "- " + payload.displayName;
        ctx.font = "italic 300 " + Math.max(28, text.size * 0.45) + "px sans-serif";
        const authorX = quoteX + (quoteW - ctx.measureText(author).width) / 2;
        const authorY = y + 48;
        ctx.fillText(author, authorX, authorY);

        ctx.fillStyle = "#8a8a8a";
        ctx.font = "300 " + Math.max(18, text.size * 0.32) + "px sans-serif";
        const userX = quoteX + (quoteW - ctx.measureText(payload.username).width) / 2;
        const userY = authorY + 34;
        ctx.fillText(payload.username, userX, userY);

        if (payload.showWatermark && payload.watermark) {
            ctx.fillStyle = "#666";
            ctx.font = "300 22px sans-serif";
            const watermark = payload.watermark.slice(0, 32);
            const markX = W - ctx.measureText(watermark).width - 18;
            const markY = H - 16;
            ctx.fillText(watermark, markX, markY);
        }

        try {
            const dataUrl = canvas.toDataURL("image/png");
            postResult({ type: "result", dataUrl });
        } catch (error) {
            postResult({ type: "error", message: String(error && error.message ? error.message : error) });
        }
    };

    avatar.onerror = () => postResult({ type: "error", message: "Failed to load avatar image." });
    avatar.src = payload.avatarUrl;
};

render();
</script>
</body>
</html>`;
    }

    function getQuoteUrl(message, options = null) {
        const text = normalizeText(message?.content).slice(0, 450);
        const author = getMessageAuthor(message);
        const name = getAuthorDisplayName(author).slice(0, 64);
        const image = getAuthorAvatarUrl(author);

        const grayscale = options ? Boolean(options.grayscale) : Boolean(storage.grayscale);
        const showWatermark = options ? Boolean(options.showWatermark) : Boolean(storage.showWatermark);
        const watermark = options ? String(options.watermark ?? "") : String(storage.watermark ?? "");
        const saveAsGif = options ? Boolean(options.saveAsGif) : Boolean(storage.saveAsGif);

        const endpoint = typeof storage.endpoint === "string" && storage.endpoint.trim()
            ? storage.endpoint.trim()
            : API_DEFAULTS.endpoint;

        const url = new URL(endpoint);
        url.searchParams.set("text", text || " ");
        url.searchParams.set("name", name);
        if (image) url.searchParams.set("image", image);

        // Best-effort optional knobs for APIs that support these keys.
        if (grayscale) url.searchParams.set("grayscale", "true");
        if (showWatermark && watermark) {
            url.searchParams.set("watermark", watermark.slice(0, 32));
        }
        if (saveAsGif) url.searchParams.set("format", "gif");

        return url.toString();
    }

    function getMessageChannelId(message) {
        return message?.channel_id || message?.channelId || message?.channel?.id || null;
    }

    function sendQuoteMessage(message, quoteUrl) {
        const channelId = getMessageChannelId(message);
        if (!channelId) throw new Error("Unable to resolve message channel.");

        if (!messageActions || typeof messageActions.sendMessage !== "function") {
            throw new Error("Unable to send message from this client build.");
        }

        messageActions.sendMessage(
            channelId,
            {
                content: quoteUrl,
                tts: false,
                invalidEmojis: [],
                validNonShortcutEmojis: [],
            },
            undefined,
            { nonce: Date.now().toString() },
        );
    }

    async function sendGeneratedQuoteImage(message, dataUrl) {
        const { uploadHandler, channelStore, nativeFileModule } = getRuntimeModules();
        if (!uploadHandler || typeof uploadHandler.promptToUpload !== "function") {
            throw new Error("Image upload is unavailable on this client build.");
        }

        const channelId = getMessageChannelId(message);
        if (!channelId) throw new Error("Unable to resolve message channel.");

        const channel = channelStore?.getChannel?.(channelId) ?? { id: channelId };
        const fileName = buildQuoteFileName(message);
        let uploadItem = null;

        try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            if (typeof File === "function") {
                uploadItem = new File([blob], fileName, { type: "image/png" });
            }
        } catch { }

        if (!uploadItem) {
            const base64 = String(dataUrl || "").split(",")[1];
            if (!base64 || !nativeFileModule || typeof nativeFileModule.writeFile !== "function") {
                throw new Error("No compatible image upload path was found.");
            }

            const savedPath = await nativeFileModule.writeFile(
                "cache",
                `kettu-quoter/${Date.now()}-${fileName}`,
                base64,
                "base64",
            );
            const uri = String(savedPath).startsWith("file://")
                ? String(savedPath)
                : `file://${savedPath}`;

            uploadItem = {
                uri,
                fileName,
                filename: fileName,
                mimeType: "image/png",
                type: "image/png",
            };
        }

        uploadHandler.promptToUpload([uploadItem], channel, 0);
    }

    function QuotePreviewCard({ message, onStateChange }) {
        const { WebView } = getRuntimeModules();

        const [grayscale, setGrayscale] = React.useState(Boolean(storage.grayscale));
        const [showWatermark, setShowWatermark] = React.useState(Boolean(storage.showWatermark));
        const [saveAsGif, setSaveAsGif] = React.useState(Boolean(storage.saveAsGif));
        const [watermark, setWatermark] = React.useState(String(storage.watermark ?? API_DEFAULTS.watermark));
        const [generatedDataUrl, setGeneratedDataUrl] = React.useState("");
        const [renderError, setRenderError] = React.useState("");

        const fallbackUrl = React.useMemo(
            () => getQuoteUrl(message, { grayscale, showWatermark, saveAsGif, watermark }),
            [message, grayscale, showWatermark, saveAsGif, watermark],
        );

        const payload = React.useMemo(
            () => getQuoteRendererPayload(message, { grayscale, showWatermark, watermark }),
            [message, grayscale, showWatermark, watermark],
        );
        const html = React.useMemo(
            () => buildRendererHtml(payload),
            [
                payload.quote,
                payload.displayName,
                payload.username,
                payload.avatarUrl,
                payload.grayscale,
                payload.showWatermark,
                payload.watermark,
            ],
        );

        React.useEffect(() => {
            storage.grayscale = grayscale;
            storage.showWatermark = showWatermark;
            storage.saveAsGif = saveAsGif;
            storage.watermark = watermark;
        }, [grayscale, showWatermark, saveAsGif, watermark]);

        React.useEffect(() => {
            onStateChange?.({
                dataUrl: generatedDataUrl,
                fallbackUrl,
                options: { grayscale, showWatermark, saveAsGif, watermark },
            });
        }, [onStateChange, generatedDataUrl, fallbackUrl, grayscale, showWatermark, saveAsGif, watermark]);

        const onWebViewMessage = event => {
            const data = event?.nativeEvent?.data;
            if (typeof data !== "string") return;

            let parsed = null;
            try {
                parsed = JSON.parse(data);
            } catch {
                return;
            }

            if (parsed?.type === "result" && typeof parsed.dataUrl === "string") {
                setGeneratedDataUrl(parsed.dataUrl);
                setRenderError("");
            } else if (parsed?.type === "error") {
                setRenderError(String(parsed.message || "Preview render failed."));
            }
        };

        const previewWidth = Math.max(
            230,
            Math.min((ReactNative?.Dimensions?.get?.("window")?.width ?? 360) - 88, 420),
        );
        const previewHeight = Math.round(previewWidth * (675 / 1200));

        const previewElement = WebView
            ? React.createElement(WebView, {
                key: "quoter-preview-webview",
                source: {
                    html,
                    baseUrl: "https://localhost",
                },
                originWhitelist: ["*"],
                javaScriptEnabled: true,
                domStorageEnabled: true,
                mixedContentMode: "always",
                onMessage: onWebViewMessage,
                style: {
                    width: "100%",
                    height: "100%",
                    backgroundColor: "#000",
                },
            })
            : React.createElement(ReactNative.Image, {
                key: "quoter-preview-fallback-image",
                source: { uri: fallbackUrl },
                resizeMode: "cover",
                style: {
                    width: "100%",
                    height: "100%",
                    backgroundColor: "#111",
                },
            });

        const toggleRow = (label, value, setter, key) => React.createElement(
            ReactNative.View,
            {
                key,
                style: {
                    marginTop: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                },
            },
            [
                React.createElement(ReactNative.Text, { style: { color: "#fff", fontSize: 15 } }, label),
                ReactNative.Switch
                    ? React.createElement(ReactNative.Switch, {
                        value,
                        onValueChange: setter,
                    })
                    : React.createElement(
                        ReactNative.Pressable,
                        {
                            onPress: () => setter(!value),
                            style: {
                                borderWidth: 1,
                                borderColor: "#666",
                                borderRadius: 6,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                            },
                        },
                        React.createElement(
                            ReactNative.Text,
                            { style: { color: "#fff", fontSize: 13 } },
                            value ? "ON" : "OFF",
                        ),
                    ),
            ],
        );

        return React.createElement(
            ReactNative.ScrollView,
            {
                style: { maxHeight: 460 },
                contentContainerStyle: { paddingTop: 10, paddingBottom: 4 },
            },
            [
                React.createElement(
                    ReactNative.View,
                    {
                        key: "quoter-preview-wrap",
                        style: {
                            width: previewWidth,
                            height: previewHeight,
                            alignSelf: "center",
                            borderRadius: 14,
                            overflow: "hidden",
                            backgroundColor: "#0f0f0f",
                        },
                    },
                    previewElement,
                ),
                React.createElement(
                    ReactNative.Text,
                    {
                        key: "quoter-preview-caption",
                        style: {
                            color: "#aaa",
                            marginTop: 8,
                            textAlign: "center",
                            fontSize: 12,
                        },
                    },
                    "Catch Them In 4K.",
                ),
                renderError
                    ? React.createElement(
                        ReactNative.Text,
                        {
                            key: "quoter-preview-error",
                            style: {
                                color: "#f66",
                                marginTop: 8,
                                textAlign: "center",
                                fontSize: 12,
                            },
                        },
                        renderError,
                    )
                    : null,
                toggleRow("Grayscale", grayscale, setGrayscale, "toggle-grayscale"),
                toggleRow("Save as GIF", saveAsGif, setSaveAsGif, "toggle-gif"),
                React.createElement(
                    ReactNative.Text,
                    {
                        key: "gif-hint",
                        style: { color: "#888", marginTop: 4, fontSize: 12 },
                    },
                    "GIF output on mobile depends on API fallback behavior.",
                ),
                toggleRow("Show Watermark", showWatermark, setShowWatermark, "toggle-watermark"),
                showWatermark
                    ? React.createElement(ReactNative.TextInput, {
                        key: "watermark-input",
                        value: watermark,
                        onChangeText: setWatermark,
                        placeholder: "Watermark text",
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

    function extractMessage(config) {
        if (!config || typeof config !== "object") return null;

        const candidates = [
            config.message,
            config.targetMessage,
            config.messageRecord,
            config?.payload?.message,
            config?.args?.message,
            config?.args?.[0]?.message,
            config?.messageItem?.message,
            config?.messageContext?.message,
            config?.target?.message,
            config?.payload?.targetMessage,
        ];

        for (const candidate of candidates) {
            if (candidate && typeof candidate === "object" && candidate.content != null) {
                return candidate;
            }
        }

        return deepFindMessage(config);
    }

    function looksLikeMessage(value) {
        if (!value || typeof value !== "object") return false;
        if (value.content == null) return false;
        return (
            value.author != null
            || value.channel_id != null
            || value.channelId != null
            || value.timestamp != null
            || value.id != null
        );
    }

    function deepFindMessage(root) {
        const stack = [root];
        const seen = new Set();

        while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== "object") continue;
            if (seen.has(current)) continue;
            seen.add(current);

            if (looksLikeMessage(current)) return current;

            if (Array.isArray(current)) {
                for (const item of current) {
                    stack.push(item);
                }
                continue;
            }

            for (const value of Object.values(current)) {
                if (value && typeof value === "object") {
                    stack.push(value);
                }
            }
        }

        return null;
    }

    function handleQuoteAction(message) {
        let currentState = {
            dataUrl: "",
            fallbackUrl: getQuoteUrl(message),
            options: {
                grayscale: Boolean(storage.grayscale),
                showWatermark: Boolean(storage.showWatermark),
                saveAsGif: Boolean(storage.saveAsGif),
                watermark: String(storage.watermark ?? API_DEFAULTS.watermark),
            },
        };

        const preview = React.createElement(QuotePreviewCard, {
            message,
            onStateChange: state => {
                if (state && typeof state === "object") {
                    currentState = {
                        ...currentState,
                        ...state,
                    };
                }
            },
        });

        alerts.showConfirmationAlert({
            title: "Create Quote",
            content: "Generate quote image, then send it or copy fallback link.",
            children: preview,
            confirmText: "Send",
            cancelText: "Cancel",
            secondaryConfirmText: "Copy Link",
            onConfirm: () => {
                void (async () => {
                    try {
                        if (currentState.dataUrl) {
                            await sendGeneratedQuoteImage(message, currentState.dataUrl);
                            showToast("Quote sent as image.");
                            return;
                        }

                        const quoteUrl = currentState.fallbackUrl || getQuoteUrl(message, currentState.options);
                        sendQuoteMessage(message, quoteUrl);
                        showToast("Quote sent as link fallback.");
                    } catch (error) {
                        const text = error instanceof Error ? error.message : String(error);
                        showErrorToast(`Failed to send quote: ${text}`);
                    }
                })();
            },
            onConfirmSecondary: () => {
                try {
                    const quoteUrl = currentState.fallbackUrl || getQuoteUrl(message, currentState.options);
                    clipboard.setString(quoteUrl);
                    showToast("Fallback quote link copied.");
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    showErrorToast(`Failed to copy URL: ${text}`);
                }
            },
        });
    }

    function isMessageLongPressSheetKey(key) {
        return typeof key === "string"
            && (
                key === "MessageLongPressActionSheet"
                || key.includes("MessageLongPress")
            );
    }

    function getButtonMessage(button) {
        return String(
            button?.props?.message
            ?? button?.props?.label
            ?? button?.props?.title
            ?? button?.props?.text
            ?? "",
        );
    }

    function hasQuoteButton(buttons) {
        return buttons.some(button => getButtonMessage(button) === "Quote");
    }

    function getInsertIndex(buttons) {
        const targets = [
            "Mark Unread",
            "Copy Text",
            "Apps",
            "Mention",
        ];

        for (const target of targets) {
            const index = buttons.findIndex(button => getButtonMessage(button) === target);
            if (index >= 0) return index;
        }

        return Math.min(4, buttons.length);
    }

    function isActionRowElement(element) {
        if (!element || typeof element !== "object" || !element.type || !element.props) {
            return false;
        }

        const props = element.props;
        return typeof props.onPress === "function"
            || typeof props.action === "function";
    }

    function findBestRowArray(root) {
        const knownLabels = new Set([
            "Edit Message",
            "Reply",
            "Forward",
            "Create Thread",
            "Copy Text",
            "Mark Unread",
            "Pin Message",
            "Apps",
            "Mention",
            "Copy Message Link",
            "Copy Message ID",
            "Delete Message",
        ]);

        const stack = [root];
        const seen = new Set();
        let best = null;
        let bestScore = -1;

        while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== "object") continue;
            if (seen.has(current)) continue;
            seen.add(current);

            if (Array.isArray(current)) {
                const rows = current.filter(isActionRowElement);
                if (rows.length >= 3) {
                    let score = rows.length;
                    for (const row of rows) {
                        if (knownLabels.has(getButtonMessage(row))) {
                            score += 10;
                        }
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = current;
                    }
                }

                for (const item of current) {
                    if (item && typeof item === "object") stack.push(item);
                }
                continue;
            }

            for (const value of Object.values(current)) {
                if (value && typeof value === "object") {
                    stack.push(value);
                }
            }
        }

        return best;
    }

    function createQuoteButton(templateButton, message) {
        if (!templateButton?.type) return null;

        const onPress = () => {
            try {
                actionSheetModule?.hideActionSheet?.();
            } catch { }

            setTimeout(() => handleQuoteAction(message), 0);
        };

        const fallbackIcon = assets.getAssetIDByName("LinkIcon");

        const props = {
            ...templateButton.props,
            key: "kettu-quoter-button",
            message: "Quote",
            label: "Quote",
            title: "Quote",
            text: "Quote",
            icon: fallbackIcon ?? templateButton?.props?.icon,
            variant: undefined,
            isDestructive: false,
            onPress,
            action: onPress,
        };

        return React.createElement(templateButton.type, props);
    }

    function injectQuoteIntoMessageSheet(sheetTree, message) {
        const buttons = findBestRowArray(sheetTree);

        if (!buttons || hasQuoteButton(buttons)) return;

        const template = buttons.find(button => button?.type?.name === "ButtonRow")
            ?? buttons.find(button => button?.type?.name === "ActionSheetRow")
            ?? buttons.find(button => button?.type?.name === "TableRow")
            ?? buttons.find(Boolean);
        const quoteButton = createQuoteButton(template, message);
        if (!quoteButton) return;

        const at = getInsertIndex(buttons);
        buttons.splice(at, 0, quoteButton);
    }

    function patchMessageContextMenu() {
        if (actionSheetModule && typeof actionSheetModule.openLazy === "function") {
            const unpatchActionSheet = vendetta.patcher.before(
                "openLazy",
                actionSheetModule,
                args => {
                    const lazyComponent = args?.[0];
                    const key = args?.[1];
                    const payload = args?.[2];
                    if (!isMessageLongPressSheetKey(key)) return;

                    const message = extractMessage(payload);
                    if (!message || !normalizeText(message.content)) return;

                    Promise.resolve(lazyComponent).then(module => {
                        if (!module || typeof module.default !== "function") return;

                        const unpatchModalRender = vendetta.patcher.after(
                            "default",
                            module,
                            (_, sheetTree) => {
                                React.useEffect(
                                    () => () => unpatchModalRender(),
                                    [],
                                );

                                injectQuoteIntoMessageSheet(sheetTree, message);
                                return sheetTree;
                            },
                        );
                    }).catch(() => { });
                },
            );

            patches.push(unpatchActionSheet);
        } else {
            vendetta.logger.warn(`[${MODULE_TAG}] openLazy action sheet module not found.`);
        }
    }

    function SettingsPanel() {
        const h = React.createElement;
        const [, forceUpdate] = React.useReducer(v => v + 1, 0);

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
                    "Quote API Endpoint",
                    "Default: https://api.popcat.xyz/quote",
                ),
                h(ReactNative.TextInput, {
                    value: String(storage.endpoint ?? ""),
                    onChangeText: value => setValue("endpoint", value),
                    autoCapitalize: "none",
                    autoCorrect: false,
                    style: inputStyle,
                    placeholder: "https://api.popcat.xyz/quote",
                    placeholderTextColor: "#666",
                }),

                sectionTitle(
                    "Watermark Text",
                    "Only used when watermark is enabled. Max 32 chars are sent.",
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
                toggleRow("Save as GIF (API dependent)", "saveAsGif"),
            ],
        );
    }

    return {
        onLoad() {
            try {
                ensureDefaults();
                patchMessageContextMenu();
                showToast("Quoter loaded.");
            } catch (error) {
                vendetta.logger.error(`[${MODULE_TAG}] Failed during onLoad`, error);
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
