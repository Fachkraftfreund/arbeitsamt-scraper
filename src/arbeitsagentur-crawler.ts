import { Crawler } from "./crawler.js";
import { groupBy } from "./misc/array.js";
import { findEmailInText } from "./misc/email.js";
import { waitUntil } from "./misc/flow-control.js";
import { findPhoneNumberInText } from "./misc/phone.js";
import { getPostalCodeFromAddress } from "./misc/postal-code.js";
import { exponentialBackoff } from "./misc/request.js";

type Posting = {
    company_name: string;
    city: string;
    arbeitsagentur_id: string;
    start_date: string | null;
    post_date: string | null;
    raw_job_title: string | null;
    postal_code: number | null;
    street: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    company_size: number | null;
    from_search_url?: string;
}

export class ArbeitsagenturCrawler {

    static async construct(parallelCompanyCrawlers: number): Promise<ArbeitsagenturCrawler> {
        const jobCrawler = await Crawler.create({ iDontCareAboutCookies: true });
        const companyCrawlers = await Promise.all(new Array(parallelCompanyCrawlers).fill(0).map(() => Crawler.create({ iDontCareAboutCookies: true })));
        return new ArbeitsagenturCrawler(jobCrawler, companyCrawlers);
    }
    
    private readonly jobCrawler: Crawler;
    private readonly companyCrawlers: Crawler[];

    private constructor(jobCrawler: Crawler, companyCrawlers: Crawler[]) {
        this.jobCrawler = jobCrawler;
        this.companyCrawlers = companyCrawlers;
    }

    async readPostings(url: string, saveCallback: (postings: Posting[]) => Promise<void>) {
        let finalizePromise: PromiseLike<any> | null = null;
        let count = 0;
        let postings: Posting[] = [];
        let lastCleanup = 0;
        
        await this.jobCrawler.goto(url);
        await Promise.all(this.companyCrawlers.map(crawler => crawler.goto('https://www.arbeitsagentur.de/jobsuche/')));
        
        while (true) {
            const i = count;
            
            // Periodic memory cleanup for main crawler
            if (count - lastCleanup >= 50) {
                console.log('Performing periodic memory cleanup...');
                await this.jobCrawler.cleanupMemory();
                await Promise.all(this.companyCrawlers.map(crawler => crawler.cleanupMemory()));
                lastCleanup = count;
            }
            
            const found = await this.readArbeitsagenturPosting(i);
            if (!found) {
                if (finalizePromise) await finalizePromise;
                if (postings.length > 0) {
                    for (const posting of postings)
                        posting.from_search_url = url;
                    finalizePromise = this.addCompanyData(postings).then(postings => saveCallback(postings));
                    postings = [];
                }
                if (!await this.loadNextPage(i))
                    break;
                console.log(`Processed ${count} postings, loading next page...`);
                continue;
            }
            postings.push(found);
            count++;
        }
        if (finalizePromise) await finalizePromise;
        return count;
    }

    async close() {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.jobCrawler.close();
        await Promise.all(this.companyCrawlers.map(crawler => crawler.close()));
    }

    private async readArbeitsagenturPosting(i: number): Promise<Omit<Posting, 'company' | 'country'> | undefined> {
        const companyName = await this.jobCrawler.getTextWithId(`eintrag-${i}-firma`);
        if (companyName == null) return;
        const [jobName, companyLocation, startDate, postDate, linkItem] = await Promise.all([
            this.jobCrawler.getTextWithId(`eintrag-${i}-beruf`),
            this.jobCrawler.getTextWithId(`eintrag-${i}-arbeitsort`),
            this.jobCrawler.getTextWithId(`eintrag-${i}-eintrittsdatum`),
            this.jobCrawler.getTitleAttrWithId(`eintrag-${i}-veroeffentlichungsdatum`),
            this.jobCrawler.getLinkItem(`ergebnisliste-item-${i}`)
        ]);
        const cleanPostDate = postDate ? postDate.replace('Veröffentlichungsdatum: ', '') : null;
        const date = cleanPostDate ? new Date(+cleanPostDate.slice(6, 10), +cleanPostDate.slice(3, 5) - 1, +cleanPostDate.slice(0, 2)) : null;
        const linkUrl = await linkItem.evaluate((el: HTMLAnchorElement) => el.href);
        await this.jobCrawler.deleteOuterElement(linkItem, 2);
        const id = linkUrl.split('/').pop();
        return {
            company_name: companyName.replace('Arbeitgeber:\n', '').trim(),
            city: companyLocation!.replace('Arbeitsort:\n', '').trim(),
            arbeitsagentur_id: id!,
            start_date: startDate?.trim() ?? null,
            post_date: date ? date.toISOString() : null,
            raw_job_title: jobName?.replace("Berufsbezeichnung:\n", '') ?? null,
            postal_code: null,
            street: null,
            email: null,
            phone: null,
            website: null,
            company_size: null,
        };
    }

    private async loadNextPage(i: number) {
        try {
            await exponentialBackoff(async () => {
                await this.jobCrawler.clickButton('ergebnisliste-ladeweitere-button');
                await waitUntil(() => this.jobCrawler.getTextWithId(`eintrag-${i}-firma`));
            }, 5, 5000);
            return true;
        } catch (e) {
            return false;
        }
    }

    private async addCompanyData(postings: Posting[]) {
        const groupedPostings = groupBy(postings, (_, i) => i % this.companyCrawlers.length);
        await Promise.all(Object.entries(groupedPostings).map(async ([crawlerIndex, postings]) => {
            let requestCount = 0;
            for (const posting of postings) {
                const crawler = this.companyCrawlers[+crawlerIndex];
                const url = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${posting.arbeitsagentur_id}`;
                
                try {
                    // Periodic memory cleanup to prevent crashes
                    if (requestCount % 10 === 0 && requestCount > 0) {
                        await crawler.cleanupMemory();
                    }
                    
                    // Try SPA navigation first, fall back to regular navigation
                    await exponentialBackoff(async () => {
                        try {
                            await crawler.goto(url, true, 2); // Reduced retries for SPA navigation
                        } catch (error) {
                            console.warn(`SPA navigation failed for ${url}, falling back to regular navigation`);
                            await crawler.goto(url, false, 3); // More retries for regular navigation
                        }
                    }, 2, 3000); // Reduced base retry attempts since goto now has its own retry logic
                    
                } catch (e) {
                    console.error(`Failed to navigate to ${url} after all retries:`, e);
                    // Continue processing other postings even if one fails
                    continue;
                }
                
                try {
                    const [address, beschreibung, link, companySize] = await Promise.all([
                        crawler.getTextWithId('detail-arbeitsorte-arbeitsort-0'),
                        crawler.getTextWithId('detail-beschreibung-beschreibung'),
                        crawler.getLinkUrl('detail-agdarstellung-link-0', true),
                        crawler.getTextWithId('detail-agdarstellung-betriebsgroesse'),
                    ]);
                    posting.postal_code = getPostalCodeFromAddress(address) ?? getPostalCodeFromAddress(beschreibung);
                    const street = address?.split(/, \d{4,}/)[0]?.trim() ?? null;
                    posting.website = link;
                    posting.company_size = companySize ? Math.round(+(companySize.split(' ')[0])) : null;
                    posting.street = street;
                    if (beschreibung) {
                        posting.email = findEmailInText(beschreibung);
                        posting.phone = findPhoneNumberInText(beschreibung);
                    }
                } catch (error) {
                    console.warn(`Failed to extract data from ${url}:`, error);
                    // Continue with next posting
                }
                
                requestCount++;
            }
        }));
        return postings;
    }
}
