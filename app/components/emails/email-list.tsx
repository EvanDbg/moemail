"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { CreateDialog } from "./create-dialog"
import { ShareDialog } from "./share-dialog"
import { Mail, RefreshCw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useThrottle } from "@/hooks/use-throttle"
import { EMAIL_CONFIG } from "@/config"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ROLES } from "@/lib/permissions"
import { useUserRole } from "@/hooks/use-user-role"
import { useConfig } from "@/hooks/use-config"

interface Email {
  id: string
  address: string
  createdAt: number
  expiresAt: number
}

interface EmailListProps {
  onEmailSelect: (email: Email | null) => void
  selectedEmailId?: string
}

interface EmailResponse {
  emails: Email[]
  nextCursor: string | null
  total: number
}

export function EmailList({ onEmailSelect, selectedEmailId }: EmailListProps) {
  const { data: session } = useSession()
  const { config } = useConfig()
  const { role } = useUserRole()
  const t = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [emailToDelete, setEmailToDelete] = useState<Email | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const { toast } = useToast()
  const activeRequestIdRef = useRef(0)
  const emailsRef = useRef<Email[]>([])

  useEffect(() => {
    emailsRef.current = emails
  }, [emails])

  const fetchEmails = useCallback(async (options?: {
    cursor?: string
    search?: string
    resetList?: boolean
  }) => {
    const cursor = options?.cursor
    const search = options?.search ?? debouncedSearchQuery
    const resetList = options?.resetList ?? false
    const requestId = resetList ? activeRequestIdRef.current + 1 : activeRequestIdRef.current

    if (resetList) {
      activeRequestIdRef.current = requestId
    }

    try {
      const url = new URL("/api/emails", window.location.origin)
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      const normalizedSearch = search.trim()
      if (normalizedSearch) {
        url.searchParams.set('search', normalizedSearch)
      }
      const response = await fetch(url)
      const data = await response.json() as EmailResponse

      if (requestId !== activeRequestIdRef.current) {
        return
      }
      
      if (!cursor) {
        if (resetList) {
          setEmails(data.emails)
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }

        const newEmails = data.emails
        const oldEmails = emailsRef.current

        const lastDuplicateIndex = newEmails.findIndex(
          newEmail => oldEmails.some(oldEmail => oldEmail.id === newEmail.id)
        )

        if (lastDuplicateIndex === -1) {
          setEmails(newEmails)
          setNextCursor(data.nextCursor)
          setTotal(data.total)
          return
        }
        const uniqueNewEmails = newEmails.slice(0, lastDuplicateIndex)
        setEmails([...uniqueNewEmails, ...oldEmails])
        setTotal(data.total)
        return
      }
      setEmails(prev => [...prev, ...data.emails])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch emails:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }, [debouncedSearchQuery])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchEmails({ search: debouncedSearchQuery })
  }

  const handleScroll = useThrottle((e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMore) return

    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
    const threshold = clientHeight * 1.5
    const remainingScroll = scrollHeight - scrollTop

    if (remainingScroll <= threshold && nextCursor) {
      setLoadingMore(true)
      fetchEmails({ cursor: nextCursor, search: debouncedSearchQuery })
    }
  }, 200)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [searchQuery])

  useEffect(() => {
    if (!session) {
      return
    }

    setLoading(true)
    setRefreshing(false)
    setLoadingMore(false)
    setEmails([])
    setNextCursor(null)
    onEmailSelect(null)
    fetchEmails({ search: debouncedSearchQuery, resetList: true })
  }, [debouncedSearchQuery, fetchEmails, onEmailSelect, session])

  const handleDelete = async (email: Email) => {
    try {
      const response = await fetch(`/api/emails/${email.id}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        toast({
          title: t("error"),
          description: (data as { error: string }).error,
          variant: "destructive"
        })
        return
      }

      setEmails(prev => prev.filter(e => e.id !== email.id))
      setTotal(prev => prev - 1)

      toast({
        title: t("success"),
        description: t("deleteSuccess")
      })
      
      if (selectedEmailId === email.id) {
        onEmailSelect(null)
      }
    } catch {
      toast({
        title: t("error"),
        description: t("deleteFailed"),
        variant: "destructive"
      })
    } finally {
      setEmailToDelete(null)
    }
  }

  if (!session) return null

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-2 flex flex-col gap-2 border-b border-primary/20">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8"
          />
          <div className="flex justify-between items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={refreshing}
                className={cn("h-8 w-8 shrink-0", refreshing && "animate-spin")}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-500 truncate">
                {role === ROLES.EMPEROR ? (
                  t("emailCountUnlimited", { count: total })
                ) : (
                  t("emailCount", { count: total, max: config?.maxEmails || EMAIL_CONFIG.MAX_ACTIVE_EMAILS })
                )}
              </span>
            </div>
            <CreateDialog onEmailCreated={handleRefresh} />
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-2" onScroll={handleScroll}>
          {loading ? (
            <div className="text-center text-sm text-gray-500">{t("loading")}</div>
          ) : emails.length > 0 ? (
            <div className="space-y-1">
              {emails.map(email => (
                <div
                  key={email.id}
                  className={cn(
                    "flex items-center gap-2 rounded text-sm group",
                    selectedEmailId === email.id && "bg-primary/10"
                  )}
                >
                  <Button
                    variant="ghost"
                    className={cn(
                      "h-auto flex-1 justify-start gap-2 p-2 text-left hover:bg-primary/5",
                      selectedEmailId === email.id && "bg-primary/10 hover:bg-primary/10"
                    )}
                    onClick={() => onEmailSelect(email)}
                  >
                    <Mail className="h-4 w-4 shrink-0 text-primary/60" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{email.address}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(email.expiresAt).getFullYear() === 9999 ? (
                          t("permanent")
                        ) : (
                          `${t("expiresAt")}: ${new Date(email.expiresAt).toLocaleString()}`
                        )}
                      </div>
                    </div>
                  </Button>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1 pr-2">
                    <ShareDialog
                      emailId={email.id}
                      emailAddress={email.address}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEmailToDelete(email)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {loadingMore && (
                <div className="text-center text-sm text-gray-500 py-2">
                  {t("loadingMore")}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-sm text-gray-500">
              {debouncedSearchQuery ? t("noSearchResults") : t("noEmails")}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!emailToDelete} onOpenChange={() => setEmailToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { email: emailToDelete?.address || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => emailToDelete && handleDelete(emailToDelete)}
            >
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
} 
