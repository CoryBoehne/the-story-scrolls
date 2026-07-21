import type { Metadata } from "next";
import Link from "next/link";
import { PlatformFooter, PlatformHeader } from "../platform/site-shell";

export const metadata: Metadata = {
  title: "Terms & Community Rules — The Story Scrolls",
  description:
    "The rights, attribution, generation, sharing, moderation, and community rules for The Story Scrolls.",
  alternates: { canonical: "/terms/" },
};

export default function TermsPage() {
  return (
    <main className="ss-platform ss-about-page">
      <PlatformHeader />

      <section className="ss-about-hero" aria-labelledby="terms-title">
        <div className="ss-about-hero__copy">
          <p className="ss-kicker">Terms &amp; community rules</p>
          <h1 id="terms-title">Bring stories you may use. Share work you can stand behind.</h1>
          <p>
            The Story Scrolls is a reading room and a creative workshop—not an archive
            for stolen books or harmful material. By using it, you agree to the
            practical rules below. Effective July 21, 2026.
          </p>
        </div>
        <div className="ss-about-hero__promise" aria-label="The community promise">
          <span aria-hidden="true">S</span>
          <p>Rights affirmed. Changes named. People protected.</p>
        </div>
      </section>

      <section className="ss-about-standards" aria-labelledby="responsibility-title">
        <header>
          <p className="ss-kicker">Creator responsibility</p>
          <h2 id="responsibility-title">You choose the source, direction, and final publication.</h2>
        </header>
        <div>
          <article>
            <h3>Use only material you have rights to</h3>
            <p>
              You must own an upload, have permission to use it, or rely on a lawful
              public-domain edition in your jurisdiction. Project Gutenberg and other
              source labels are helpful references, not individualized legal advice.
            </p>
          </article>
          <article>
            <h3>Review AI-assisted work</h3>
            <p>
              Models can make factual, continuity, attribution, or safety mistakes.
              You are responsible for reviewing text, images, character references,
              age suitability, and provenance before asking us to publish your scroll.
            </p>
          </article>
          <article>
            <h3>Credit the beginning and the changes</h3>
            <p>
              Do not remove title-page provenance. Original author and source, scroll
              creator, transformations, model families, quality settings, and material
              human contributions must remain understandable to a reader.
            </p>
          </article>
          <article>
            <h3>Respect art and identity</h3>
            <p>
              Do not request impersonation, deceptive likenesses, or imitation of a
              living artist’s signature style. Describe visual traits, eras, media,
              palettes, and moods instead. Illuminated-letter previews and protected
              source assets may not be scraped or redistributed.
            </p>
          </article>
        </div>
      </section>

      <section className="ss-about-ledger" aria-labelledby="sharing-title">
        <header>
          <p className="ss-kicker">Sharing and access</p>
          <h2 id="sharing-title">Publication is always a deliberate step.</h2>
        </header>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Private, unlisted, or public</h3>
              <p>
                Private scrolls belong in the creator’s library. Unlisted scrolls may
                be visited by anyone with the link. Public scrolls may be cataloged,
                indexed, searched, grouped with adaptations of the same source, and
                featured after moderation.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>A limited hosting license</h3>
              <p>
                You retain whatever rights you hold. You grant The Story Scrolls the
                nonexclusive permission needed to store, process, display, moderate,
                back up, and—only at your selected visibility—share the scroll.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Public work may be reviewed or removed</h3>
              <p>
                Automated screening can hold work for human review. We may restrict or
                remove material after a rights complaint, safety report, deceptive
                provenance, abuse of quotas, or a material breach of these rules.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Creation limits protect the workshop</h3>
              <p>
                Membership and weekly publishing limits may apply. Trying to evade a
                limit, attack the service, automate scraping, or interfere with another
                person’s work can result in suspended access.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="ss-about-illuminated" aria-labelledby="safety-title">
        <div>
          <p className="ss-kicker">Content boundary</p>
          <h2 id="safety-title">Literature may be difficult. Exploitation is not welcome.</h2>
          <p>
            Thoughtful fantasy danger, age-appropriate horror, romance, grief,
            historical conflict, and other hard subjects may belong in stories. Do not
            upload or create child sexual abuse material, sexual content involving
            minors, nonconsensual intimate imagery, pornographic exploitation,
            doxxing, credible threats, extremist recruitment, malware, instructions
            for serious wrongdoing, or other clearly illegal material.
          </p>
          <p>
            Age adaptation changes events and visual treatment as well as vocabulary.
            A work labeled for young children must not preserve graphic violence,
            sexual material, frightening detail, or adult themes merely in simpler words.
          </p>
        </div>
        <aside>
          <strong>Report with context</strong>
          <p>
            Reports should identify the scroll, the specific concern, and whether it
            involves rights, safety, attribution, privacy, or age labeling. Good-faith
            reports are reviewed; weaponized or knowingly false reports are abuse.
          </p>
          <Link href="/about/#community-rules">Read our publishing principles</Link>
        </aside>
      </section>

      <section className="ss-about-disclosure" aria-labelledby="cost-title">
        <p className="ss-kicker">Costs and availability</p>
        <h2 id="cost-title">The estimate is a planning aid—not a spending guarantee.</h2>
        <p>
          You approve an estimated generation cost before expensive work begins and
          pay OpenAI through your own API account. Actual usage can vary with source
          length, revisions, model behavior, and retries. Use OpenAI project budgets
          and spend controls. The service and AI output are provided without a promise
          of uninterrupted availability, fitness, accuracy, or legal suitability; use
          them with your own judgment.
        </p>
        <p>
          Our <Link href="/privacy/">Privacy Policy</Link> explains how manuscripts,
          account data, and request-only API keys are handled.
        </p>
      </section>

      <PlatformFooter />
    </main>
  );
}
