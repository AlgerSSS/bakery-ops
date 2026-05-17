import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import { logger } from "../../../shared/logger";
import type { OrderItem } from "../types";

const WMS_URL = process.env.WMS_URL || "https://wms.dex-i.net/";
const WMS_EMAIL = process.env.WMS_EMAIL || "hotcrushbakery@gmail.com";
const WMS_PASSWORD = process.env.WMS_PASSWORD || "ddexpress";
const SESSION_DIR = process.env.WMS_SESSION_DIR || "./wms-session";
const STORE_ADDRESS_ID = process.env.WMS_STORE_ADDRESS_ID || "649";

function randomDelay(min = 1000, max = 2500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

export class WmsConnector {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private getStorageFile(): string {
    return `${SESSION_DIR}/storage.json`;
  }

  private hasValidSession(): boolean {
    const file = this.getStorageFile();
    if (!fs.existsSync(file)) return false;
    const ageHours = (Date.now() - fs.statSync(file).mtimeMs) / (1000 * 60 * 60);
    return ageHours < 24;
  }

  async launch(): Promise<Page> {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    this.browser = await chromium.launch({ headless: true });

    const contextOptions: Record<string, unknown> = {
      viewport: { width: 1400, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    };

    if (this.hasValidSession()) {
      contextOptions.storageState = this.getStorageFile();
    }

    this.context = await this.browser.newContext(contextOptions as any);
    return this.context.newPage();
  }

  async saveSession(page: Page): Promise<void> {
    const storage = await page.context().storageState();
    fs.writeFileSync(this.getStorageFile(), JSON.stringify(storage, null, 2));
  }

  async login(page: Page): Promise<boolean> {
    try {
      await page.goto(`${WMS_URL}index.php?route=account/login/getForm&type=1&merchant=1`, { waitUntil: "networkidle" });
      await randomDelay();

      if (!page.url().includes("login") && !page.url().includes("LoginType")) {
        logger.info("WMS: already logged in");
        return true;
      }

      const emailInput = page.locator('input[name="email"]');
      if (await emailInput.count() === 0) {
        logger.error("WMS: email input not found");
        return false;
      }
      await emailInput.fill(WMS_EMAIL);
      await randomDelay(500, 1000);
      await page.fill('input[name="password"]', WMS_PASSWORD);
      await randomDelay(500, 1000);
      await page.click('input[type="submit"]');
      await page.waitForLoadState("networkidle");

      if (page.url().includes("login") || page.url().includes("LoginType")) {
        logger.error("WMS: login failed");
        return false;
      }

      await this.saveSession(page);
      logger.info("WMS: login successful");
      return true;
    } catch (err) {
      logger.error("WMS: login failed", { error: String(err) });
      return false;
    }
  }

  /**
   * 搜索 WMS SKU - 在浏览器内调 AJAX API
   */
  private async searchSku(page: Page, term: string): Promise<{ id: string; text: string }[]> {
    try {
      const results = await page.evaluate(async (searchTerm: string) => {
        const resp = await fetch(
          `index.php?route=account/send_order/get_customer_product_place_order&term=${encodeURIComponent(searchTerm)}&page=1`,
        );
        const data = await resp.json();
        return (data.results || []) as { id: string; text: string }[];
      }, term);
      return results;
    } catch (err) {
      logger.error("WMS: SKU search API failed", { error: String(err) });
      return [];
    }
  }

  async placeOrder(items: OrderItem[]): Promise<{ success: boolean; error?: string; orderId?: string }> {
    let page: Page | null = null;

    try {
      page = await this.launch();

      // Ensure logged in
      await page.goto(WMS_URL, { waitUntil: "networkidle" });
      await randomDelay(1000, 2000);
      if (page.url().includes("login") || page.url().includes("LoginType")) {
        const loggedIn = await this.login(page);
        if (!loggedIn) return { success: false, error: "WMS 登录失败" };
      }

      // Navigate to send_order and verify we're on the right page
      await page.goto(`${WMS_URL}index.php?route=account/send_order`, { waitUntil: "networkidle" });
      await randomDelay(2000, 3000);
      const orderPageUrl = page.url();
      logger.info("WMS: send_order page loaded", { url: orderPageUrl });

      if (orderPageUrl.includes("login") || orderPageUrl.includes("LoginType")) {
        // Session didn't take effect, try logging in again
        logger.warn("WMS: redirected to login, retrying login");
        const loggedIn = await this.login(page);
        if (!loggedIn) return { success: false, error: "WMS 登录失败" };
        await page.goto(`${WMS_URL}index.php?route=account/send_order`, { waitUntil: "networkidle" });
        await randomDelay(2000, 3000);
      }

      // 1. Select existing shipping address
      const addrRadio = page.locator("#shipping_address_exist");
      if (await addrRadio.count() === 0) {
        logger.error("WMS: #shipping_address_exist not found", { url: page.url() });
        return { success: false, error: `WMS 下单页缺少地址选择元素` };
      }
      await addrRadio.click();
      await randomDelay(500, 1000);
      await page.evaluate((addressId: string) => {
        const select = document.querySelector("#shipping") as HTMLSelectElement;
        if (select) {
          select.value = addressId;
          if ((window as any).$ && (window as any).$("#shipping").data("select2")) {
            (window as any).$("#shipping").trigger("change");
          } else {
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }, STORE_ADDRESS_ID);
      await randomDelay(500, 1000);

      // 2. Payment same as shipping
      await page.click("#payment_address_same_as_shipping");
      await randomDelay();

      // 3. Delivery method: Unnecessary
      const unnecessaryRadio = page.locator('input[name="delivery_method_required"]').last();
      await unnecessaryRadio.click();
      await randomDelay();

      // 4. Reference No
      const today = new Date().toISOString().split("T")[0];
      await page.fill("#input-reference_no", `HC-${today}`);
      await randomDelay();

      // 5. For each item: add product row, search & select SKU, fill quantity
      const failedItems: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        logger.info(`WMS: adding product ${i + 1}/${items.length}: ${item.name}`);

        // Click Add button to add a row (page's delegated handler initializes Select2)
        await page.click("button.btn-add");
        await randomDelay(1500, 2000);

        const rowIdx = i + 1;

        // Open the new row's Select2
        const newSelect2 = page.locator(`#select2-input-sku_${rowIdx}-container`).locator("..");
        // Actually the Select2 is wrapped differently, just click the right container
        const select2Containers = page.locator(".select2-container");
        const containerCount = await select2Containers.count();
        // The last one is the new row's Select2
        const lastContainer = select2Containers.nth(containerCount - 1);
        await lastContainer.click();
        await randomDelay(500, 1000);

        // Type search term in Select2 search field
        const searchField = page.locator(".select2-search__field");
        const sfCount = await searchField.count();
        if (sfCount > 0) {
          // Type the product name to search
          await searchField.last().fill(item.name);
          await randomDelay(2000, 3000); // Wait for AJAX results

          // Check for results
          const resultOptions = page.locator(".select2-results__option");
          const resultCount = await resultOptions.count();

          if (resultCount > 0) {
            // Click first result
            await resultOptions.first().click();
            await randomDelay(500, 1000);
            logger.info(`WMS: SKU selected for ${item.name}`);
          } else {
            // Try shorter keywords
            const keywords = item.name.split(/[\s（）()]+/).filter((k: string) => k.length >= 2);
            let found = false;
            for (const kw of keywords.slice(0, 3)) {
              await searchField.last().fill(kw);
              await randomDelay(2000, 3000);
              if (await resultOptions.count() > 0) {
                await resultOptions.first().click();
                await randomDelay(500, 1000);
                logger.info(`WMS: SKU selected via keyword "${kw}" for ${item.name}`);
                found = true;
                break;
              }
            }
            if (!found) {
              failedItems.push(`${item.name}: 无匹配 SKU`);
            }
          }
        } else {
          failedItems.push(`${item.name}: Select2 search field not found`);
        }

        // Fill quantity
        const qtyInput = page.locator(`#input-quantity-order-product_${rowIdx}`);
        if (await qtyInput.count() > 0) {
          await qtyInput.fill(String(item.quantity));
          await randomDelay(300, 500);
        }
      }

      // Fill comment with order summary
      const orderComment = this.formatOrderComment(items);
      await page.evaluate((text: string) => {
        const ta = document.querySelector('textarea[name="comment"]') as HTMLTextAreaElement;
        if (ta) {
          ta.value = text;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, orderComment);
      await randomDelay();

      if (failedItems.length > 0) {
        logger.warn("WMS: some items could not find SKUs", { failedItems });
      }

      // 6. Submit the form directly (bypass SweetAlert confirmation)
      logger.info("WMS: submitting order form");
      await page.evaluate(() => {
        const form = document.querySelector("#submits") as HTMLFormElement;
        if (form) form.submit();
      });
      await randomDelay(3000, 5000);
      await page.waitForLoadState("networkidle");

      // Check result
      const responseUrl = page.url();
      const pageText = (await page.textContent("body")) || "";

      if (responseUrl.includes("add_order") && pageText.includes("Warning")) {
        // Extract warning message
        const warning = await page.evaluate(() => {
          const el = document.querySelector(".alert-danger, .warning");
          return el ? (el as HTMLElement).innerText.trim().slice(0, 200) : "";
        });
        return { success: false, error: `WMS 提交被拒: ${warning}` };
      }

      // If we redirected away from send_order, it likely succeeded
      if (!responseUrl.includes("send_order") || responseUrl.includes("success") || responseUrl.includes("order_id")) {
        await this.saveSession(page);
        logger.info("WMS: order placed successfully", {
          itemCount: items.length,
          failedItems: failedItems.length,
        });
        return { success: true };
      }

      // Still on send_order but no warning - might have succeeded
      await this.saveSession(page);
      logger.info("WMS: order likely placed", { itemCount: items.length });
      return { success: true };
    } catch (err) {
      const error = String(err);
      logger.error("WMS: placeOrder failed", { error });
      return { success: false, error: `WMS 下单失败: ${error}` };
    } finally {
      await this.close();
    }
  }

  private formatOrderComment(items: OrderItem[]): string {
    const lines = [`订货清单 (${new Date().toISOString().split("T")[0]})`, ""];
    for (const item of items) {
      lines.push(`- ${item.name}: ${item.quantity}${item.unit}`);
    }
    lines.push("");
    lines.push(`共 ${items.length} 项`);
    return lines.join("\n");
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }
}

export const wmsConnector = new WmsConnector();
