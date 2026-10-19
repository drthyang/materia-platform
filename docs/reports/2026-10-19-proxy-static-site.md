# The local proxy on a page that has none

Pull request [#95](https://github.com/drthyang/web-refinement/pull/95),
branch `claude/proxy-static-site`, on `main`, 2026-10-19. From the user's
report: "API error 405: 405 <html> … 405 Not Allowed … </html>" with the
Copilot set to the local proxy.

## What was wrong

The local proxy lives in the dev and preview servers (`vite.config.ts`,
`src/agent/proxy.ts`). The published site is the static build on GitHub
Pages, which has no server code. There, the page's POST to
`/web-refinement/api/anthropic/v1/messages` reached GitHub's nginx, which
answers a POST to a static path with 405. The chat showed it raw.

## What changed

- **A health check.** The proxy answers `GET <base>api/anthropic/health` with
  `{proxy: true, key}`. It keeps the host check, and spends nothing.
- **Asked when the mode is chosen.** `proxyStatus` (`src/agent/proxyStatus.ts`,
  apart from the API client so the settings load no SDK) reads it as ready,
  no key, or absent. A static host's 404, or its index page served for any
  path, is absent. The Copilot settings show the answer under the mode.
- **Explained when a message fails.** A 404, 405 or 501 with no proxy error
  body, in proxy mode, reads as "This page has no proxy", with how to run the
  app locally or to use an API key. The proxy's own refusals keep their words.

## Evidence

- **Tests that fail on `main`:**
  - the health check, with and without a key (`proxy.test.ts`);
  - the three statuses, including a static host that serves HTML for any
    path, and a 404, 405 or 501 explained (`chat.test.ts`).
- **In a browser,** choosing "Local proxy" in the settings:
  - on `vite preview` (no key set): "The proxy is running but has no key…";
  - on the built site behind a plain static server, as on GitHub Pages:
    "This page has no proxy…". That server answers the POST with 501, which
    is why 501 is covered beside GitHub's 405.

## Not done

The status chip in the Copilot's header still shows "Local proxy" with a
green dot on a page without one. The line under the mode says what is wrong.
