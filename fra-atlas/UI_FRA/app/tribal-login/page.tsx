// app/tribal-login/page.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Loader2, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || ""; // e.g. http://localhost:8000

export default function TribalLoginPage() {
  const { t, lang } = useLanguage?.() ?? { t: (s: string) => s, lang: "en" };

  // form state
  const [identifier, setIdentifier] = useState(""); // Aadhaar / Mobile
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Simple validations
  const isValidMobile = (v: string) => /^\d{10}$/.test(v);
  const isValidAadhaar = (v: string) => /^\d{12}$/.test(v);

  const sendOtp = async () => {
    setError("");
    setInfo("");
    if (!isValidMobile(identifier) && !isValidAadhaar(identifier)) {
      setError(
        lang === "hi"
          ? "कृपया मान्य मोबाइल (10 अंकों) या आधार (12 अंकों) दर्ज करें।"
          : "Please enter a valid mobile (10 digits) or Aadhaar (12 digits)."
      );
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/auth/tribal/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: isValidMobile(identifier) ? "mobile" : "aadhaar", value: identifier }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // backend might return { detail: "..."} or { message: "..." }
        const msg = data?.detail || data?.message || (lang === "hi" ? "OTP भेजने में त्रुटि।" : "Failed to send OTP.");
        throw new Error(msg);
      }

      setOtpSent(true);
      setInfo(
        data?.message ||
          (lang === "hi"
            ? "OTP भेज दिया गया है — कृपया अपने मोबाइल/आधार रजिस्टर किए हुए नंबर पर देखें।"
            : "OTP sent — please check the registered mobile/Aadhaar channel.")
      );
    } catch (err: any) {
      setError(err?.message || (lang === "hi" ? "OTP भेजने में त्रुटि। पुनः प्रयास करें।" : "Failed to send OTP. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!otpSent) {
      setError(lang === "hi" ? "पहले OTP प्राप्त करें।" : "Please request an OTP first.");
      return;
    }
    if (!/^\d{4,6}$/.test(otp)) {
      setError(lang === "hi" ? "कृपया मान्य OTP दर्ज करें।" : "Please enter a valid OTP.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/auth/tribal/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: isValidMobile(identifier) ? "mobile" : "aadhaar", value: identifier, otp }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.detail || data?.message || (lang === "hi" ? "OTP सत्यापन विफल।" : "OTP verification failed.");
        throw new Error(msg);
      }

      // Backend should return { token: "...", user: { ... } } or similar
      if (data?.token) {
        try {
          localStorage.setItem("token", data.token);
        } catch (e) {
          // storage failures are non-fatal to login flow
          console.warn("Unable to set token in localStorage", e);
        }
      }

      setInfo(data?.message || (lang === "hi" ? "सफलतापूर्वक लॉगिन किया गया।" : "Logged in successfully."));

      // redirect to tribal dashboard (using full URL navigation to avoid next/router in some environments)
      // you can change to router.push("/tribal/dashboard") if you prefer
      window.location.href = "/tribal/dashboard";
    } catch (err: any) {
      setError(err?.message || (lang === "hi" ? "OTP सत्यापन विफल। पुनः प्रयास करें।" : "OTP verification failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <Card className="border border-gray-200 shadow-lg rounded-md">
          <CardHeader className="bg-gov-blue text-white rounded-t-md p-6 text-left">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-white/10 w-12 h-12 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-xl font-semibold">{lang === "hi" ? "जनजातीय लॉगिन" : "Tribal Login"}</CardTitle>
                <CardDescription className="text-gray-100 text-sm">
                  {lang === "hi" ? "अपने मोबाइल या आधार के माध्यम से OTP से लॉगिन करें" : "Sign in using OTP via Mobile or Aadhaar"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {/* Info / Error */}
            {error && (
              <Alert variant="destructive" className="mb-4">
                <div className="text-sm">{error}</div>
              </Alert>
            )}
            {info && (
              <Alert className="mb-4">
                <div className="text-sm">{info}</div>
              </Alert>
            )}

            <form onSubmit={handleSignIn} className="space-y-4">
              {/* Identifier */}
              <div>
                <Label htmlFor="identifier" className="text-sm font-medium text-gray-700">
                  {lang === "hi" ? "मोबाइल / आधार नंबर" : "Mobile / Aadhaar number"}
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="identifier"
                    name="identifier"
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value.replace(/\s+/g, ""))}
                    placeholder={lang === "hi" ? "10 अंकों मोबाइल या 12 अंकों आधार" : "10-digit mobile or 12-digit Aadhaar"}
                    className="pl-3 h-12 border-gray-300"
                    aria-describedby="identifier-help"
                    required
                  />
                </div>
                <p id="identifier-help" className="text-xs text-gray-500 mt-1">
                  {lang === "hi" ? "कृपया मोबाइल या आधार संख्या बिना स्पेस के दर्ज करें।" : "Enter mobile or Aadhaar number without spaces."}
                </p>
              </div>

              {/* OTP row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div className="sm:col-span-2">
                  <Label htmlFor="otp" className="text-sm font-medium text-gray-700">
                    {lang === "hi" ? "OTP" : "OTP"}
                  </Label>
                  <Input
                    id="otp"
                    name="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder={lang === "hi" ? "Enter OTP" : "Enter OTP"}
                    className="mt-1 h-12 border-gray-300"
                    aria-disabled={!otpSent}
                    disabled={!otpSent}
                  />
                </div>

                <div className="sm:col-span-1">
                  {!otpSent ? (
                    <Button
                      type="button"
                      onClick={sendOtp}
                      className="w-full h-12 bg-gov-saffron hover:bg-gov-saffron/90 text-white font-semibold"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                      {lang === "hi" ? "OTP भेजें" : "Send OTP"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setOtp("");
                        setOtpSent(false);
                        setInfo("");
                        setError("");
                      }}
                      className="w-full h-12"
                    >
                      {lang === "hi" ? "रिस्टार्ट करें" : "Restart"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mt-2">
                <Button
                  type="submit"
                  className="w-full sm:w-auto flex-1 h-12 bg-gov-blue text-white font-semibold"
                  disabled={loading || !otpSent}
                >
                  {loading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                  {lang === "hi" ? "साइन इन करें" : "Sign In"}
                </Button>

                <Link href="/helpdesk" className="text-sm text-gov-blue hover:underline mt-2 sm:mt-0">
                  {lang === "hi" ? "सहायता केंद्र" : "Helpdesk / Support"}
                </Link>
              </div>

              {/* Accessibility note */}
              <p className="text-xs text-gray-500 mt-3">
                {lang === "hi"
                  ? "ध्यान: यह पृष्ठ OTP आधारित प्रमाणन हेतु है। यदि आपके पास खाता है तो संबंधित अधिकारी लॉगिन का उपयोग करें।"
                  : "Note: This page uses OTP-based authentication. If you are an officer with credentials, please use Officer Login."}
              </p>
            </form>
          </CardContent>
        </Card>

        {/* Link back / other options */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-gov-blue hover:underline">
            ← {lang === "hi" ? "मुख पृष्ठ पर वापस जाएं" : "Back to Home"}
          </Link>
        </div>
      </div>
    </main>
  );
}
