import type { PlaywrightLaunchContext } from 'crawlee';
import path from 'path';
import type { Browser, ElementHandle, Page } from 'playwright';
import playwright from 'playwright';

const TIMEOUT = 30000;

export class Crawler {

    public static async create(options: { iDontCareAboutCookies?: boolean } = {}) {
        const { iDontCareAboutCookies = false } = options;
        const launchContext: PlaywrightLaunchContext = {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Use /tmp instead of /dev/shm for shared memory
                    '--disable-gpu', // Disable GPU acceleration to prevent crashes
                    '--disable-extensions', // Disable extensions except the ones we load
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI,VizDisplayCompositor',
                    '--disable-web-security', // Can help with some navigation issues
                    '--disable-features=VizDisplayCompositor',
                    '--max-old-space-size=4096', // Increase memory limit
                    '--memory-pressure-off', // Disable memory pressure detection
                    '--window-size=1080,1440',
                ]
            }
        };
        if (iDontCareAboutCookies) {
            const extPath = path.join(process.cwd(), 'src', 'extensions', 'i-dont-care-about-cookies', '1.1.4_0');
            launchContext.launchOptions!.args!.push(`--disable-extensions-except=${extPath}`);
            launchContext.launchOptions!.args!.push(`--load-extension=${extPath}`);
        }
        const browser = await playwright.chromium.launch(launchContext.launchOptions);
        const page = await browser.newPage();
        
        // Set viewport and user agent for consistency
        await page.setViewportSize({ width: 1080, height: 1440 });
        
        // Disable animations to avoid actionability hangs on Angular pages
        await page.addInitScript(() => {
            const style = document.createElement('style');
            style.textContent = `* { transition-duration: 0s !important; animation-duration: 0s !important; }`;
            document.head.appendChild(style);
        });
        
        // Handle page crashes gracefully
        page.on('crash', () => {
            console.warn('Page crashed, will be recreated on next navigation attempt');
        });
        
        return new Crawler(browser, page);
    }

    private readonly browser: Browser;
    private readonly page: Page;

    constructor(browser: Browser, page: Page) {
        this.browser = browser;
        this.page = page;
    }

    private async recreatePage(): Promise<void> {
        try {
            if (!this.page.isClosed()) {
                await this.page.close();
            }
        } catch (error) {
            // Ignore errors when closing crashed page
        }
        
        // Create new page with same initialization
        const newPage = await this.browser.newPage();
        
        // Set viewport and user agent for consistency
        await newPage.setViewportSize({ width: 1080, height: 1440 });
        
        await newPage.addInitScript(() => {
            const style = document.createElement('style');
            style.textContent = `* { transition-duration: 0s !important; animation-duration: 0s !important; }`;
            document.head.appendChild(style);
        });
        
        // Handle page crashes gracefully
        newPage.on('crash', () => {
            console.warn('Page crashed, will be recreated on next navigation attempt');
        });
        
        // Replace the page reference
        (this as any).page = newPage;
    }

    private async isPageHealthy(): Promise<boolean> {
        try {
            if (this.page.isClosed()) {
                return false;
            }
            // Try a simple evaluation to test if page is responsive
            await this.page.evaluate(() => document.readyState);
            return true;
        } catch {
            return false;
        }
    }

    public async goto(url: string, useSpaNavigation: boolean = false, maxRetries: number = 3) {
        if (!url.startsWith('http')) url = 'http://' + url;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Check page health before attempting navigation
                if (!(await this.isPageHealthy())) {
                    throw new Error('Page is unhealthy, needs recreation');
                }

                // Add page crash listener
                const crashPromise = new Promise<never>((_, reject) => {
                    this.page.once('crash', () => {
                        reject(new Error('Page crashed during navigation'));
                    });
                });

                if (useSpaNavigation) {
                    const navigationPromise = (async () => {
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
                    })();

                    await Promise.race([navigationPromise, crashPromise]);
                } else {
                    const gotoPromise = (async () => {
                        const response = await this.page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT });
                        if (response?.status() !== 200) throw new Error(`Failed to load ${url}: ${response?.status()}`);
                    })();

                    await Promise.race([gotoPromise, crashPromise]);
                }

                // If we get here, navigation was successful
                return;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Navigation attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}: ${errorMessage}`);

                if (attempt === maxRetries) {
                    throw new Error(`Failed to navigate to ${url} after ${maxRetries + 1} attempts: ${errorMessage}`);
                }

                // If page crashed, is closed, or unhealthy, try to recreate it
                if (errorMessage.includes('crashed') || 
                    errorMessage.includes('closed') || 
                    errorMessage.includes('unhealthy') ||
                    this.page.isClosed()) {
                    try {
                        await this.recreatePage();
                        console.log(`Recreated page after crash on attempt ${attempt + 1}`);
                    } catch (recreateError) {
                        console.error(`Failed to recreate page: ${recreateError}`);
                        if (attempt === maxRetries) {
                            throw error;
                        }
                    }
                }

                // Wait before retrying with exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
    }

    public async cleanupMemory() {
        try {
            if (await this.isPageHealthy()) {
                // Clear browser cache and run garbage collection
                await this.page.evaluate(() => {
                    // Clear any timers or intervals
                    const highestId = window.setTimeout(() => {}, 0) as any as number;
                    for (let i = 0; i <= highestId; i++) {
                        clearTimeout(i);
                        clearInterval(i);
                    }
                    
                    // Force garbage collection if available
                    if ((window as any).gc) {
                        (window as any).gc();
                    }
                });
                
                // Clear browser cache
                const context = this.page.context();
                await context.clearCookies();
            }
        } catch (error) {
            console.warn('Failed to cleanup memory:', error);
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
