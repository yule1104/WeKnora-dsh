const STORAGE_KEY = "yunzhuang_ai_settings";
// Read the previous key once so existing demo connections do not need re-entry.
const LEGACY_STORAGE_KEY = "weknora_settings";

function initializeSettings() {
  if (wx.getStorageSync(STORAGE_KEY)) {
    return;
  }
  const legacy = wx.getStorageSync(LEGACY_STORAGE_KEY);
  wx.setStorageSync(STORAGE_KEY, legacy || {
    baseUrl: "http://localhost:8080",
    apiKey: "",
    selectedKnowledgeBaseId: "",
    locale: "zh"
  });
  if (legacy) {
    wx.removeStorageSync(LEGACY_STORAGE_KEY);
  }
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") {
    return "";
  }

  return baseUrl.trim().replace(/\/+$/, "");
}

function normalizeLocale(locale) {
  return locale === "en" ? "en" : "zh";
}

function getSettings() {
  const stored = wx.getStorageSync(STORAGE_KEY) || {};
  return {
    baseUrl: normalizeBaseUrl(stored.baseUrl || ""),
    apiKey: stored.apiKey || "",
    selectedKnowledgeBaseId: stored.selectedKnowledgeBaseId || "",
    locale: normalizeLocale(stored.locale || "zh")
  };
}

function saveSettings(settings) {
  const current = getSettings();
  const nextBaseUrl =
    settings.baseUrl !== undefined && settings.baseUrl !== null
      ? settings.baseUrl
      : current.baseUrl;
  const nextLocale =
    settings.locale !== undefined && settings.locale !== null
      ? settings.locale
      : current.locale;
  const next = {
    baseUrl: normalizeBaseUrl(nextBaseUrl),
    apiKey: settings.apiKey !== undefined ? settings.apiKey : current.apiKey,
    selectedKnowledgeBaseId:
      settings.selectedKnowledgeBaseId !== undefined
        ? settings.selectedKnowledgeBaseId
        : current.selectedKnowledgeBaseId,
    locale: normalizeLocale(nextLocale)
  };
  wx.setStorageSync(STORAGE_KEY, next);
  return next;
}

module.exports = {
  STORAGE_KEY,
  getSettings,
  initializeSettings,
  normalizeBaseUrl,
  normalizeLocale,
  saveSettings
};
