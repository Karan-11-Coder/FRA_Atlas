"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "lucide-react"; // language icon

import { useLanguage } from "@/components/LanguageProvider";

const translations: Record<
  string,
  { govLabel: string; skip: string; home: string; dashboard: string; officerLogin: string; guidelines: string }
> = {
  en: {
    govLabel: "GOVERMENT OF INDIA | MINISTRY OF TRIBAL AFFAIRS",
    skip: "SKIP TO MAIN CONTENT",
    home: "HOME",
    dashboard: "DASHBOARD",
    officerLogin: "OFFICER LOGIN",
    guidelines: "GUIDELINES",
  },
  hi: {
    govLabel: "भारत सरकार | जनजातीय कार्य मंत्रालय",
    skip: "मुख्य सामग्री पर जाएँ",
    home: "होम",
    dashboard: "डैशबोर्ड",
    officerLogin: "अधिकारी लॉगिन",
    guidelines: "दिशानिर्देश",
  },
};

export default function HeaderClient() {
  const pathname = usePathname();
  const { lang, setLang } = useLanguage(); // <-- use shared language provider
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    try {
      return localStorage.getItem("high-contrast") === "1";
    } catch {
      return false;
    }
  });

  // fontKey remains local here (if you will later move to FontSizeProvider, you can refactor)
  const [fontKey, setFontKey] = useState<string>(() => {
    try {
      return (localStorage.getItem("font-key") as string) || "default";
    } catch {
      return "default";
    }
  });

  // small local menu state for language icon
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("high-contrast", highContrast ? "1" : "0");
    } catch {}
    const root = document.documentElement;
    if (highContrast) root.classList.add("high-contrast");
    else root.classList.remove("high-contrast");
  }, [highContrast]);

  useEffect(() => {
    try {
      localStorage.setItem("font-key", fontKey);
    } catch {}
    let px = 16;
    if (fontKey === "small") px = 14;
    if (fontKey === "large") px = 18;
    document.documentElement.style.fontSize = `${px}px`;
  }, [fontKey]);

  const t = translations[lang] || translations.en;

  return (
    <>
      {/* Top government strip */}
      <div className="bg-gov-green text-white py-2 px-4" role="region" aria-label="top government strip">
        <div className="container mx-auto flex justify-between items-center text-sm">
          <span className="font-medium">{t.govLabel}</span>

          <div className="flex items-center gap-4">
            {/* SKIP link */}
            <a href="#main-content" className="underline focus:outline-none focus:ring-2 focus:ring-white rounded px-1">
              {t.skip}
            </a>

            {/* Font size */}
            <div className="flex items-center gap-1 border border-white/20 rounded px-2 py-1">
              <button
                onClick={() => setFontKey("small")}
                className={`px-2 py-1 text-xs rounded ${fontKey === "small" ? "bg-white/20" : ""}`}
                aria-label="Set small font"
                title="Small text"
              >
                A
              </button>
              <button
                onClick={() => setFontKey("default")}
                className={`px-2 py-1 text-xs rounded ${fontKey === "default" ? "bg-white/20" : ""}`}
                aria-label="Set default font"
                title="Default text"
              >
                A+
              </button>
              <button
                onClick={() => setFontKey("large")}
                className={`px-2 py-1 text-xs rounded ${fontKey === "large" ? "bg-white/20" : ""}`}
                aria-label="Set large font"
                title="Large text"
              >
                A++
              </button>
            </div>

            {/* high contrast toggle (kept as example) */}
            <button
              onClick={() => setHighContrast((s) => !s)}
              className="px-2 py-1 border border-white/20 rounded text-xs"
              title="Toggle high contrast"
              aria-pressed={highContrast}
            >
              HC
            </button>

            {/* Compact language icon + menu (uses shared LanguageProvider) */}
            <div className="relative">
              <button
                onClick={() => setLangMenuOpen((s) => !s)}
                className="flex items-center gap-2 px-2 py-1 border border-white/20 rounded text-xs focus:outline-none"
                aria-haspopup="true"
                aria-expanded={langMenuOpen}
                aria-label="Choose language"
                title="Language"
              >
                <Globe className="w-4 h-4" />
                <span className="sr-only">Language</span>
                <span className="text-xs">{lang === "hi" ? "हिंदी" : "EN"}</span>
              </button>

              {langMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-36 bg-white text-gray-800 rounded shadow-lg z-50"
                  onMouseLeave={() => setLangMenuOpen(false)}
                >
                  <button
                    role="menuitem"
                    className={`w-full text-left px-3 py-2 ${lang === "en" ? "bg-gray-100" : ""}`}
                    onClick={() => {
                      setLang("en");
                      setLangMenuOpen(false);
                    }}
                  >
                    English
                  </button>
                  <button
                    role="menuitem"
                    className={`w-full text-left px-3 py-2 ${lang === "hi" ? "bg-gray-100" : ""}`}
                    onClick={() => {
                      setLang("hi");
                      setLangMenuOpen(false);
                    }}
                  >
                    हिंदी
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Ministry logo */}
            <div className="flex items-center">
              <img
                src="/ministry-of-tribal-affairs.png"
                alt="Ministry of Tribal Affairs"
                className="h-16 w-auto object-contain"
              />
            </div>

            {/* Right: partner images + PM */}
            <div className="flex items-center gap-4">
              {/* IFS */}
              <a
                href="https://www.india.gov.in/official-website-indian-forest-service"
                target="_blank"
                rel="noopener noreferrer"
                title="Indian Forest Service"
                className="inline-block"
              >
                <img
                  src="/IFS.png"
                  alt="IFS"
                  className="h-15 w-30 object-contain shadow-sm cursor-pointer hover:opacity-90 transition"
                />
              </a>

              {/* G20 */}
              <a href="https://g20.org" target="_blank" rel="noopener noreferrer" title="G20" className="inline-block">
                <img
                  src="/G20.png"
                  alt="G20"
                  className="h-16 w-28 object-contain shadow-sm cursor-pointer hover:opacity-90 transition"
                />
              </a>

              {/* Azadi */}
              <a
                href="https://amritmahotsav.nic.in"
                target="_blank"
                rel="noopener noreferrer"
                title="Azadi Ka Amrit Mahotsav"
                className="inline-block"
              >
                <img
                  src="/Azadi.png"
                  alt="Azadi Ka Amrit Mahotsav"
                  className="h-16 w-28 object-contain shadow-sm cursor-pointer hover:opacity-90 transition"
                />
              </a>

              {/* PM with name */}
              <a
                href="https://www.pmindia.gov.in/en/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block"
                title="Prime Minister"
              >
                <div className="flex items-center gap-3 cursor-pointer hover:opacity-90 transition">
                  <img
                    src="/PM.png"
                    alt="Prime Minister"
                    className="h-16 w-16 object-cover rounded-full shadow-sm"
                    style={{ objectPosition: "center" }}
                  />
                  <div className="text-right">
                    <p className="font-bold text-gov-blue">Narendra Modi</p>
                    <p className="text-sm text-gray-600">Prime Minister</p>
                  </div>
                </div>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-gov-blue text-white">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-8 py-3">
            <Link href="/" className="hover:text-gov-saffron transition-colors">
              {t.home}
            </Link>
            <Link href="/dashboard" className="hover:text-gov-saffron transition-colors">
              {t.dashboard}
            </Link>
            <Link href="/login" className="hover:text-gov-saffron transition-colors">
              {t.officerLogin}
            </Link>
            <Link
              href="/officers"
              className="hover:text-gov-saffron transition-colors"
            >
            Officer Dashboard
            </Link>

            <Link href="/guidelines" className="hover:text-gov-saffron transition-colors">
              {t.guidelines}
            </Link>
          </div>
        </div>
      </nav>
    </>
  );
}
