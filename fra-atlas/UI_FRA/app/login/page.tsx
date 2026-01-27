"use client"

import type React from "react"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Lock, Mail, AlertCircle } from "lucide-react"
import { loginRequest, setToken } from "@/lib/api" // <- updated import

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    rememberDevice: false,
  })

  const urlMessage = searchParams?.get("message")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    try {
      // Call backend login
      const response = await loginRequest(formData.username, formData.password)
      // store token returned by backend
      // store token for UI_FRA usage
       setToken(response.access_token)

// 🔑 PASS TOKEN TO OTHER FRONTEND VIA URL
      const token = response.access_token
      const atlasBase =
       process.env.NEXT_PUBLIC_FRA_ATLAS_URL || "http://localhost:5173"

      const atlasUrl = `${atlasBase}?token=${token}`

      if (typeof window !== "undefined") {
        window.location.href = atlasUrl
      } else {
        router.push(atlasUrl)
      }

    } catch (err: any) {
      console.error("Login error:", err)
      setError(err.message || "Login failed. Please check your credentials.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* ✅ Login Section */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <Card className="border border-gray-300 shadow-lg rounded-md">
            <CardHeader className="text-center border-b bg-gov-blue text-white py-6">
              <CardTitle className="text-2xl font-bold tracking-wide">
                Officer Login
              </CardTitle>
              <CardDescription className="text-gray-100 text-sm">
                Forest Rights Act Atlas Portal – Ministry of Tribal Affairs
              </CardDescription>
            </CardHeader>

            <CardContent className="p-8">
              {/* Alerts */}
              {urlMessage && (
                <Alert className="mb-6 border-yellow-300 bg-yellow-50">
                  <AlertCircle className="h-4 w-4 text-yellow-700" />
                  <AlertDescription className="text-yellow-800">
                    {urlMessage}
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert className="mb-6 border-red-300 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-700" />
                  <AlertDescription className="text-red-800">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              {/* Login form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Username */}
                <div>
                  <Label
                    htmlFor="username"
                    className="block text-sm font-semibold text-gray-700 mb-1"
                  >
                    Officer ID / Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="Enter Officer ID or Email"
                      value={formData.username}
                      onChange={(e) =>
                        handleInputChange("username", e.target.value)
                      }
                      className="pl-10 h-12 border-gray-300 focus:border-gov-blue focus:ring-gov-blue"
                      required
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <Label
                    htmlFor="password"
                    className="block text-sm font-semibold text-gray-700 mb-1"
                  >
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={(e) =>
                        handleInputChange("password", e.target.value)
                      }
                      className="pl-10 h-12 border-gray-300 focus:border-gov-blue focus:ring-gov-blue"
                      required
                    />
                  </div>
                </div>

                {/* Remember */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={formData.rememberDevice}
                    onCheckedChange={(checked) =>
                      handleInputChange("rememberDevice", checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="remember"
                    className="text-sm text-gray-700 cursor-pointer"
                  >
                    Remember this device
                  </Label>
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 bg-gov-saffron hover:bg-gov-saffron/90 text-white font-semibold text-lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing In...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>

              {/* Support Links */}
              <div className="mt-6 flex justify-between text-sm">
                <Link
                  href="/forgot-password"
                  className="text-gov-blue hover:underline font-medium"
                >
                  Forgot Password?
                </Link>
                <Link
                  href="/helpdesk"
                  className="text-gov-blue hover:underline font-medium"
                >
                  Helpdesk Contact
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Back to Home */}
          <div className="text-center mt-6">
            <Link
              href="/"
              className="text-gov-blue hover:underline text-sm font-semibold"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </main>

      {/* ✅ Standard Footer */}
    </div>
  )
}
