# Google Developer Week judging freeze

Target: `https://googledevweekjul.corydev.com`

Status: prepared only. Do not commit, tag, clone, start a service, copy production
data, or change Caddy routing until the explicit freeze instruction is given.

## Isolation contract

The judging deployment must remain unaffected by later work in
`storyscrolls-next`:

- Create an independent local clone with `--no-hardlinks` at
  `/Users/coryboehne/Server Hosting/sites/storyscrolls-googledevweekjul-frozen`.
- Check out one annotated judging tag in detached state and make the frozen
  checkout read-only after installation and build.
- Install dependencies from the committed lockfile and build inside the frozen
  checkout. Never serve `dist` from the active project.
- Copy runtime data to
  `/Users/coryboehne/Server Hosting/_data/storyscrolls-googledevweekjul-frozen`.
  Use SQLite's online backup operation for the database so the WAL-backed live
  database is captured consistently.
- Run the frozen API on its own port (`4309`), with its own session secret and
  data directory. It must never read or write the production data directory.
- Import Caddy routing from the frozen checkout's
  `deployment/googledevweekjul.caddy`, not from the active project.
- Do not use symlinks from the frozen checkout or data directory to production.

## Freeze sequence

1. Stop feature edits long enough to run the full test suite and production
   build once against the exact candidate.
2. Review staged files and run the secret scan again.
3. Create the initial Git commit, then an annotated tag named
   `googledevweekjul-judging-YYYYMMDD-HHMM`.
4. Record the commit, tag, UTC timestamp, Node and npm versions, and a SHA-256
   inventory of tracked files in a freeze manifest.
5. Create the independent no-hardlinks clone from that tag.
6. Run `npm ci` and the production build in the frozen clone.
7. Create the independent runtime-data directory, copy non-database runtime
   assets, and use SQLite `.backup` for `storyscrolls.sqlite3`.
8. Generate a separate 32-byte session secret and store it in macOS Keychain as
   `com.corydev.googledevweekjul-storyscrolls.session-secret`.
9. Install and start the prepared launch agent. Confirm only the frozen project
   and frozen data paths appear in its process environment and command line.
10. Import the prepared Caddy snippet into the loopback Caddy server, validate
    the complete configuration, and reload it.
11. Verify the judging hostname, static assets, representative book routes,
    Story Studio, API health, security headers, and an isolated non-production
    write path.
12. Make source, dependencies, and built assets in the frozen checkout
    read-only. Leave only the frozen runtime-data directory writable.

## Acceptance checks

- The judging hostname returns `200` over HTTPS and is marked `noindex`.
- Home, Community, Create, About, and representative story routes load from the
  frozen `dist/client` path.
- `/api/v2/health` and required creation endpoints are served by port `4309`.
- The frozen service remains healthy after the active Story Scrolls service is
  restarted.
- Rebuilding or modifying `storyscrolls-next` does not change hashes in the
  frozen checkout or its rendered assets.
- A judging-domain write changes only the frozen database/data directory.
- No API key, OAuth secret, session secret, cloud token, `.env` file, build
  cache, dependency directory, or Playwright artifact is tracked by Git.

## Prepared files

- `deployment/run-googledevweekjul-platform.zsh`
- `deployment/com.corydev.googledevweekjul-storyscrolls-platform.plist`
- `deployment/googledevweekjul.caddy`

These files are inert until the freeze sequence installs or imports them.
