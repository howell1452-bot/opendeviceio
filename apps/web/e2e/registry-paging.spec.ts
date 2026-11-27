import { expect, test, type Page } from "@playwright/test";

// /registry paging against a seeded brand with 130 records (100 per page).

const SITE = "https://opendeviceio.org";
const BRAND = "/registry?manufacturer=Paging+Labs";

async function recordIds(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href^="/registry/paging-labs/"]').evaluateAll((as) =>
    as.map((a) => a.getAttribute("href") ?? "")
  );
  return [...new Set(hrefs)];
}

test.describe("registry paging", () => {
  test("page 1 shows 100 of 130 and links to page 2 with the filter kept", async ({ page }) => {
    await page.goto(BRAND);
    await expect(page.getByTestId("pager-showing")).toHaveText("Showing 1–100 of 130");
    await expect(page.getByTestId("registry-total")).toHaveText("130 entries · page 1 of 2");
    expect(await recordIds(page)).toHaveLength(100);
    const next = page.getByRole("link", { name: "Next →" });
    const href = new URL((await next.getAttribute("href")) ?? "", SITE);
    expect(href.searchParams.get("manufacturer")).toBe("Paging Labs");
    expect(href.searchParams.get("page")).toBe("2");
    await expect(page.getByRole("link", { name: "Page 2" })).toHaveAttribute("href", /manufacturer=Paging\+Labs/);
  });

  test("page 2 lists the other 30 records, with its own canonical", async ({ page }) => {
    await page.goto(BRAND);
    const first = await recordIds(page);
    await page.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL(/manufacturer=Paging\+Labs&page=2$/);
    await expect(page.getByTestId("pager-showing")).toHaveText("Showing 101–130 of 130");
    const second = await recordIds(page);
    expect(second).toHaveLength(30);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
    expect(new Set([...first, ...second]).size).toBe(130);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/registry?page=2`);
    // Previous goes back to page 1, filter kept, no ?page.
    await expect(page.getByRole("link", { name: "← Previous" })).toHaveAttribute("href", "/registry?manufacturer=Paging+Labs");
  });

  test("past the last page is a 404; a bad page number is page 1", async ({ page, request }) => {
    expect((await request.get(`${BRAND}&page=3`)).status()).toBe(404);
    await page.goto(`${BRAND}&page=abc`);
    await expect(page.getByTestId("pager-showing")).toHaveText("Showing 1–100 of 130");
  });

  test("changing a filter starts again at page 1", async ({ page }) => {
    await page.goto(`${BRAND}&page=2`);
    await page.getByLabel("Kind").selectOption("device");
    await expect(page).toHaveURL(/kind=device/);
    expect(new URL(page.url()).searchParams.get("page")).toBeNull();
    expect(new URL(page.url()).searchParams.get("manufacturer")).toBe("Paging Labs");
  });
});
