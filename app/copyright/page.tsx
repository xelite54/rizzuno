import Link from "next/link"
import { LEGAL_CONFIG } from "@/lib/legalConfig"
import { RELATED_LEGAL_VERSIONS } from "@/lib/legalVersions"
import { LegalNav } from "@/components/LegalNav"
export const metadata = { title: "Copyright — Rizzuno" }
export default function CopyrightPage() {
  return <main className="h-dvh overflow-y-auto bg-background text-foreground"><article className="mx-auto max-w-3xl space-y-6 px-6 py-16 text-sm leading-relaxed">
    <h1 className="text-3xl font-bold">Copyright complaints</h1>
    <p>Version {RELATED_LEGAL_VERSIONS.copyright}. Respect others’ copyright when uploading profiles, posts or chat content. This policy forms part of our <Link href="/terms" className="underline">Terms</Link>.</p>
    <h2 className="text-lg font-semibold">Where to send a complaint</h2>
    {LEGAL_CONFIG.copyrightEmail && <p>Copyright-notice contact: <a className="underline" href={`mailto:${LEGAL_CONFIG.copyrightEmail}`}>{LEGAL_CONFIG.copyrightEmail}</a>.</p>}
    {LEGAL_CONFIG.dmca512Reliance && LEGAL_CONFIG.dmcaRegistered ? <p>The operator confirms that it is relying on the U.S. statutory process and has registered this designated agent: {LEGAL_CONFIG.dmcaAgentName}, {LEGAL_CONFIG.dmcaAgentAddress}, telephone {LEGAL_CONFIG.dmcaAgentPhone}. Send notices to the copyright-notice email above.</p> : <p>This complaint channel does not assert DMCA safe-harbor reliance or that a designated agent has been registered. The operator must make that decision and, if relying on 17 U.S.C. §512, independently complete and maintain registration before enabling that disclosure.</p>}
    <h2 className="text-lg font-semibold">Infringement notice</h2>
    <p>Send a written notice including:</p>
    <ol className="list-decimal space-y-2 pl-6">
      <li>Your name, mailing address, telephone number and email; identify the owner you represent.</li>
      <li>The copyrighted work, or a representative list for multiple works at one site.</li>
      <li>The allegedly infringing material and enough location information to find it, such as a profile/post URL, username and timestamp.</li>
      <li>Your good-faith belief that the disputed use lacks permission from the owner, its agent and the law. Consider legally permitted uses.</li>
      <li>A statement that your information is accurate and, under penalty of perjury, you are authorized to act for the owner of the allegedly infringed exclusive right.</li>
      <li>Your physical or electronic signature.</li>
    </ol>
    <p>We review notices, seek missing information when appropriate, and act expeditiously on qualifying complaints to remove or disable access. We notify the affected uploader where applicable. Do not attach unnecessary sensitive information.</p>
    <h2 className="text-lg font-semibold">Counter-notice and restoration</h2>
    <p>If removal resulted from mistake or misidentification, send a signed counter-notice identifying the removed material and its former location. Include your name, address and telephone number, and a statement under penalty of perjury of your good-faith belief that removal was mistaken.</p>
    <p>Include consent to the jurisdiction of the U.S. federal district court for your address, or, if outside the United States, a district where the service provider may be found; agree to accept service from the original complainant or their agent.</p>
    <p>Where the statutory process applies, we forward a valid counter-notice to the complainant. Restoration occurs 10–14 business days after receipt unless the complainant notifies us of a filed court action seeking to restrain infringement. Independently prohibited content may remain unavailable on a separate documented basis. We do not promise to recreate transient calls or content no longer retained.</p>
    <h2 className="text-lg font-semibold">Repeat infringement and handling information</h2>
    <p>We terminate repeat infringers in appropriate circumstances, considering substantiated incidents, reversals and counter-notices. We may restrict content or accounts while reviewing complaints. We maintain a case record of notices, decisions and communications under approved retention and legal holds. Notices and counter-notices may be shared with the other party as needed for this process; confidential safety-report evidence is handled separately. Knowingly material misrepresentations can create liability.</p>
    <p>See the <a className="underline" href="https://www.copyright.gov/512/">U.S. Copyright Office process guide</a>, <a className="underline" href="https://www.law.cornell.edu/uscode/text/17/512">17 U.S.C. §512</a>, and <a className="underline" href="https://www.copyright.gov/dmca-directory/">designated-agent directory</a>.</p>
    <LegalNav className="pt-4" />
  </article></main>
}
