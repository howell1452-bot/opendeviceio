import { expect, test } from "@playwright/test";

// Canonical URLs, sitemap.xml, robots.txt and the preview-host noindex header,
// against a production build on localhost. Canonicals always point at
// https://opendeviceio.org, whatever host serves the page.

const SITE = "https://opendeviceio.org";

test.describe("canonical URLs, sitemap and robots", () => {
  test("a record page's canonical is its current-id URL, in the served HTML", async ({ page, request }) => {
    const res = await request.get("/registry/example-audio/x1");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<link rel="canonical" href="${SITE}/registry/example-audio/x1"/>`);
    await page.goto("/registry/example-audio/x1");
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${SITE}/registry/example-audio/x1`);
  });

  test("an old id ends on the new id, whose canonical is the new id", async ({ page }) => {
    await page.goto("/registry/example-audio-old/x1?tab=io");
    await expect(page).toHaveURL(/\/registry\/example-audio\/x1\?tab=io$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/registry/example-audio/x1`);
  });

  test("brand pages and the filtered listing", async ({ page }) => {
    await page.goto("/brands/example-audio");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/brands/example-audio`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${SITE}/brands/example-audio`);
    await page.goto("/registry?brand=example-audio&q=x1");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/registry`);
  });

  test("pages behind sign-in are noindex", async ({ page }) => {
    await page.goto("/submit");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("a non-production host is sent X-Robots-Tag: noindex", async ({ request }) => {
    const res = await request.get("/about");
    expect(res.headers()["x-robots-tag"]).toBe("noindex");
  });

  test("/sitemap.xml lists brands and current ids, never an old id", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/xml/);
    const xml = await res.text();
    expect(xml).toContain(`<loc>${SITE}/brands/example-audio</loc>`);
    expect(xml).toContain(`<loc>${SITE}/registry/example-audio/x1</loc>`);
    expect(xml).toContain(`<loc>${SITE}/manufacturers</loc>`);
    expect(xml).not.toContain("example-audio-old");
    expect(xml).not.toMatch(/\/(admin|submit|publish|author|api\/)/);
  });

  test("/robots.txt is plain text with the sitemap line", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^text\/plain/);
    const txt = await res.text();
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(txt).toContain("Disallow: /admin");
    expect(txt).toContain("Disallow: /brands/*/manage");
  });
});
