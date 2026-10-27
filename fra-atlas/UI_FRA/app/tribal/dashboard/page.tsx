"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const TOKEN_KEY = "fra_atlas_token";

interface MyClaimsResponse {
  linked: boolean;
  claims: any[];
  message: string;
}

export default function TribalDashboardPage() {
  const router = useRouter();
  const { lang } = useLanguage?.() ?? { lang: "en" };
  const [data, setData] = useState<MyClaimsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!token) {
      router.replace("/tribal-login");
      return;
    }

    fetch(`${API_BASE}/api/my-claims`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(TOKEN_KEY);
          router.replace("/tribal-login?message=Session expired - please sign in again");
          return null;
        }
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json) setData(json);
      })
      .catch((err) => setError(err?.message || "Failed to load claim status"))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <Card className="border border-gray-200 shadow-lg rounded-md">
          <CardHeader className="bg-gov-blue text-white rounded-t-md p-6">
            <CardTitle className="text-xl font-semibold">
              {lang === "hi" ? "मेरी दावा स्थिति" : "My Claim Status"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {loading && (
              <div className="flex items-center gap-2 text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                {lang === "hi" ? "लोड हो रहा है…" : "Loading…"}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {data && !data.linked && (
              <Alert>
                <AlertDescription>{data.message}</AlertDescription>
              </Alert>
            )}

            {data && data.linked && data.claims.length === 0 && (
              <p className="text-sm text-gray-600">
                {lang === "hi" ? "कोई दावा नहीं मिला।" : "No claims found for your account."}
              </p>
            )}

            <div className="pt-2">
              <Link href="/" className="text-gov-blue hover:underline text-sm">
                ← {lang === "hi" ? "मुख पृष्ठ पर वापस जाएं" : "Back to Home"}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
