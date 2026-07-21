import type { Metadata } from "next";
import Link from "next/link";
import { PlatformFooter, PlatformHeader } from "../platform/site-shell";

export const metadata: Metadata = {
  title: "About, Rights & Provenance — The Story Scrolls",
  description:
    "Why The Story Scrolls exists, how sources and AI-assisted transformations are credited, and the rights and privacy promises behind every scroll.",
  alternates: { canonical: "/about/" },
};

export default function AboutPage() {
  return (
    <main className="ss-platform ss-about-page">
      <PlatformHeader />

      <section className="ss-about-hero" aria-labelledby="about-title">
        <div className="ss-about-hero__copy">
          <p className="ss-kicker">Why these scrolls exist</p>
          <h1 id="about-title">Bring readers into the story—and writers into the craft.</h1>
          <p>
            The Story Scrolls turns stories people may lawfully use into beautiful,
            continuous reading journeys. It is built to spark a first love of books,
            rekindle an old one, and teach the choices that make a story move.
          </p>
          <div className="ss-about-hero__actions">
            <Link className="ss-button ss-button--gold" href="/#library">
              Find a story
            </Link>
            <Link className="ss-button ss-button--ghost" href="/create/">
              Make a scroll
            </Link>
          </div>
        </div>
        <div className="ss-about-hero__promise" aria-label="Our promise">
          <span aria-hidden="true">S</span>
          <p>Sources visible. Changes named. Creators credited.</p>
        </div>
      </section>

      <section className="ss-about-intent" aria-labelledby="intent-title">
        <p className="ss-kicker">A reading room and a workshop</p>
        <h2 id="intent-title">The technology should deepen attention—not replace imagination.</h2>
        <div className="ss-about-columns">
          <p>
            Readers can move through an illustrated, illuminated story without losing
            the quiet rhythm of the words. Age adaptations, translations, summaries,
            and picture-book forms can make a work approachable while keeping the
            original source and every material change clear.
          </p>
          <p>
            The guided studio asks about desire, obstacles, turning points,
            consequences, growth, theme, and resolution. AI may assist with drafting,
            but the process is designed to strengthen the human choices that make a
            story worth telling.
          </p>
        </div>
      </section>

      <section className="ss-about-ledger" aria-labelledby="ledger-title">
        <header>
          <p className="ss-kicker">The open ledger</p>
          <h2 id="ledger-title">Every title page should answer four questions.</h2>
        </header>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>Where did the story begin?</h3>
              <p>Original author, source edition or creator manuscript, and source link.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Who made this scroll?</h3>
              <p>The submitting creator and the contribution they chose to make.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>What changed?</h3>
              <p>Illustration, illumination, translation, modernization, reimagining, or summary.</p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Which tools helped?</h3>
              <p>Writing and image model families, quality levels, and human approval stages.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="ss-about-illuminated" id="illuminated-letters" aria-labelledby="letters-title">
        <div>
          <p className="ss-kicker">Creative partner</p>
          <h2 id="letters-title">A story deserves a memorable first mark.</h2>
          <p>
            Our growing illumination library is made in partnership with{" "}
            <a href="https://illuminatedfonts.com/">IlluminatedFonts.com</a>. The
            Story Studio reads directly from the canonical Illuminated Letters catalog.
            Every listed family is a complete, individually indexed alphabet rather than
            a handful of decorative samples.
          </p>
          <p>
            The selector receives only controlled, watermarked preview derivatives.
            Original art, archives, and raw glyph source paths are never published by
            The Story Scrolls catalog API.
          </p>
        </div>
        <aside>
          <strong>An honest boundary</strong>
          <p>
            Anything visible in a browser can be copied; no interface can truthfully
            promise otherwise. Catalog previews do not grant production rights. Usage
            terms are not published in the catalog, and production use requires a
            separate rights record.
          </p>
          <a href="https://illuminatedletters.corydev.com/">Explore Illuminated Letters</a>
        </aside>
      </section>

      <section className="ss-about-standards" aria-labelledby="standards-title">
        <header>
          <p className="ss-kicker">Rights, privacy, and care</p>
          <h2 id="standards-title">A joyful library still needs firm shelves.</h2>
        </header>
        <div>
          <article id="rights">
            <h3>Bring only what you may use</h3>
            <p>
              Uploaders must affirm that they own their text, have permission, or are
              using an applicable public-domain edition. A catalog label is not legal
              advice, and public-domain status can vary by jurisdiction.
            </p>
          </article>
          <article id="source-libraries">
            <h3>Source libraries &amp; thanks</h3>
            <p>
              Public-domain discovery and source editions are supported by the
              volunteers of{" "}
              <a href="https://www.gutenberg.org/">Project Gutenberg</a>. Automated
              imports use its listed mirrors and machine-readable catalog guidance,
              never its human-facing website as a scraping target.
            </p>
          </article>
          <article id="privacy">
            <h3>Your OpenAI key is request-only</h3>
            <p>
              A creator’s API key is sent over TLS for the chosen generation request,
              kept only in process memory, and never written to browser storage,
              cookies, the database, files, logs, or responses. OpenAI receives it to
              perform that request.
            </p>
          </article>
          <article id="sharing">
            <h3>Private first; public by choice</h3>
            <p>
              Signed-in creators choose whether to keep a scroll private or submit it
              for sharing. Public work passes automated safety checks and may be held
              for human review or removed after a substantiated report.
            </p>
          </article>
          <article id="community-rules">
            <h3>Room for hard stories—not exploitation</h3>
            <p>
              Fantasy danger, horror, romance, grief, and difficult ideas can belong in
              literature. Pornographic exploitation, sexual content involving minors,
              doxxing, extremist recruitment, malware, and clearly illegal material do not.
            </p>
          </article>
        </div>
      </section>

      <section className="ss-about-disclosure" aria-labelledby="disclosure-title">
        <p className="ss-kicker">Before generation</p>
        <h2 id="disclosure-title">See the plan. See the estimate. Keep the decision.</h2>
        <p>
          The Story Studio presents the transformation plan, character references,
          illustration count, model and quality choices, and a projected API cost for
          approval before production begins. Estimates are not guarantees;
          creators should use OpenAI project budgets and spend controls as a safety net.
        </p>
        <p>
          Questions about privacy, rights, attribution, or a published scroll may be
          sent to <a href="mailto:coryboehne@gmail.com">coryboehne@gmail.com</a>. Read the{` `}
          <Link href="/privacy/">Privacy Policy</Link> and{` `}
          <Link href="/terms/">Terms &amp; Community Rules</Link>.
        </p>
      </section>

      <PlatformFooter />
    </main>
  );
}
