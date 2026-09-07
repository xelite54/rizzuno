"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRizzPlus } from "@/components/RizzPlusProvider"
import styles from "./page.module.css"
import { safeUpgradeReturn } from "@/lib/upgradeNavigation"

const benefits = [
  ["01", "Stay in the moment", "An ad-free experience."],
  ["02", "More of you", "Post photos to your profile."],
  ["03", "Your choice", "Change your gender selection anytime."],
  ["04", "A second chance", "Undo a skip during the undo window, while the other person is still connected."],
  ["05", "Make it personal", "Change your profile photo."],
  ["06", "Keep the connection", "Send friend requests. The other person can accept without Rizz+."],
]

export default function RizzPlusPage() {
  const { status } = useSession()
  const { active, loading, canManage, refresh } = useRizzPlus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [returnTo, setReturnTo] = useState("/")
  const [confirmCancel, setConfirmCancel] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the internal return destination after hydration
    setReturnTo(safeUpgradeReturn(new URLSearchParams(window.location.search).get("returnTo")))
  }, [])

  async function cancelMembership() {
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/billing/cancel", { method: "POST" })
      if (!response.ok) throw new Error()
      setReturned(false)
      await refresh()
      setConfirmCancel(false)
    } catch { setError("Couldn’t cancel your test membership. Please try again.") }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("checkout") !== "success") return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read Checkout return state after hydration
    setReturned(true)
    setWaiting(true)
    let attempts = 0
    void refresh()
    const timer = setInterval(() => { void refresh(); if (++attempts >= 10) { clearInterval(timer); setWaiting(false) } }, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  async function openBilling(manage = false) {
    if (status !== "authenticated") { await signIn("google", { redirectTo: `/rizz-plus?returnTo=${encodeURIComponent(returnTo)}` }); return }
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/billing/${manage ? "portal" : "checkout"}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok) {
        const messages: Record<string, string> = {
          not_authenticated: "Your session expired. Sign in again, then activate Rizz+.",
          rate_limited: "Too many attempts. Wait a minute, then try again.",
          invalid_origin: "The request was rejected. Reload this page and try again from the same website.",
          account_unavailable: "Rizz+ cannot be activated while your account is restricted.",
          billing_unavailable: "Membership could not be saved. Please try again; if this continues, the server’s database connection needs checking.",
        }
        setError(messages[data.error] ?? "Couldn’t activate Rizz+. Please try again shortly.")
        setBusy(false)
        return
      }
      if (data.active === true && data.testMode === true) {
        await refresh()
        setReturned(true)
        setWaiting(false)
        setBusy(false)
        return
      }
      if (!data.url) throw new Error()
      window.location.assign(data.url)
    } catch { setError(manage ? "Billing isn’t available right now. Please try again shortly." : "Couldn’t activate Rizz+. Please try again shortly."); setBusy(false) }
  }

  return (
    <main className={`${styles.page} h-dvh overflow-hidden text-[#f5eff5]`}>
      <nav className={styles.nav}>
        <Link href={returnTo} className={styles.back} aria-label="Go back"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Back</span></Link>
        <Link href="/" className="text-[15px] font-medium tracking-tight text-white/60">Rizzuno<span className="text-white/40">.com</span></Link>
      </nav>
      <div className={styles.stage}>
      <div className={styles.layout}>
        <section className={styles.story}>
          <div className={styles.pass} aria-label="Rizz+ membership pass preview">
            <div className={styles.passMain}>
              <div className={styles.passName}>Rizz<span>+</span></div>
              <div className={styles.price}><span>$4.99</span><p>/ month at launch</p></div>
            </div>
          </div>
        </section>
        <section className={styles.details} aria-label="Membership benefits">
          <ul className={styles.benefits}>
            {benefits.map(([number, title, description]) => <li key={number}><span className={styles.benefitNumber}>{number}</span><div><h3>{title}</h3><p>{description}</p></div></li>)}
          </ul>
          {returned && !active && <p role="status" className="mt-3 text-[13px] text-[#ddb8d2]">{waiting ? "Confirming your membership…" : "Refresh your membership status below to confirm activation."}</p>}
          {returned && active && <p role="status" className="mt-3 text-[13px] text-[#ddb8d2]">Rizz+ is active. Your features are unlocked.</p>}
          {error && <p role="alert" className="mt-3 text-[13px] text-[#f2a4b7]">{error}</p>}
          {/* A free grant (see grantFreeRizzPlus in lib/db.ts) has no real
              Stripe customer behind it, so there's nothing for the billing
              portal to manage — canManage stays false for it. Only a real
              paid subscription gets the "Manage subscription" action;
              a free member just sees their status here instead of a button
              that would otherwise 404 against the portal route. */}
          <button disabled={busy || loading || (returned && !active) || (active && !canManage)} onClick={() => void openBilling(active)} className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-[#e8cedf] px-5 text-[14px] font-semibold text-[#261b28] transition hover:bg-[#f2deeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"><span>{busy ? (active && canManage ? "Opening billing…" : "Activating Rizz+…") : loading ? "Checking membership…" : active ? (canManage ? "Manage subscription" : "You’re a Rizz+ member") : "Get Rizz+"}</span></button>
          {active && (canManage ? <button disabled={busy} onClick={() => void openBilling(true)} className="mt-3 w-full text-xs text-white/70 underline">Cancel paid subscription in billing ↗</button> : confirmCancel ? <div className="mt-4 rounded-xl border border-white/15 p-4 text-xs"><p>Cancel test Rizz+? Plus features will lock immediately. Your friends and existing photos stay.</p><div className="mt-3 flex gap-4"><button disabled={busy} onClick={() => setConfirmCancel(false)}>Keep Rizz+</button><button disabled={busy} onClick={() => void cancelMembership()} className="text-[#f2a4b7]">Confirm cancellation</button></div></div> : <button disabled={busy} onClick={() => setConfirmCancel(true)} className="mt-3 w-full text-xs text-white/70 underline">Cancel test membership</button>)}
          {!active && canManage && <button onClick={() => void openBilling(true)} disabled={busy} className="mt-2 w-full text-[12px] text-white/60 underline underline-offset-4">Manage existing billing</button>}
          {returned && !active && <button onClick={() => void refresh()} className="mt-2 w-full text-[12px] text-white/60 underline underline-offset-4">Refresh membership status</button>}
          <p className="mt-3 text-[11px] leading-relaxed text-white/60">Temporary test access. No card required and no automatic charge from this activation.</p>
          <p className="mt-2 text-[11px] text-white/30">Rizzuno currently has no ads for any users. Membership does not bypass content moderation.</p>
          <div className="mt-3 flex gap-4 text-[11px] text-white/45"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div>
        </section>
      </div>
      </div>
    </main>
  )
}
