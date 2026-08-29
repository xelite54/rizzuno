"use client"

import type { AccountRestriction } from "@/hooks/useMatchmaking"

type AccountRestrictedProps = {
  restriction: AccountRestriction
  onSignOut: () => void
}

function describe(restriction: AccountRestriction): { title: string; body: string } {
  switch (restriction.reason) {
    case "banned":
      return {
        title: "Account suspended permanently",
        body: restriction.detail
          ? `This account has been permanently banned from Rizzuno: ${restriction.detail}`
          : "This account has been permanently banned from Rizzuno.",
      }
    case "suspended":
      return {
        title: "Account temporarily suspended",
        body: restriction.until
          ? `This account is suspended until ${new Date(restriction.until).toLocaleString()}.`
          : "This account is temporarily suspended.",
      }
    case "account_deleted":
      return {
        title: "Account deleted",
        body: "This account was deleted. Sign in again to create a new one.",
      }
    case "acceptance_required":
      return {
        title: "Terms have changed",
        body: "Please sign out and back in to review the updated Terms and Privacy Policy.",
      }
    case "connection_failed":
      return {
        title: "Can't connect right now",
        body: "Rizzuno couldn't set up a live connection after several tries. This isn't something wrong with your account — it's a server-side issue. It'll keep retrying on its own; try again in a minute if this doesn't clear up.",
      }
  }
}

/** Shown instead of the matching screen once the server has told us this account can't matchmake — a real ban/suspension is enforced here, not just left to happen silently. */
export function AccountRestricted({ restriction, onSignOut }: AccountRestrictedProps) {
  const { title, body } = describe(restriction)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl bg-background px-7 py-6 text-center sm:px-10">
      <div className="w-full max-w-xs">
        <h1 className="text-[18px] font-semibold text-foreground">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-xl border border-border text-[13px] font-medium text-foreground transition hover:bg-surface-2"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
