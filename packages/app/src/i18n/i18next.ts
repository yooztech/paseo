import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { withForkTranslations } from "@/fork/i18n-resources";
import { observeI18nInit } from "./init";
import { ar } from "./resources/ar";
import { en } from "./resources/en";
import { es } from "./resources/es";
import { fr } from "./resources/fr";
import { ja } from "./resources/ja";
import { ko } from "./resources/ko";
import { ptBR } from "./resources/pt-BR";
import { ru } from "./resources/ru";
import { zhCN } from "./resources/zh-CN";

const i18n = createInstance();

observeI18nInit(
  i18n.use(initReactI18next).init({
    compatibilityJSON: "v4",
    fallbackLng: "en",
    lng: "en",
    resources: {
      ar: { translation: withForkTranslations(ar, "ar") },
      en: { translation: withForkTranslations(en, "en") },
      es: { translation: withForkTranslations(es, "es") },
      fr: { translation: withForkTranslations(fr, "fr") },
      ja: { translation: withForkTranslations(ja, "ja") },
      ko: { translation: withForkTranslations(ko, "ko") },
      "pt-BR": { translation: withForkTranslations(ptBR, "pt-BR") },
      ru: { translation: withForkTranslations(ru, "ru") },
      "zh-CN": { translation: withForkTranslations(zhCN, "zh-CN") },
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
