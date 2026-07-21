import type { Metadata } from "next";
import Link from "next/link";
import { PlatformFooter, PlatformHeader } from "../platform/site-shell";

export const metadata: Metadata = {
  title: "Privacy — The Story Scrolls",
  description:
    "How The Story Scrolls handles account data, creator API keys, manuscripts, generated scrolls, cookies, and reader preferences.",
  alternates: { canonical: "/privacy/" },
};

export default function PrivacyPage() {
  return (
    <main className="ss-platform ss-about-page">
      <PlatformHeader />

      <section className="ss-about-hero" aria-labelledby="privacy-title">
        <div className="ss-about-hero__copy">
          <p className="ss-kicker">Privacy in plain language</p>
          <h1 id="privacy-title">Your story is yours. Your API key is never ours.</h1>
          <p>
            The Story Scrolls collects only what it needs to run the reading room,
            protect the community, and complete the generation work you request.
            This policy explains those boundaries without hiding them in fine print.
          </p>
          <p>Effective July 21, 2026.</p>
        </div>
        <div className="ss-about-hero__promise" aria-label="Our privacy promise">
          <span aria-hidden="true">S</span>
          <p>Request-only keys. Deliberate sharing. Clear provenance.</p>
        </div>
      </section>

      <section className="ss-about-standards" aria-labelledby="collect-title">
        <header>
          <p className="ss-kicker">What we handle</p>
          <h2 id="collect-title">The minimum information needed to make and share a scroll.</h2>
        </header>
        <div>
          <article>
            <h3>Account and session data</h3>
            <p>
              If you sign in with Google, we receive your Google account identifier,
              display name, and email address. We store an irreversible email
              fingerprint instead of the plain email address, plus an opaque session
              record and the membership information required to apply creation limits.
            </p>
          </article>
          <article>
            <h3>Stories and creation records</h3>
            <p>
              We process submitted source text to complete the requested generation,
              then remove its upload staging copy. We store the resulting story and
              images, provenance and transformation details, model and quality choices,
              visibility, moderation results, reports, and enough job metadata to
              explain a creation. A private scroll is not included in the public catalog.
            </p>
          </article>
          <article>
            <h3>Your OpenAI API key</h3>
            <p>
              Your key is transmitted over TLS for the generation request, held only
              in process memory, and forwarded to OpenAI. It is never written to our
              database, files, logs, cookies, browser storage, analytics, or responses.
              The creator clears it from the form as soon as the request begins.
            </p>
          </article>
          <article>
            <h3>Reader preferences</h3>
            <p>
              Reading position, display preferences, and other reader conveniences may
              be stored locally in your browser. Authentication uses a secure,
              HttpOnly, SameSite cookie. We do not sell personal information or use
              cross-site advertising trackers.
            </p>
          </article>
        </div>
      </section>

      <section className="ss-about-ledger" aria-labelledby="use-title">
        <header>
          <p className="ss-kicker">How information moves</p>
          <h2 id="use-title">Purpose-limited from manuscript to finished scroll.</h2>
        </header>
        <ol>
          <li>
            <span>01</span>
            <div>
              <h3>OpenAI processes requested generations</h3>
              <p>
                Your selected source, instructions, and reference material are sent to
                OpenAI only when needed to perform the generation you approve. OpenAI’s
                own API terms and privacy commitments also apply.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Google provides sign-in</h3>
              <p>
                Google verifies your identity. We use the resulting account data only
                for access, attribution, safety, and membership limits—not advertising.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Visibility follows your choice</h3>
              <p>
                Private scrolls remain accessible to their creator; unlisted scrolls
                require their link; public scrolls may appear in search, discovery,
                source-version families, and search-engine indexes after review.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Safety records protect the library</h3>
              <p>
                We retain moderation decisions, substantiated reports, and limited
                security records so abuse cannot simply be repeated under a new title.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="ss-about-disclosure" aria-labelledby="choices-title">
        <p className="ss-kicker">Your choices</p>
        <h2 id="choices-title">Review, remove, or change what you share.</h2>
        <p>
          Contact us to request a visibility change or deletion of account and creator
          data, subject to narrow legal, security, backup, and moderation-retention
          needs. Public search engines and people who already downloaded shared
          material may retain their own copies. Send privacy and deletion requests to{` `}
          <a href="mailto:coryboehne@gmail.com">coryboehne@gmail.com</a>. Our{` `}
          <Link href="/about/">About page</Link> explains the project’s provenance promises.
        </p>
      </section>

      <PlatformFooter />
    </main>
  );
}
