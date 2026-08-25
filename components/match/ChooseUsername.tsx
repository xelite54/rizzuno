"use client"

import { useState } from "react"

type ChooseUsernameProps = {
  onChosen: (username: string) => void
}

/**
 * One required step between signing in and entering the app — this is how
 * a real match will see you, so it isn't optional. Claims the username
 * server-side (see app/api/profile/username) before calling `onChosen` —
 * usernames are now permanently unique per lib/db.ts's `claimUsername()`,
 * so this actually blocks one already taken by another account rather than
 * just checking length/characters and hoping for the best.
 */
export function ChooseUsername({ onChosen }: ChooseUsernameProps) {
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cleaned = value.trim().toLowerCase()
  const tooShort = cleaned.length > 0 && cleaned.length < 3
  const valid = cleaned.length >= 3

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/profile/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleaned }),
      })
      if (res.ok) {
        onChosen(cleaned)
        return
      }
      if (res.status === 409) {
        setError("That username is already taken — try another.")
      } else {
        setError("Something went wrong — try again.")
      }
    } catch {
      setError("Something went wrong — try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">Choose a username</h1>
        <p className="mt-1.5 text-[13px] text-muted">This is how the people you meet will see you.</p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3 transition focus-within:border-foreground/25">
            <span className="text-[15px] text-muted">@</span>
            <input
              autoFocus
              value={value}
              onChange={(event) => {
                setValue(event.target.value.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24))
                // A prior "taken" error is about the value that produced
                // it, not whatever's typed next — clear it the moment the
                // field changes rather than leaving stale text on screen.
                setError(null)
              }}
              placeholder="username"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted focus:outline-none"
            />
          </div>

          <p className="mt-2 min-h-[16px] text-[12px]">
            {error ? (
              <span className="text-danger">{error}</span>
            ) : (
              tooShort && <span className="text-muted">At least 3 characters.</span>
            )}
          </p>

          <button
            type="submit"
            disabled={!valid || submitting}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-foreground text-[14px] font-semibold text-background transition-all duration-200 hover:-translate-y-px hover:brightness-95 active:translate-y-0 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 disabled:pointer-events-none disabled:opacity-40"
          >
            {submitting ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  )
}
