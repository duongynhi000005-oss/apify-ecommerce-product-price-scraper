import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrls = [],
    extractReviews = true,
    extractVariants = true,
    proxyConfiguration,
    maxConcurrency = 10,
} = input;

if (!startUrls || startUrls.length === 0) {
    log.warning('No startUrls provided. Exiting.');
    await Actor.exit();
}

const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

let totalProductsCharged = 0;

const CURRENCY_MAP = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '¥': 'JPY',
    '₹': 'INR',
    'C$': 'CAD',
    'A$': 'AUD',
    'CHF': 'CHF',
    '₫': 'VND',
};

function normalizeAvailability(raw) {
    if (!raw) return 'Unknown';
    const lower = String(raw).toLowerCase();
    if (lower.includes('instock') || lower.includes('in stock') || lower.includes('available')) {
        return 'InStock';
    }
    if (lower.includes('outofstock') || lower.includes('out of stock') || lower.includes('sold out')) {
        return 'OutOfStock';
    }
    if (lower.includes('preorder') || lower.includes('pre-order') || lower.includes('backorder')) {
        return 'PreOrder';
    }
    return 'InStock';
}

function parseNumericPrice(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr) return null;
    const cleaned = String(priceStr).replace(/[^0-9.,]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
}

const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConfig,
    maxConcurrency,
    requestHandlerTimeoutSecs: 30,
    async requestHandler({ $, request }) {
        const { url } = request;
        log.info(`Processing product: ${url}`);

        const product = {
            url,
            title: null,
            brand: null,
            currentPrice: null,
            regularPrice: null,
            currency: 'USD',
            availability: 'Unknown',
            sku: null,
            description: null,
            images: [],
            aggregateRating: null,
            reviewCount: null,
            variants: [],
            platformDetected: 'Standard / Schema.org',
            scrapedAt: new Date().toISOString(),
        };

        const html = $.html();

        let foundSchema = false;
        $('script[type="application/ld+json"]').each((_, el) => {
            if (foundSchema) return;
            try {
                const raw = $(el).html()?.trim();
                if (!raw) return;
                const parsed = JSON.parse(raw);
                const items = Array.isArray(parsed) ? parsed : [parsed];

                for (const item of items) {
                    if (item['@type'] === 'Product' || (Array.isArray(item['@graph']) && item['@graph'].some((g) => g['@type'] === 'Product'))) {
                        const target = item['@type'] === 'Product' ? item : item['@graph'].find((g) => g['@type'] === 'Product');

                        product.title = target.name || product.title;
                        product.description = target.description || product.description;
                        product.sku = target.sku || target.mpn || product.sku;

                        if (target.brand) {
                            product.brand = typeof target.brand === 'string' ? target.brand : target.brand.name;
                        }

                        if (target.image) {
                            const imgs = Array.isArray(target.image) ? target.image : [target.image];
                            product.images = imgs.map((img) => (typeof img === 'string' ? img : img.url)).filter(Boolean);
                        }

                        const offers = target.offers;
                        if (offers) {
                            const offerList = Array.isArray(offers) ? offers : [offers];
                            const mainOffer = offerList[0];
                            if (mainOffer) {
                                product.currentPrice = parseNumericPrice(mainOffer.price || mainOffer.lowPrice);
                                product.regularPrice = parseNumericPrice(mainOffer.highPrice) || product.currentPrice;
                                product.currency = mainOffer.priceCurrency || product.currency;
                                product.availability = normalizeAvailability(mainOffer.availability);
                            }
                        }

                        if (extractReviews && target.aggregateRating) {
                            product.aggregateRating = parseFloat(target.aggregateRating.ratingValue) || null;
                            product.reviewCount = parseInt(target.aggregateRating.reviewCount || target.aggregateRating.ratingCount, 10) || null;
                        }

                        foundSchema = true;
                        break;
                    }
                }
            } catch {
                // Ignore malformed JSON-LD
            }
        });

        const isShopify = html.includes('cdn.shopify.com') || html.includes('Shopify.theme');
        if (isShopify) {
            product.platformDetected = 'Shopify';
            const shopifyMetaMatch = html.match(/var meta = ({[\s\S]*?});/);
            if (shopifyMetaMatch) {
                try {
                    const shopifyMeta = JSON.parse(shopifyMetaMatch[1]);
                    if (shopifyMeta.product) {
                        product.title = product.title || shopifyMeta.product.title;
                        product.brand = product.brand || shopifyMeta.product.vendor;
                        if (shopifyMeta.product.variants && extractVariants) {
                            product.variants = shopifyMeta.product.variants.map((v) => ({
                                id: v.id,
                                name: v.name,
                                price: v.price / 100,
                                sku: v.sku,
                                available: v.available,
                            }));
                            if (product.variants.length > 0 && !product.currentPrice) {
                                product.currentPrice = product.variants[0].price;
                                product.availability = product.variants[0].available ? 'InStock' : 'OutOfStock';
                            }
                        }
                    }
                } catch {
                    // Fall through
                }
            }
        }

        if (!product.title) {
            product.title = $('meta[property="og:title"]').attr('content') || $('title').first().text().trim();
        }
        if (!product.description) {
            product.description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content');
        }
        if (product.images.length === 0) {
            const ogImg = $('meta[property="og:image"]').attr('content');
            if (ogImg) product.images.push(ogImg);
        }

        if (!product.currentPrice) {
            const ogPrice = $('meta[property="product:price:amount"]').attr('content') ||
                            $('meta[property="og:price:amount"]').attr('content');
            if (ogPrice) {
                product.currentPrice = parseNumericPrice(ogPrice);
                product.currency = $('meta[property="product:price:currency"]').attr('content') ||
                                   $('meta[property="og:price:currency"]').attr('content') ||
                                   product.currency;
            }
        }

        if (!product.currentPrice) {
            const domPriceText = $('.woocommerce-Price-amount, .price .amount, .product-price, [data-price]').first().text().trim();
            if (domPriceText) {
                product.currentPrice = parseNumericPrice(domPriceText);
                for (const [sym, code] of Object.entries(CURRENCY_MAP)) {
                    if (domPriceText.includes(sym)) {
                        product.currency = code;
                        break;
                    }
                }
            }
        }

        if (product.availability === 'Unknown') {
            const stockText = $('.stock, .availability, [itemprop="availability"], .in-stock, .out-of-stock').text();
            product.availability = normalizeAvailability(stockText);
        }

        const isValidProduct = Boolean(product.title && (product.currentPrice !== null || product.images.length > 0));

        if (isValidProduct) {
            try {
                await Actor.charge({ eventName: 'product-extracted', count: 1 });
                totalProductsCharged += 1;
            } catch (chargeErr) {
                log.warning(`Actor.charge error: ${chargeErr.message}`);
            }

            await Actor.pushData(product);
            log.info(`Successfully enriched & charged: "${product.title}" (${product.currency} ${product.currentPrice}) - [${product.availability}]`);
        } else {
            log.warning(`Could not identify valid product data on ${url}. Skipping charge.`);
        }
    },
    async failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    },
});

log.info(`Starting e-commerce scrape for ${startUrls.length} product URLs...`);
await crawler.run(startUrls);

log.info(`E-commerce scrape complete. Total charged products: ${totalProductsCharged}`);
await Actor.exit();
