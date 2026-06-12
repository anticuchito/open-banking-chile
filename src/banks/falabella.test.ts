import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { findChrome } from "../utils.js";
import { clickCmrEntry, clickMiCuenta } from "./falabella.js";

/**
 * Resolves a Chromium executable for tests: system Chrome first (same logic
 * as the scrapers), then Playwright's download cache so tests still run on
 * machines without Google Chrome installed.
 */
function findTestChromium(): string | null {
  const system = findChrome(process.env.CHROME_PATH);
  if (system) return system;

  const cacheRoots = [
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ];
  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const build of builds) {
      const candidates = [
        path.join(root, build, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(root, build, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        path.join(root, build, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(root, build, "chrome-linux", "chrome"),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const chromePath = findTestChromium();

/**
 * Wraps a body fragment in a page that records which element was clicked
 * (by id, or trimmed text if it has no id) in window.__clicked.
 */
function fixture(body: string): string {
  return `<!DOCTYPE html><html><body>${body}
    <script>
      window.__clicked = null;
      document.addEventListener("click", (e) => {
        e.preventDefault();
        const el = e.target.closest("a, button, div[id]");
        window.__clicked = el ? (el.id || el.textContent.trim()) : null;
      }, true);
    </script>
  </body></html>`;
}

describe.skipIf(!chromePath)("falabella page interactions", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromePath!, headless: true });
    page = await browser.newPage();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  function clicked(): Promise<string | null> {
    return page.evaluate(() => (window as { __clicked?: string | null }).__clicked ?? null);
  }

  describe("clickMiCuenta", () => {
    it("prefers #btn-auth-normal over the loan-calculator button that comes first in the DOM", async () => {
      await page.setContent(fixture(`
        <button type="button" id="loan-calculator">Mi cuenta</button>
        <button type="button" id="btn-auth-normal">Mi cuenta</button>
        <button type="button" id="btn-auth" style="display:none">Mi cuenta</button>
      `));
      await clickMiCuenta(page);
      expect(await clicked()).toBe("btn-auth-normal");
    });

    it("clicks #btn-auth when #btn-auth-normal exists but is hidden (responsive layout)", async () => {
      await page.setContent(fixture(`
        <button type="button" id="loan-calculator">Mi cuenta</button>
        <button type="button" id="btn-auth-normal" style="display:none">Mi cuenta</button>
        <button type="button" id="btn-auth">Mi cuenta</button>
      `));
      await clickMiCuenta(page);
      expect(await clicked()).toBe("btn-auth");
    });

    it("falls back to text matching when neither auth id exists", async () => {
      await page.setContent(fixture(`
        <a href="#" id="text-fallback">Mi cuenta</a>
      `));
      await clickMiCuenta(page);
      expect(await clicked()).toBe("text-fallback");
    });
  });

  describe("clickCmrEntry", () => {
    // Replicates the dashboard noise that made the old broad /CMR/ locator
    // fail with a strict-mode violation.
    const dashboardNoise = `
      <a href="#" id="logo">CMR</a>
      <a href="#" id="cmr-puntos">CMR Puntos</a>
      <div id="cupo-banner">Aumenta tu cupo CMR</div>
    `;

    it("clicks the 'Estado de cuenta' button even when many elements contain 'CMR'", async () => {
      await page.setContent(fixture(`
        ${dashboardNoise}
        <button type="button" id="estado-btn">Estado de cuenta</button>
      `));
      expect(await clickCmrEntry(page)).toBe(true);
      expect(await clicked()).toBe("estado-btn");
    });

    it("falls back to an 'Estado de cuenta' link when there is no button", async () => {
      await page.setContent(fixture(`
        ${dashboardNoise}
        <a href="#" id="estado-link">Estado de cuenta</a>
      `));
      expect(await clickCmrEntry(page)).toBe(true);
      expect(await clicked()).toBe("estado-link");
    });

    it("falls back to the CMR product link (Mastercard/Visa)", async () => {
      await page.setContent(fixture(`
        ${dashboardNoise}
        <a href="#" id="cmr-card">CMR Mastercard ****1234</a>
      `));
      expect(await clickCmrEntry(page)).toBe(true);
      expect(await clicked()).toBe("cmr-card");
    });

    it("falls back to the #cardDetail0 container", async () => {
      await page.setContent(fixture(`
        ${dashboardNoise}
        <div id="cardDetail0">CMR</div>
      `));
      expect(await clickCmrEntry(page)).toBe(true);
      expect(await clicked()).toBe("cardDetail0");
    });

    it("returns false without clicking when no candidate is present", async () => {
      await page.setContent(fixture(dashboardNoise));
      expect(await clickCmrEntry(page)).toBe(false);
      expect(await clicked()).toBeNull();
    });
  });
});
