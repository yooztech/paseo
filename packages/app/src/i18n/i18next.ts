import { createInstance, type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import { withForkTranslations } from "@/fork/i18n-resources";
import { observeI18nInit } from "./init";
import { en } from "./resources/en";

// Literal requires keep every locale bundled for offline use, while evaluating
// its resource module only when selected. Synchronous reads preserve the language
// provider's contract: translations are ready before it renders children.
const bundledTranslations: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    switch (language) {
      case "en":
        callback(null, withForkTranslations(en, "en"));
        return;
      case "ar":
        callback(null, withForkTranslations(require("./resources/ar").ar, "ar"));
        return;
      case "es":
        callback(null, withForkTranslations(require("./resources/es").es, "es"));
        return;
      case "fr":
        callback(null, withForkTranslations(require("./resources/fr").fr, "fr"));
        return;
      case "ja":
        callback(null, withForkTranslations(require("./resources/ja").ja, "ja"));
        return;
      case "ko":
        callback(null, withForkTranslations(require("./resources/ko").ko, "ko"));
        return;
      case "pt-BR":
        callback(null, withForkTranslations(require("./resources/pt-BR").ptBR, "pt-BR"));
        return;
      case "ru":
        callback(null, withForkTranslations(require("./resources/ru").ru, "ru"));
        return;
      case "zh-CN":
        callback(null, withForkTranslations(require("./resources/zh-CN").zhCN, "zh-CN"));
        return;
      default:
        callback(null, undefined);
    }
  },
};

const i18n = createInstance();

observeI18nInit(
  i18n
    .use(bundledTranslations)
    .use(initReactI18next)
    .init({
      compatibilityJSON: "v4",
      fallbackLng: "en",
      lng: "en",
      partialBundledLanguages: true,
      resources: {
        en: { translation: withForkTranslations(en, "en") },
      },
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    }),
);

export { i18n };
