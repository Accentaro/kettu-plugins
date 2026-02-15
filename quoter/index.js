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

    const safeGet = (factory, fallback = null) => {
        try {
            const value = factory?.();
            return value ?? fallback;
        } catch {
            return fallback;
        }
    };

    const globalRoot = typeof globalThis !== "undefined"
        ? globalThis
        : (typeof global !== "undefined" ? global : (typeof window !== "undefined" ? window : {}));

    const actionSheetModule = safeGet(() => metro.findByProps("openLazy", "hideActionSheet"));
    const messageActions = safeGet(() => metro.findByProps("sendMessage", "revealMessage"))
        ?? safeGet(() => metro.findByProps("sendMessage", "receiveMessage"))
        ?? safeGet(() => metro.findByProps("sendMessage"));
    const avatarUtils = safeGet(() => metro.findByProps("getUserAvatarURL", "getUserAvatarSource"))
        ?? safeGet(() => metro.findByProps("getUserAvatarURL"));
    const uploadHandler = safeGet(() => metro.findByProps("promptToUpload"))
        ?? safeGet(() => metro.findByProps("promptToUpload", "showUploadDialog"));
    const channelStore = safeGet(
        () => (typeof metro.findByStoreName === "function" ? metro.findByStoreName("ChannelStore") : null),
        null,
    );
    const webViewModule = safeGet(() => metro.findByProps("WebView"))
        ?? safeGet(() => metro.find(module => module && module.WebView && !module.default));
    const WebView = webViewModule?.WebView ?? null;
    const nativeFileModule = globalRoot?.nativeModuleProxy?.NativeFileModule
        ?? globalRoot?.nativeModuleProxy?.DCDFileManager
        ?? null;
    const clipboard = common.clipboard;

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

        // Remove custom emoji markup and normalize mentions to plain text.
        const withoutEmoji = String(text).replace(/<a?:\w+:\d+>/g, "");
        const mentionsNormalized = withoutEmoji.replace(/<@!?\d+>/g, "@user");
        const scriptSafe = mentionsNormalized.replace(/[<>]/g, "");
        return normalizeText(scriptSafe);
    }

    function getAuthorUsername(author) {
        return String(author?.username || "unknown").replace(/[^\w.-]/g, "").slice(0, 32) || "unknown";
    }

    function buildQuoteFileName(message) {
        const author = getMessageAuthor(message);
        const user = getAuthorUsername(author);
        const textPreview = cleanQuoteText(message?.content).split(" ").filter(Boolean).slice(0, 6).join(" ");
        const safeText = textPreview.replace(/[^\w.-]/g, "_").slice(0, 48) || "quote";
        return `${safeText}-${user}.png`;
    }

    function buildLocalQuotePayload(message, options = {}) {
        const author = getMessageAuthor(message);

        return {
            quote: cleanQuoteText(message?.content || "").slice(0, 420) || " ",
            displayName: getAuthorDisplayName(author).slice(0, 64),
            username: `@${getAuthorUsername(author)}`,
            avatarUrl: getAuthorAvatarUrl(author),
            grayscale: Boolean(options.grayscale),
            showWatermark: Boolean(options.showWatermark),
            watermark: String(options.watermark || "").slice(0, 32),
        };
    }

    function buildQuoteRendererHtml(payload) {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html, body {
    margin: 0;
    padding: 0;
    background: #000;
    width: 100%;
    height: 100%;
    overflow: hidden;
}
#c {
    width: 100%;
    height: 100%;
    display: block;
}
</style>
</head>
<body>
<canvas id="c" width="1200" height="675"></canvas>
<script>
const payload = ${JSON.stringify(payload)};

function post(data) {
    try {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
    } catch {}
}

function fitText(ctx, text, maxWidth, maxHeight) {
    let size = 72;
    const minSize = 24;
    const lineMult = 1.2;
    const words = text.split(" ");

    function linesFor(currentSize) {
        ctx.font = "300 " + currentSize + "px sans-serif";
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
    }

    while (size >= minSize) {
        const lines = linesFor(size);
        const contentHeight = lines.length * (size * lineMult);
        if (contentHeight <= maxHeight) return { size, lines, lineHeight: size * lineMult };
        size -= 2;
    }

    const finalLines = linesFor(minSize);
    return { size: minSize, lines: finalLines, lineHeight: minSize * lineMult };
}

async function draw() {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const leftW = H;
    const rightX = leftW;
    const quoteX = rightX + 30;
    const quoteW = W - quoteX - 30;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    img.onload = () => {
        if (payload.grayscale) ctx.filter = "grayscale(1)";
        ctx.drawImage(img, 0, 0, leftW, H);
        ctx.filter = "none";

        const fade = ctx.createLinearGradient(leftW - 200, 0, leftW, 0);
        fade.addColorStop(0, "rgba(0,0,0,0)");
        fade.addColorStop(1, "rgba(0,0,0,1)");
        ctx.fillStyle = fade;
        ctx.fillRect(leftW - 200, 0, 200, H);

        ctx.fillStyle = "#000";
        ctx.fillRect(rightX, 0, W - rightX, H);

        const textCalc = fitText(ctx, payload.quote, quoteW, H - 230);
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "alphabetic";
        ctx.font = "300 " + textCalc.size + "px sans-serif";

        const blockHeight = textCalc.lines.length * textCalc.lineHeight;
        let y = Math.max(160, (H - blockHeight) / 2);
        for (const line of textCalc.lines) {
            const x = quoteX + (quoteW - ctx.measureText(line).width) / 2;
            y += textCalc.lineHeight;
            ctx.fillText(line, x, y);
        }

        const authorName = "- " + payload.displayName;
        ctx.font = "italic 300 " + Math.max(28, textCalc.size * 0.45) + "px sans-serif";
        const authorX = quoteX + (quoteW - ctx.measureText(authorName).width) / 2;
        const authorY = y + 48;
        ctx.fillText(authorName, authorX, authorY);

        ctx.fillStyle = "#8a8a8a";
        ctx.font = "300 " + Math.max(18, textCalc.size * 0.32) + "px sans-serif";
        const userX = quoteX + (quoteW - ctx.measureText(payload.username).width) / 2;
        const userY = authorY + 34;
        ctx.fillText(payload.username, userX, userY);

        if (payload.showWatermark && payload.watermark) {
            ctx.fillStyle = "#666";
            ctx.font = "300 22px sans-serif";
            const mark = payload.watermark.slice(0, 32);
            const markX = W - ctx.measureText(mark).width - 18;
            const markY = H - 16;
            ctx.fillText(mark, markX, markY);
        }

        try {
            const dataUrl = canvas.toDataURL("image/png");
            post({ type: "result", dataUrl });
        } catch (error) {
            post({ type: "error", message: String(error && error.message ? error.message : error) });
        }
    };

    img.onerror = () => {
        post({ type: "error", message: "Failed to load avatar image in renderer." });
    };
    img.src = payload.avatarUrl;
}

draw();
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
        const channelId = getMessageChannelId(message);
        if (!channelId) throw new Error("Unable to resolve message channel.");

        if (!uploadHandler || typeof uploadHandler.promptToUpload !== "function") {
            throw new Error("Upload handler is unavailable on this build.");
        }

        const fileName = buildQuoteFileName(message);
        const channel = channelStore?.getChannel?.(channelId) ?? { id: channelId };
        let uploadItem = null;

        const response = await fetch(dataUrl);
        const blob = await response.blob();

        if (typeof File === "function") {
            uploadItem = new File([blob], fileName, { type: "image/png" });
        } else {
            const base64 = String(dataUrl).split(",")[1];
            if (!base64 || !nativeFileModule || typeof nativeFileModule.writeFile !== "function") {
                throw new Error("No compatible file upload path found.");
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

    function QuotePreviewCard({ message, onPreviewState }) {
        const [grayscale, setGrayscale] = React.useState(Boolean(storage.grayscale));
        const [showWatermark, setShowWatermark] = React.useState(Boolean(storage.showWatermark));
        const [saveAsGif, setSaveAsGif] = React.useState(Boolean(storage.saveAsGif));
        const [watermark, setWatermark] = React.useState(String(storage.watermark ?? API_DEFAULTS.watermark));
        const [generatedDataUrl, setGeneratedDataUrl] = React.useState(null);
        const [renderError, setRenderError] = React.useState("");

        const previewWidth = Math.max(
            230,
            Math.min((ReactNative?.Dimensions?.get?.("window")?.width ?? 360) - 88, 420),
        );
        const previewHeight = Math.round(previewWidth * (675 / 1200));

        React.useEffect(() => {
            storage.grayscale = grayscale;
            storage.showWatermark = showWatermark;
            storage.saveAsGif = saveAsGif;
            storage.watermark = watermark;
        }, [grayscale, showWatermark, saveAsGif, watermark]);

        const localPayload = React.useMemo(
            () => buildLocalQuotePayload(message, {
                grayscale,
                showWatermark,
                watermark,
            }),
            [message, grayscale, showWatermark, watermark],
        );

        const fallbackUrl = React.useMemo(
            () => getQuoteUrl(message, {
                grayscale,
                showWatermark,
                watermark,
                saveAsGif,
            }),
            [message, grayscale, showWatermark, watermark, saveAsGif],
        );

        const rendererHtml = React.useMemo(
            () => buildQuoteRendererHtml(localPayload),
            [
                localPayload.quote,
                localPayload.displayName,
                localPayload.username,
                localPayload.avatarUrl,
                localPayload.grayscale,
                localPayload.showWatermark,
                localPayload.watermark,
            ],
        );

        React.useEffect(() => {
            onPreviewState?.({
                dataUrl: generatedDataUrl,
                fallbackUrl,
                options: {
                    grayscale,
                    showWatermark,
                    saveAsGif,
                    watermark,
                },
            });
        }, [
            onPreviewState,
            generatedDataUrl,
            fallbackUrl,
            grayscale,
            showWatermark,
            saveAsGif,
            watermark,
        ]);

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
                setRenderError(String(parsed.message || "Failed to render quote preview."));
            }
        };

        const textStyle = {
            color: "#fff",
            fontSize: 15,
        };

        const toggleRow = (label, value, setValue, key) => React.createElement(
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
                React.createElement(ReactNative.Text, { style: textStyle }, label),
                ReactNative.Switch
                    ? React.createElement(ReactNative.Switch, {
                        value,
                        onValueChange: setValue,
                    })
                    : React.createElement(
                        ReactNative.Pressable,
                        {
                            onPress: () => setValue(!value),
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

        const previewElement = WebView
            ? React.createElement(WebView, {
                key: "quoter-webview",
                source: {
                    html: rendererHtml,
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
                key: "quoter-preview-fallback",
                source: { uri: fallbackUrl },
                resizeMode: "cover",
                style: {
                    width: "100%",
                    height: "100%",
                    backgroundColor: "#111",
                },
            });

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
                            borderRadius: 14,
                            overflow: "hidden",
                            alignSelf: "center",
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
                toggleRow("Grayscale", grayscale, setGrayscale, "gray"),
                toggleRow("Save as GIF", saveAsGif, setSaveAsGif, "gif"),
                React.createElement(
                    ReactNative.Text,
                    {
                        key: "gif-hint",
                        style: { color: "#888", marginTop: 4, fontSize: 12 },
                    },
                    "GIF output is API-dependent on mobile builds.",
                ),
                toggleRow("Show Watermark", showWatermark, setShowWatermark, "wm"),
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
        let previewState = {
            dataUrl: null,
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
            onPreviewState: state => {
                if (state && typeof state === "object") {
                    previewState = {
                        ...previewState,
                        ...state,
                    };
                }
            },
        });

        alerts.showConfirmationAlert({
            title: "Create Quote",
            content: "Generate a quote card, then send it or copy fallback image link.",
            children: preview,
            confirmText: "Send",
            cancelText: "Cancel",
            secondaryConfirmText: "Copy Link",
            onConfirm: () => {
                void (async () => {
                    try {
                        if (previewState.dataUrl) {
                            await sendGeneratedQuoteImage(message, previewState.dataUrl);
                            showToast("Quote sent as image.");
                            return;
                        }

                        const quoteUrl = previewState.fallbackUrl
                            || getQuoteUrl(message, previewState.options);
                        sendQuoteMessage(message, quoteUrl);
                        showToast("Quote sent.");
                    } catch (error) {
                        const text = error instanceof Error ? error.message : String(error);
                        showErrorToast(`Failed to send quote: ${text}`);
                    }
                })();
            },
            onConfirmSecondary: () => {
                try {
                    const quoteUrl = previewState.fallbackUrl
                        || getQuoteUrl(message, previewState.options);
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
            ensureDefaults();
            patchMessageContextMenu();
            showToast("Quoter loaded.");
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
