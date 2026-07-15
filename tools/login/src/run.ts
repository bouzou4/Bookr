/**
 * Thin browser-driving entrypoint: opens a real, visible Chromium window on the provider's
 * login page, lets a human complete the interactive sign-in (including any CAPTCHA/2FA), then
 * hands the captured network traffic to {@link extractResySession} and pushes the resulting
 * session with {@link pushSession}.
 *
 * Deliberately kept free of any logic worth unit-testing: everything decision-worthy lives in
 * `resy.ts` and `push.ts`. This file only wires a real browser to those pure functions and is
 * excluded from coverage (see `vitest.config.ts`) since it cannot run headlessly or in CI.
 *
 * @packageDocumentation
 */

import { chromium } from "playwright";
import type { CapturedCookie, CapturedRequest } from "./resy.ts";
import { extractResySession } from "./resy.ts";
import { pushSession } from "./push.ts";

const RESY_LOGIN_URL = "https://resy.com/login";
const RESY_API_HOST = "api.resy.com";

/**
 * Resolve required configuration from the environment. Kept as a small function (rather than
 * inlined) so a missing value produces one clear error instead of a scattered `undefined`.
 *
 * @returns The base URL and ingest token to push the captured session to.
 * @throws An Error if either required environment variable is unset.
 */
function loadRunConfig(): { baseUrl: string; ingestToken: string } {
  const baseUrl = process.env.BOOKR_BASE_URL;
  const ingestToken = process.env.BOOKR_INGEST_TOKEN;
  if (!baseUrl || !ingestToken) {
    throw new Error(
      "Set BOOKR_BASE_URL (e.g. https://bookr.example.com) and BOOKR_INGEST_TOKEN before running.",
    );
  }
  return { baseUrl, ingestToken };
}

/**
 * Wait for the operator to press Enter in the terminal, used as the cue that interactive login
 * has finished and it's safe to read cookies and push the session.
 *
 * @returns A promise that resolves once a line of input is received.
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

/**
 * Drive an interactive Resy login in a real, headed browser and push the captured session to
 * Bookr's ingest endpoint.
 */
async function run(): Promise<void> {
  const { baseUrl, ingestToken } = loadRunConfig();

  const capturedRequests: CapturedRequest[] = [];
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes(RESY_API_HOST)) {
        capturedRequests.push({ url, headers: request.headers() });
      }
    });

    await page.goto(RESY_LOGIN_URL);
    console.log("Log in to Resy in the opened browser window.");
    console.log("Once you're signed in, come back here and press Enter to capture the session.");
    await waitForEnter();

    const rawCookies = await context.cookies();
    const cookies: CapturedCookie[] = rawCookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
    }));

    const session = extractResySession(capturedRequests, cookies);
    await pushSession(baseUrl, ingestToken, "resy", session);
    console.log(`Session captured and pushed to ${baseUrl}.`);
  } finally {
    await browser.close();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
