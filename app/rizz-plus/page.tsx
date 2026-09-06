"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRizzPlus } from "@/components/RizzPlusProvider"
import styles from "./page.module.css"

const benefits = [
  ["01", "Stay in the moment", "An ad-free experience."],
  ["02", "More of you", "Post photos to your profile."],
  ["03", "Your choice", "Change your gender selection anytime."],
  ["04", "A second chance", "Undo a skip during the undo window, while the other person is still connected."],
  ["05", "Make it personal", "Change your profile photo."],
]

export default function RizzPlusPage() {
  const { status } = useSession()
  const { active, loading, canManage, refresh } = useRizzPlus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState(false)
  const [waiting, setWaiting] = useState(false)
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
    if (status !== "authenticated") { await signIn("google", { redirectTo: "/rizz-plus" }); return }
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/billing/${manage ? "portal" : "checkout"}`, { method: "POST" })
      const data = await response.json()
      if (!response.ok || !data.url) throw new Error()
      window.location.assign(data.url)
    } catch { setError("Billing isn’t available right now. Please try again shortly."); setBusy(false) }
  }

  return (
    <main className={`${styles.page} h-dvh overflow-y-auto text-[#f5eff5]`}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" className="text-[17px] font-semibold tracking-tight">Rizzuno<span className="text-white/40">.com</span></Link>
        <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-[13px] text-white/70 hover:bg-white/5">Back to home ↗</Link>
      </nav>
      <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-8 sm:px-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20 lg:pt-16">
        <section className="relative">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-[#c8adc5]">A little more possibility</p>
          <h1 className="mt-6 text-[clamp(4.5rem,12vw,8rem)] font-semibold leading-none tracking-[-0.08em]">Rizz<span className="text-[#ddb8d2]">+</span></h1>
          <p className="mt-5 max-w-sm text-[clamp(1.5rem,3vw,2.2rem)] leading-tight tracking-[-0.04em] text-white/80">Same moment.<br />More ways to make it yours.</p>
          <div className={styles.emblem} aria-hidden="true"><span /><span /></div>
          <p className="mt-6 max-w-xs text-[12px] leading-relaxed text-white/40">One membership. All five features.<br />A small + on your profile makes it official.</p>
        </section>
        <section className="self-center rounded-[28px] border border-white/12 bg-[#17121b]/85 p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4"><h2 className="text-[18px] font-medium">{active ? "You’re Rizz+" : "Make room for more"}</h2><span className="rounded-full border border-[#c69abc]/30 px-3 py-1 text-[11px] text-[#ddb8d2]">{active ? "Member +" : "Monthly"}</span></div>
          <div className="mt-6 flex items-baseline gap-2"><span className="text-[56px] font-medium leading-none tracking-[-0.06em]">$4.99</span><span className="text-[13px] text-white/45">USD / month</span></div>
          <div className="mt-8 divide-y divide-white/8">
            {benefits.map(([number, title, description]) => <div key={number} className="flex gap-4 py-4"><span className="pt-0.5 text-[10px] tabular-nums text-[#b796b2]">{number}</span><div><h3 className="text-[14px] font-medium">{title}</h3><p className="mt-1 text-[12px] leading-relaxed text-white/45">{description}</p></div></div>)}
          </div>
          {returned && !active && <p role="status" className="mt-4 text-[13px] text-[#ddb8d2]">{waiting ? "Confirming your subscription…" : "Confirmation is taking longer than expected. Refresh your status below before trying another payment."}</p>}
          {error && <p role="alert" className="mt-4 text-[13px] text-[#f2a4b7]">{error}</p>}
          <button disabled={busy || loading || (returned && !active)} onClick={() => void openBilling(active)} className="mt-6 flex h-13 w-full items-center justify-between rounded-2xl bg-[#e8cedf] px-5 text-[14px] font-semibold text-[#261b28] transition hover:bg-[#f2deeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"><span>{busy ? "Opening Stripe…" : loading ? "Checking membership…" : active ? "Manage subscription" : "Get Rizz+"}</span><span aria-hidden="true">↗</span></button>
          {!active && canManage && <button onClick={() => void openBilling(true)} disabled={busy} className="mt-3 w-full text-[12px] text-white/60 underline underline-offset-4">Manage existing billing</button>}
          {returned && !active && <button onClick={() => void refresh()} className="mt-3 w-full text-[12px] text-white/60 underline underline-offset-4">Refresh membership status</button>}
          <p className="mt-4 text-[11px] leading-relaxed text-white/40">Renews automatically at US$4.99/month until canceled. Cancel through Manage subscription; access continues until the paid period ends. Taxes, if applicable, are shown at checkout. Secure payment through Stripe.</p>
          <p className="mt-3 text-[11px] text-white/30">Rizzuno currently has no ads for any users. Membership does not bypass content moderation.</p>
          <div className="mt-4 flex gap-4 text-[11px] text-white/45"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div>
        </section>
      </div>
    </main>
  )
}
