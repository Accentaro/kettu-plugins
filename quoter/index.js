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
    const findInReactTree = vendetta.utils.findInReactTree;
    const common = vendetta.metro.common;
    const React = common.React;
    const ReactNative = common.ReactNative;

    const actionSheetModule = metro.findByProps("openLazy", "hideActionSheet");
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

    function isMessageLongPressSheetKey(key) {
        return typeof key === "string"
            && (
                key === "MessageLongPressActionSheet"
                || key.includes("MessageLongPress")
            );
    }

    function getButtonMessage(button) {
        return String(button?.props?.message ?? button?.props?.label ?? "");
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
            icon: fallbackIcon ?? templateButton?.props?.icon,
            variant: undefined,
            isDestructive: false,
            onPress,
            action: onPress,
        };

        return React.createElement(templateButton.type, props);
    }

    function injectQuoteIntoMessageSheet(sheetTree, message) {
        const buttons = findInReactTree(
            sheetTree,
            node =>
                Array.isArray(node)
                && node.length > 0
                && node.some(item => item?.type?.name === "ButtonRow"),
        );

        if (!buttons || hasQuoteButton(buttons)) return;

        const template = buttons.find(button => button?.type?.name === "ButtonRow")
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
