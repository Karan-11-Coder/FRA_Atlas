"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getToken, clearToken, api } from "@/lib/api"

interface User {
  id: string
  username: string
  name: string
  role: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function loadUser() {
      const token = getToken()
      if (!token) {
        setIsLoading(false)
        return
      }

      try {
        // Validate the token against the server and fetch the real
        // identity behind it, instead of assuming any truthy token
        // means "logged in as Forest Officer".
        const res = await api.getMe()
        if (!cancelled) {
          setUser({
            id: String(res.user.id),
            username: res.user.username,
            name: res.user.full_name,
            role: res.user.role,
          })
        }
      } catch {
        // Invalid/expired token — treat as logged out.
        clearToken()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadUser()
    return () => {
      cancelled = true
    }
  }, [])

  const logout = () => {
    clearToken()
    setUser(null)
    router.push("/login")
  }

  const requireAuth = () => {
    if (!user && !isLoading) {
      router.push("/login")
    }
  }

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
    requireAuth,
  }
}
