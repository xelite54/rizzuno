import Link from "next/link"
import { auth } from "@/auth"
import { listRecentMatchesForReporting } from "@/lib/db"
import { REPORT_CATEGORIES as CATEGORY_VALUES, type ReportCategory } from "@/lib/signaling/protocol"
import { reportRecentMatch } from "./actions"
import { LegalNav } from "@/components/LegalNav"

export const dynamic="force-dynamic"
const CATEGORY_LABELS:Record<ReportCategory,string>={sexual_content:"Sexual content",harassment:"Harassment",hate:"Hate",scam:"Scam",spam:"Spam",underage_concern:"Underage concern",violence:"Violence",other:"Other"}
const REPORT_CATEGORIES=CATEGORY_VALUES.map(value=>({value,label:CATEGORY_LABELS[value]}))

export default async function RecentReportsPage({searchParams}:{searchParams:Promise<{submitted?:string;error?:string}>}){
  const session=await auth()
  const query=await searchParams
  const matches=session?.user?.id?await listRecentMatchesForReporting(session.user.id):[]
  return <main className="h-dvh overflow-y-auto px-6 py-10"><div className="mx-auto max-w-2xl space-y-6">
    <div><Link href="/" className="text-sm text-muted underline">← Back to Rizzuno</Link><h1 className="mt-4 text-3xl font-bold">Report a recent match</h1>
      <p className="mt-2 text-sm text-muted">This private list contains only still-reportable sessions for your signed-in account. It is not a public browsing history and never reveals the other account&apos;s internal identifier.</p></div>
    {!session?.user?.id?<p className="rounded-xl border border-border p-4">Sign in from the Rizzuno home page to view your recent matches.</p>:
      <>
        {query.submitted==="1"&&<p className="rounded-xl border border-border p-3">Report submitted. The other user is not notified.</p>}
        {query.error==="unavailable"&&<p className="rounded-xl border border-danger p-3 text-danger">That session is no longer eligible for reporting.</p>}
        {matches.length===0?<p className="rounded-xl border border-border p-4 text-muted">No recent reportable matches.</p>:
          <div className="space-y-4">{matches.map(match=><section key={match.matchId} className="rounded-2xl border border-border p-4">
            <h2 className="font-semibold">{match.username?`@${match.username}`:"Recent Rizzuno match"}</h2>
            <p className="mt-1 text-xs text-muted">Started {new Date(match.startedAt).toLocaleString()} · report available until {new Date(match.reportEligibleUntil).toLocaleString()}</p>
            {match.reported?<p className="mt-3 text-sm text-muted">You already reported this session.</p>:
              <form action={reportRecentMatch} className="mt-4 grid gap-3">
                <input type="hidden" name="matchId" value={match.matchId}/>
                <label className="grid gap-1 text-sm">Reason<select name="category" required className="rounded-lg border border-border bg-surface p-2">{REPORT_CATEGORIES.map(category=><option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
                <label className="grid gap-1 text-sm">Details (optional)<textarea name="details" maxLength={500} className="min-h-24 rounded-lg border border-border bg-surface p-2"/></label>
                <button className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Submit report</button>
              </form>}
          </section>)}</div>}
      </>}
    <p className="text-sm text-muted">For immediate danger, contact local emergency services. See the <Link href="/safety" className="underline">Safety Center</Link>.</p>
    <LegalNav className="border-t border-border pt-4"/>
  </div></main>
}
