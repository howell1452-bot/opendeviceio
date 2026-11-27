import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { knownMessageIds, waitForMagicLink } from "./mail";

// Claim-your-brand acceptance, end to end against local Supabase:
// an unclaimed brand page shows "Claim this brand"; a rep with a brand-domain
// email claims it; an admin approves in one click; the rep lands on the
// dashboard, publishes one record (manufacturer-verified, replacing the
// draft), invites a colleague, and sets "hide unverified drafts", all without
// touching the database directly.

const REP = "rep@acme-devices.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@odio.test";
const COLLEAGUE = "colleague@acme-devices.test";
const FIXTURE = path.join(__dirname, "fixtures", "acme-a1.odio");

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  const before = await knownMessageIds(email);
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByText("for a magic link")).toBeVisible();
  const link = await waitForMagicLink(email, before);
  await page.goto(link);
  await page.waitForURL((url) => url.pathname === next.split("?")[0]);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe.serial("claim your brand", () => {
  let rep: Page;

  test("an unclaimed brand page offers the claim", async ({ page }) => {
    await page.goto("/brands/acme-devices");
    await expect(page.getByRole("heading", { name: "Acme Devices" })).toBeVisible();
    await expect(page.getByText("Unclaimed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Claim this brand" }).first()).toBeVisible();
    // A single-segment registry link goes to the brand page.
    await page.goto("/registry/acme-devices");
    await expect(page).toHaveURL(/\/brands\/acme-devices$/);
  });

  test("a rep with a brand-domain email claims it", async ({ browser }) => {
    rep = await newPage(browser);
    await signIn(rep, REP, "/brands/acme-devices/claim");
    await expect(rep.getByRole("heading", { name: "Claim Acme Devices on OpenDeviceIO" })).toBeVisible();
    await rep.locator("#role").fill("Product manager");
    await rep.getByRole("button", { name: "Claim this brand" }).click();
    await expect(rep.getByText("Claim sent.")).toBeVisible();
  });

  test("an admin approves it in one click", async ({ browser }) => {
    const admin = await newPage(browser);
    await signIn(admin, ADMIN, "/admin");
    const row = admin.locator("li", { hasText: REP }).filter({ hasText: "Acme Devices" });
    await expect(row.getByText("acme-devices.test")).toBeVisible();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByText("Done: approved as brand-admin")).toBeVisible();
    await admin.context().close();
  });

  test("the rep lands on the dashboard and publishes a manufacturer-verified record", async () => {
    await rep.goto("/brands/acme-devices/manage");
    await expect(rep.getByRole("heading", { name: "Acme Devices dashboard" })).toBeVisible();
    await expect(rep.getByText("You're a brand-admin.")).toBeVisible();

    await rep.goto("/publish");
    await rep.locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(rep.getByText("Ready to publish")).toBeVisible();
    await rep.getByRole("button", { name: "Publish as manufacturer-verified" }).click();
    await expect(rep.getByText("Published as")).toBeVisible();

    await rep.goto("/registry/acme-devices/a1");
    await expect(rep.getByText("Manufacturer-verified").first()).toBeVisible();
    await expect(rep.getByText("Manufacturer", { exact: true }).first()).toBeVisible();
  });

  test("the rep invites a colleague, who joins on sign-in", async ({ browser }) => {
    await rep.goto("/brands/acme-devices/manage?tab=team");
    await rep.getByLabel("Work email").fill(COLLEAGUE);
    await rep.getByRole("button", { name: "Invite" }).click();
    await expect(rep.getByText("Invited. They'll join the team when they sign in.")).toBeVisible();

    const colleague = await newPage(browser);
    await signIn(colleague, COLLEAGUE, "/brands/acme-devices/manage");
    await expect(colleague.getByText("You're a publisher.")).toBeVisible();
    await colleague.context().close();
  });

  test("the rep hides unverified drafts", async ({ browser }) => {
    await rep.goto("/brands/acme-devices/manage?tab=settings");
    const toggle = rep.getByRole("checkbox", { name: /Hide unverified drafts/ });
    await toggle.check();
    await expect(rep.getByText("Saved.")).toBeVisible();
    await rep.reload();
    await expect(rep.getByRole("checkbox", { name: /Hide unverified drafts/ })).toBeChecked();

    // The public no longer sees the remaining draft; the verified record stays.
    const visitor = await newPage(browser);
    const hidden = await visitor.goto("/registry/acme-devices/a2");
    expect(hidden?.status()).toBe(404);
    const shown = await visitor.goto("/registry/acme-devices/a1");
    expect(shown?.status()).toBe(200);
    await visitor.context().close();
  });
});
