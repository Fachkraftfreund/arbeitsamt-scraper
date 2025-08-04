import type { PlaywrightLaunchContext } from 'crawlee';
import path from 'path';
import type { Browser, ElementHandle, Page } from 'playwright';
import playwright from 'playwright';

const TIMEOUT = 10000;

export class Crawler {

    public static async create(options: { iDontCareAboutCookies?: boolean } = {}) {
        const { iDontCareAboutCookies = false } = options;
        const launchContext: PlaywrightLaunchContext = {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--window-size=1080,1440',
                ]
            }
        };
        if (iDontCareAboutCookies) {
            const extPath = path.join(process.cwd(), 'shared', 'puppeteer', 'extensions', 'i-dont-care-about-cookies', '1.1.4_0');
            launchContext.launchOptions!.args!.push(`--disable-extensions-except=${extPath}`);
            launchContext.launchOptions!.args!.push(`--load-extension=${extPath}`);
        }
        const browser = await playwright.chromium.launch(launchContext.launchOptions);
        const page = await browser.newPage();
        // Disable animations to avoid actionability hangs on Angular pages
        await page.addInitScript(() => {
            const style = document.createElement('style');
            style.textContent = `* { transition-duration: 0s !important; animation-duration: 0s !important; }`;
            document.head.appendChild(style);
        });
        return new Crawler(browser, page);
    }

    private readonly browser: Browser;
    private readonly page: Page;

    constructor(browser: Browser, page: Page) {
        this.browser = browser;
        this.page = page;
    }

    public async goto(url: string, useSpaNavigation: boolean = false) {
        if (!url.startsWith('http')) url = 'http://' + url;
        
        if (useSpaNavigation) {
            await this.page.evaluate((url) => {
                if (window.location.pathname === new URL(url).pathname)
                    return;
                
                if ((window as any).ng) {
                    const router = (window as any).ng.probe?.((window as any).getAllAngularRootElements?.()?.[0])?.injector?.get?.('Router');
                    if (router) {
                        const relativePath = new URL(url).pathname;
                        router.navigateByUrl(relativePath);
                        return;
                    }
                }
                const link = document.querySelector(`a[href="${url}"], a[href="${new URL(url).pathname}"]`) as HTMLAnchorElement;
                if (link) {
                    link.click();
                    return;
                }
                window.location.href = url;
            }, url);
            await this.page.waitForFunction((targetUrl) => {
                const currentUrl = window.location.href;
                const targetPath = new URL(targetUrl).pathname;
                const currentPath = new URL(currentUrl).pathname;
                return currentPath === targetPath;
            }, url, { timeout: TIMEOUT });
            await this.page.waitForLoadState('networkidle', { timeout: TIMEOUT });
        } else {
            const response = await this.page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT });
            if (response?.status() !== 200) throw new Error(`Failed to load ${url}: ${response?.status()}`);
        }
    }

    public async setInput(id: string, value: string) {
        const input = await this.page.$(`input[id="${id}"]`);
        if (!input) throw new Error(`Input with selector ${id} not found`);
        await input.fill(value);
        await input.press('Enter');
    }

    public async getLinkUrl(id: string, canBeMissing: boolean = false) {
        const link = await this.page.$(`a[id="${id}"]`);
        if (!link && !canBeMissing) throw new Error(`Link with selector ${id} not found`);
        return link ? link.evaluate((el: HTMLAnchorElement) => el.href) : null;
    }

    public async getImageUrl(id: string) {
        const image = await this.page.$(`img[id="${id}"]`);
        if (!image) return null;
        return image.evaluate((el: HTMLImageElement) => el.src);
    }

    public async getLinkItem(id: string) {
        const link = await this.page.$(`a[id="${id}"]`);
        if (!link) throw new Error(`Link with selector ${id} not found`);
        return link;
    }

    public async clickButton(id: string) {
        // focus button
        const button = await this.page.$(`button[id="${id}"]`);
        if (!button) throw new Error(`Button with selector ${id} not found`);
        await button.focus();
        // press enter
        await button.press('Enter');
    }

    public async getTitleAttrWithId(id: string) {
        const element = await this.page.$(`#${id}`);
        return element?.evaluate((el: HTMLElement) => el.title);
    }

    public async hasElementWithId(id: string) {
        const element = await this.page.$(`#${id}`);
        return element !== null;
    }

    public async getTextWithId(id: string) {
        const element = await this.page.$(`#${id}`);
        return element?.evaluate((el: HTMLElement) => el.innerText);
    }

    public async getTextWithClass(className: string) {
        const element = await this.page.$(`.${className}`);
        return element?.evaluate((el: HTMLElement) => el.innerText);
    }

    public async findEmail() {
        const emailElement = await this.page.$('a[href^="mailto:"]');
        if (!emailElement) {
            // fallback to text with "@" character
            const text = await this.page.evaluate(() => document.body.innerText);
            const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (!emailMatch) return null;
            return emailMatch[1];
        }
        return emailElement.evaluate((el: HTMLAnchorElement) => el.href.replace('mailto:', ''));
    }
    
    public async wait(ms: number) {
        await this.page.waitForTimeout(ms);
    }

    public async close() {
        await this.browser.close();
    }

    public async deleteOuterElement(item: ElementHandle, parent: number = 1) {
        // Start from the provided element handle
        let elementHandle: ElementHandle = item;
        // Traverse up the DOM 'parent' levels
        for (let i = 0; i < parent; i++) {
            // Get the parent element via evaluateHandle and convert to ElementHandle
            const jsHandle = await elementHandle.evaluateHandle((el: HTMLElement) => el.parentElement);
            const parentEl = jsHandle.asElement();
            if (!parentEl) {
                throw new Error(`Parent element not found at depth ${i + 1}`);
            }
            elementHandle = parentEl;
        }
        await elementHandle.evaluate((el: HTMLElement) => el.remove());
    }
}
