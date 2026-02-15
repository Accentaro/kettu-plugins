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

    const actionSheetModule = metro.findByProps("showSimpleActionSheet");
    const messageUtil = common.messageUtil;
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

    function getAuthorAvatarUrl(author) {
        try {
            if (typeof author?.getAvatarURL === "function") {
                return upgradeAvatarUrl(author.getAvatarURL());
            }
        } catch { }

        if (typeof author?.avatarURL === "string") return upgradeAvatarUrl(author.avatarURL);
        if (typeof author?.avatarUrl === "string") return upgradeAvatarUrl(author.avatarUrl);
        return "";
    }

    function getQuoteUrl(message) {
        const text = normalizeText(message?.content).slice(0, 450);
        const author = getMessageAuthor(message);
        const name = getAuthorDisplayName(author).slice(0, 64);
        const image = getAuthorAvatarUrl(author);

        const endpoint = typeof storage.endpoint === "string" && storage.endpoint.trim()
            ? storage.endpoint.trim()
            : API_DEFAULTS.endpoint;

        const url = new URL(endpoint);
        url.searchParams.set("text", text || " ");
        url.searchParams.set("name", name);
        if (image) url.searchParams.set("image", image);

        // Best-effort optional knobs for APIs that support these keys.
        if (storage.grayscale) url.searchParams.set("grayscale", "true");
        if (storage.showWatermark && storage.watermark) {
            url.searchParams.set("watermark", String(storage.watermark).slice(0, 32));
        }
        if (storage.saveAsGif) url.searchParams.set("format", "gif");

        return url.toString();
    }

    function getMessageChannelId(message) {
        return message?.channel_id || message?.channelId || message?.channel?.id || null;
    }

    function sendQuoteMessage(message, quoteUrl) {
        const channelId = getMessageChannelId(message);
        if (!channelId) throw new Error("Unable to resolve message channel.");

        if (!messageUtil || typeof messageUtil.sendMessage !== "function") {
            throw new Error("Unable to send message from this client build.");
        }

        messageUtil.sendMessage(
            channelId,
            { content: quoteUrl },
            undefined,
            { nonce: Date.now().toString() },
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
            config?.messageItem?.message,
            config?.messageContext?.message,
        ];

        for (const candidate of candidates) {
            if (candidate && typeof candidate === "object" && candidate.content != null) {
                return candidate;
            }
        }

        return null;
    }

    function handleQuoteAction(message) {
        const quoteUrl = getQuoteUrl(message);

        alerts.showConfirmationAlert({
            title: "Create Quote",
            content: "Send quote image URL in chat or copy it to clipboard.",
            confirmText: "Send",
            cancelText: "Cancel",
            secondaryConfirmText: "Copy URL",
            onConfirm: () => {
                try {
                    sendQuoteMessage(message, quoteUrl);
                    showToast("Quote sent.");
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    showErrorToast(`Failed to send quote: ${text}`);
                }
            },
            onConfirmSecondary: () => {
                try {
                    clipboard.setString(quoteUrl);
                    showToast("Quote URL copied.");
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    showErrorToast(`Failed to copy URL: ${text}`);
                }
            },
        });
    }

    function patchMessageContextMenu() {
        if (!actionSheetModule || typeof actionSheetModule.showSimpleActionSheet !== "function") {
            vendetta.logger.error(`[${MODULE_TAG}] showSimpleActionSheet module not found.`);
            return;
        }

        const unpatch = vendetta.patcher.after(
            "showSimpleActionSheet",
            actionSheetModule,
            args => {
                const config = args?.[0];
                if (!config || !Array.isArray(config.options)) return;

                const message = extractMessage(config);
                if (!message || !normalizeText(message.content)) return;

                if (config.options.some(o => o?.id === "kettu-quoter" || o?.label === "Quote")) {
                    return;
                }

                config.options.push({
                    id: "kettu-quoter",
                    label: "Quote",
                    onPress: () => handleQuoteAction(message),
                });
            },
        );

        patches.push(unpatch);
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
