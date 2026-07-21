import Link from "next/link";
import type { ReactNode } from "react";

type PlatformHeaderProps = {
  compact?: boolean;
  trailing?: ReactNode;
};

export function StoryScrollsMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`ss-brand${compact ? " ss-brand--compact" : ""}`} href="/">
      <span className="ss-brand__sigil" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="presentation">
          <defs>
            <linearGradient id="ss-mark-gold" x1="16" y1="12" x2="49" y2="53" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f3d798" />
              <stop offset=".52" stopColor="#d4a452" />
              <stop offset="1" stopColor="#946126" />
            </linearGradient>
            <radialGradient id="ss-mark-night" cx="32" cy="25" r="35" gradientUnits="userSpaceOnUse">
              <stop stopColor="#172637" />
              <stop offset="1" stopColor="#080d14" />
            </radialGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="#070b11" />
          <circle cx="32" cy="32" r="26" fill="url(#ss-mark-night)" stroke="#bd8a3d" strokeWidth="2" />
          <circle cx="32" cy="32" r="22.5" fill="none" stroke="#f2d89a" strokeOpacity=".16" />
          <path d="M17 20c6.2-7 21.6-8.5 29.1-2.4 5.7 4.7 2.2 12.8-8.2 14.3l-10.4 1.5C18.1 34.8 13.9 41.8 19 47c6.6 6.7 21.5 5.5 28.2-1.8" fill="none" stroke="#5a371a" strokeWidth="8" strokeLinecap="round" />
          <path d="M17 20c6.2-7 21.6-8.5 29.1-2.4 5.7 4.7 2.2 12.8-8.2 14.3l-10.4 1.5C18.1 34.8 13.9 41.8 19 47c6.6 6.7 21.5 5.5 28.2-1.8" fill="none" stroke="url(#ss-mark-gold)" strokeWidth="5.2" strokeLinecap="round" />
          <path d="M16.9 20c-3.7.1-5 4.8-1.8 6.5 2.5 1.3 5.4-.2 5.6-2.7M47.2 45.2c3.7-.1 5 4.8 1.8 6.5-2.5 1.3-5.4-.2-5.6-2.7" fill="none" stroke="#f0cf86" strokeWidth="1.8" strokeLinecap="round" />
          <path d="m32.6 23 .8 2.1 2.2.8-2.2.8-.8 2.2-.8-2.2-2.1-.8 2.1-.8Z" fill="#fff1bd" />
        </svg>
      </span>
      <span className="ss-brand__wordmark">
        <span>The Story</span>
        <strong>Scrolls</strong>
      </span>
    </Link>
  );
}

export function PlatformHeader({ compact = false, trailing }: PlatformHeaderProps) {
  return (
    <header className={`ss-header${compact ? " ss-header--compact" : ""}`}>
      <StoryScrollsMark compact={compact} />
      <nav className="ss-header__nav" aria-label="Primary navigation">
        <Link href="/#library">Library</Link>
        <Link href="/community/">Community</Link>
        <Link href="/about/">About</Link>
        <Link className="ss-header__create" href="/create/">
          Create a scroll
        </Link>
      </nav>
      {trailing ? <div className="ss-header__trailing">{trailing}</div> : null}
    </header>
  );
}

export function PlatformFooter() {
  return (
    <footer className="ss-footer">
      <StoryScrollsMark compact />
      <p>
        A crafted home for stories that may be freely shared—and for the people
        ready to tell their own.
      </p>
      <nav aria-label="Footer navigation">
        <Link href="/community/">Community library</Link>
        <Link href="/create/">Story Studio</Link>
        <Link href="/about/">About, rights &amp; provenance</Link>
        <Link href="/privacy/">Privacy</Link>
        <Link href="/terms/">Terms &amp; community rules</Link>
        <Link href="/#principles">Our principles</Link>
      </nav>
    </footer>
  );
}

export function BookOpenIcon() {
  return (
    <span className="ss-book-icon" aria-hidden="true">
      <i />
      <i />
    </span>
  );
}
