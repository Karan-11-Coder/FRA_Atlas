"use client"

import type React from "react"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Loader2 } from "lucide-react"

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  // Dev bypass: set NEXT_PUBLIC_BYPASS_AUTH=true in .env.local to enable.
  // NEXT_PUBLIC_* vars are baked into the client bundle at build time, so
  // this must never be set in a production build.
  const bypass = process.env.NEXT_PUBLIC_BYPASS_AUTH === "true"

  const pathname = usePathname() ?? "/"

  const { isAuthenticated, isLoading, requireAuth } = useAuth()

  useEffect(() => {
    if (bypass) {
      // no-op when bypassing
      return
    }

    // Only call requireAuth once the auth hook has finished loading
    if (!isLoading && !isAuthenticated) {
      requireAuth()
    }
  }, [isLoading, isAuthenticated, requireAuth, bypass, pathname])

  // If dev bypass is active, render children immediately
  if (bypass) {
    return <>{children}</>
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-gov-blue" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null // requireAuth() handles redirect when appropriate
  }

  return <>{children}</>
}
