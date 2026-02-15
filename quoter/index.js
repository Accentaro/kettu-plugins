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

    function renderQuotePreview(quoteUrl) {
        const width = Math.max(
            220,
            Math.min(
                320,
                (ReactNative?.Dimensions?.get?.("window")?.width ?? 320) - 96,
            ),
        );
        const height = Math.round(width * 0.56);

        return React.createElement(
            ReactNative.View,
            {
                style: {
                    marginTop: 12,
                    marginBottom: 4,
                    alignItems: "center",
                },
            },
            [
                React.createElement(ReactNative.Image, {
                    key: "quote-preview-image",
                    source: { uri: quoteUrl },
                    resizeMode: "cover",
                    style: {
                        width,
                        height,
                        borderRadius: 12,
                        backgroundColor: "#111",
                    },
                }),
                React.createElement(
                    ReactNative.Text,
                    {
                        key: "quote-preview-text",
                        style: {
                            color: "#aaa",
                            marginTop: 8,
                            fontSize: 12,
                        },
                    },
                    "Preview generated from selected message",
                ),
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
        const quoteUrl = getQuoteUrl(message);
        const preview = renderQuotePreview(quoteUrl);

        alerts.showConfirmationAlert({
            title: "Create Quote",
            content: "Send quote image link in chat or copy the image link.",
            children: preview,
            confirmText: "Send",
            cancelText: "Cancel",
            secondaryConfirmText: "Copy Link",
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
