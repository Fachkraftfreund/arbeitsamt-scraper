
import { Actor } from 'apify';
import { ArbeitsagenturCrawler } from './arbeitsagentur-crawler.js';

interface Input {
    parallelCompanyCrawlers?: number;
    maxRequestsPerCrawl?: number;
    searchUrl?: string;
}

// Initialize the Apify SDK
await Actor.init();

// Structure of input is defined in input_schema.json
const {
    parallelCompanyCrawlers = 2,
    searchUrl = 'https://www.arbeitsagentur.de/jobsuche/suche?angebotsart=1&wo=Deutschland&veroeffentlichtseit=7&arbeitszeit=vz;tz;snw;ho&zeitarbeit=true&branche=9;7;11;13;15'
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const arbeitsagenturCrawler = await ArbeitsagenturCrawler.construct(parallelCompanyCrawlers);
await arbeitsagenturCrawler.readPostings(searchUrl, postings => Actor.pushData(postings));

// Exit successfully
await Actor.exit();
