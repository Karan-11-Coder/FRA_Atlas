"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
//import HexagonGrid from "@/components/hexagon-grid";
import NoticeBoard from "@/components/notice-board";
import { Phone, Download, User } from "lucide-react";

// <-- language hook
import { useLanguage } from "@/components/LanguageProvider";

// <-- new: shared header (replaces inline top strip + header + nav)
import HeaderClient from "@/components/HeaderClient";

export default function LandingPage() {
  // Heading movement state (x = horizontal px, y = vertical px)
  const [headingOffset, setHeadingOffset] = useState({ x: 80, y: 20 });

  // Notice board movement state (x = horizontal px, y = vertical px)
  const [noticeOffset, setNoticeOffset] = useState({ x: 0, y: 48 });

  // Language context
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="min-h-screen bg-white">
      {/* === HEADER (shared) === */}

      {/* Hero Section (main-content target for Skip link) */}
      <section
        id="main-content"
        className="relative h-[530px] bg-cover bg-center"
        style={{
          backgroundImage: `linear-gradient(rgba(44, 110, 73, 0.7), rgba(44, 110, 73, 0.7)), url('https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&h=800&fit=crop&crop=center')`,
        }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Left - Motto and Hexagon Grid */}
            <div className="flex-1 text-center lg:text-left">
              <h2
                className="text-3xl md:text-4xl font-bold text-white mb-12"
                style={{
                  transform: `translate(${headingOffset.x}px, ${headingOffset.y}px)`,
                }}
              >
                अधिकार आपका, साथ हमारा
              </h2>
              {/* Hexagon Grid Image */}
              <div className="mb-8 flex justify-center">
                <img
                  src="/images/Hexagon.png"
                  alt="Honeycomb collage"
                  className="w-full max-w-[650px] object-contain rounded-md shadow-lg"
                  style={{ height: "auto" }}
                />
              </div>
            </div>

            {/* Right - Notice Board (with code-only offset) */}
            <div className="flex-shrink-0 w-full lg:w-96 height-[525px]">
              <div
                style={{
                  transform: `translate(${noticeOffset.x}px, ${noticeOffset.y}px)`,
                  transition: "transform 120ms ease-out",
                }}
              >
                <NoticeBoard />
              </div>
            </div>
          </div>
        </div>
      </section>

{/* Quick Access Cards */}
<section className="py-12 bg-gray-50">
  <div className="container mx-auto px-4">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
      
      {/* Tribal Login */}
      <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 bg-gov-green rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-gov-light-green transition-colors">
            <User className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-gov-blue mb-2">
            {lang === "hi" ? "जनजातीय लॉगिन" : "Tribal Login"}
          </h3>
          <p className="text-gray-600 mb-4">
            {lang === "hi" ? "जनजातीय उपयोगकर्ताओं के लिए लॉगिन पोर्टल" : "Login portal for tribal users"}
          </p>
          <Link href="/tribal-login" className="text-accent-teal hover:underline font-medium">
            {lang === "hi" ? "यहाँ लॉगिन करें" : "Login Here"}
          </Link>
        </CardContent>
      </Card>

      {/* Tribal Call Center */}
      <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 bg-accent-teal rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-opacity-80 transition-colors">
            <Phone className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-gov-blue mb-2">{t("kisan_call_center")}</h3>
          <p className="text-gray-600">1800 180 2117</p>
          <p className="text-gray-600">1800 180 2060</p>
        </CardContent>
      </Card>

      {/* Schemes & Benefits */}
      <Card className="hover:shadow-lg transition-shadow cursor-pointer group">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 bg-gov-saffron rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-opacity-80 transition-colors">
            <Download className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-gov-blue mb-2">
            {lang === "hi" ? "योजनाएं और लाभ" : "Schemes & Benefits"}
          </h3>
          <p className="text-gray-600 mb-4">
            {lang === "hi" ? "योजनाएं और लाभ देखें" : "Explore schemes and benefits"}
          </p>
          <Link href="/schemes" className="text-accent-teal hover:underline font-medium">
            {lang === "hi" ? "यहाँ क्लिक करें" : "Click Here"}
          </Link>
        </CardContent>
      </Card>

    </div>
  </div>
</section>

      {/* Officer Section */}
      <section className="py-12 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-gov-blue mb-8 text-center">{t("objective_title")}</h2>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            {/* Left: Text */}
            <div className="space-y-6 text-left">
              <p className="text-gray-700 leading-relaxed">{t("objective_p1")}</p>
              <p className="text-gray-700 leading-relaxed">{t("objective_p2")}</p>
              <p className="text-gray-700 leading-relaxed">{t("objective_p3")}</p>
            </div>

            {/* Right: Image */}
            <div className="flex flex-col items-center">
              <img
                src="/images/officer-large.jpg"
                alt="Hon&apos;ble Minister Shri Jual Oram"
                className="w-full max-w-sm rounded-md shadow-lg object-cover"
                style={{ height: "360px" }}
              />
              <div className="mt-4 text-center">
                <h4 className="font-semibold text-gov-blue">Shri Jual Oram</h4>
                <p className="text-sm text-gray-600">Hon&apos;ble Minister</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
