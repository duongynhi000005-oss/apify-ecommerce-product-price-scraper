import { Actor } from 'apify';
import * as cheerio from 'cheerio';

await Actor.init();

const input = (await Actor.getInput()) || {};
const startUrls = Array.isArray(input.startUrls) && input.startUrls.length > 0
    ? input.startUrls
    : [{ url: 'https://webscraper.io/test-sites/e-commerce/allinone' }];
const tryShopifyJsonApi = input.tryShopifyJsonApi !== false;

async function fetchUrl(url, accept = 'text/html,application/json;q=0.9,*/*;q=0.8') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 14000);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
                'Accept': accept
            }
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

for (const item of startUrls) {
    const rawUrl = typeof item === 'string' ? item : item?.url;
    if (!rawUrl) continue;
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        continue;
    }

    // 1. Check if URL is a Shopify product or store and enrich via .json API if available
    if (tryShopifyJsonApi && parsedUrl.pathname.includes('/products/')) {
        const jsonUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, '')}.json`;
        const rawJson = await fetchUrl(jsonUrl, 'application/json');
        if (rawJson) {
            try {
                const p = JSON.parse(rawJson).product;
                if (p && p.title) {
                    const variants = (p.variants || []).map((v) => ({
                        id: v.id,
                        title: v.title,
                        sku: v.sku || null,
                        price: Number(v.price),
                        compareAtPrice: v.compare_at_price ? Number(v.compare_at_price) : null,
                        available: Boolean(v.available ?? (v.inventory_quantity > 0)),
                        barcode: v.barcode || null
                    }));
                    const prices = variants.map((v) => v.price).filter((n) => !Number.isNaN(n));
                    const minPrice = prices.length ? Math.min(...prices) : null;
                    const maxPrice = prices.length ? Math.max(...prices) : null;
                    await Actor.pushData({
                        url,
                        platform: 'Shopify',
                        title: p.title,
                        brand: p.vendor || null,
                        productType: p.product_type || null,
                        price: minPrice,
                        maxPrice,
                        currency: 'USD',
                        inStock: variants.some((v) => v.available),
                        sku: variants[0]?.sku || String(p.id),
                        variantsCount: variants.length,
                        variants,
                        images: (p.images || []).map((img) => img.src),
                        tags: typeof p.tags === 'string' ? p.tags.split(',').map((t) => t.trim()) : (p.tags || []),
                        publishedAt: p.published_at || null,
                        scrapedAt: new Date().toISOString()
                    });
                    continue;
                }
            } catch {}
        }
    }

    const html = await fetchUrl(url);
    if (!html) {
        await Actor.pushData({ url, status: 'UNREACHABLE', scrapedAt: new Date().toISOString() });
        continue;
    }

    const $ = cheerio.load(html);
    let platform = 'Generic E-Commerce';
    if (/cdn\.shopify\.com|Shopify\.shop/i.test(html)) platform = 'Shopify';
    else if (/woocommerce/i.test(html)) platform = 'WooCommerce';
    else if (/magento|mage\/cookies/i.test(html)) platform = 'Magento';
    else if (/bigcommerce/i.test(html)) platform = 'BigCommerce';

    let schemaProduct = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html() || '{}');
            const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
            for (const n of nodes) {
                if (n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product')))) {
                    schemaProduct = n;
                }
            }
        } catch {}
    });

    const title = schemaProduct?.name
        || $('meta[property="og:title"]').attr('content')
        || $('h1').first().text().trim()
        || $('title').first().text().trim();

    const offersRaw = schemaProduct?.offers
        ? (Array.isArray(schemaProduct.offers) ? schemaProduct.offers : (schemaProduct.offers.offers || [schemaProduct.offers]))
        : [];
    const variants = offersRaw.map((o, idx) => ({
        id: o.sku || idx + 1,
        title: o.name || 'Default',
        sku: o.sku || schemaProduct?.sku || null,
        price: o.price ? Number(o.price) : (o.lowPrice ? Number(o.lowPrice) : null),
        currency: o.priceCurrency || null,
        available: o.availability ? /InStock|PreOrder|OnlineOnly/i.test(String(o.availability)) : true
    }));

    const domPriceText = $('.price, [class*="price"], [itemprop="price"]').first().text().trim();
    const domPriceMatch = domPriceText.match(/(\d+[.,]?\d*)/);
    const fallbackPrice = domPriceMatch ? Number(domPriceMatch[1].replace(',', '')) : null;

    const metaPrice = Number($('meta[property="product:price:amount"]').attr('content') || NaN);
    const primaryPrice = variants[0]?.price ?? (Number.isFinite(metaPrice) ? metaPrice : fallbackPrice);
    const currency = variants[0]?.currency
        || $('meta[property="product:price:currency"]').attr('content')
        || (domPriceText.includes('€') ? 'EUR' : domPriceText.includes('£') ? 'GBP' : 'USD');

    // Also extract catalog cards if URL is a category/listing page
    const catalogCards = [];
    $('.thumbnail, .product-card, [class*="product-item"], .card').slice(0, 25).each((_, card) => {
        const cTitle = $(card).find('.title, h2, h3, h4, [class*="title"]').first().text().trim();
        const cPrice = $(card).find('.price, [class*="price"]').first().text().trim();
        if (cTitle && cPrice) {
            catalogCards.push({ title: cTitle, priceText: cPrice });
        }
    });

    await Actor.pushData({
        url,
        platform,
        title,
        brand: typeof schemaProduct?.brand === 'object' ? schemaProduct.brand.name : (schemaProduct?.brand || null),
        sku: schemaProduct?.sku || schemaProduct?.mpn || variants[0]?.sku || null,
        gtin: schemaProduct?.gtin13 || schemaProduct?.gtin || schemaProduct?.ean || null,
        price: primaryPrice,
        currency,
        inStock: variants.length > 0 ? variants.some((v) => v.available) : true,
        ratingValue: schemaProduct?.aggregateRating?.ratingValue ? Number(schemaProduct.aggregateRating.ratingValue) : null,
        reviewCount: schemaProduct?.aggregateRating?.reviewCount ? Number(schemaProduct.aggregateRating.reviewCount) : null,
        variantsCount: variants.length,
        variants: variants.slice(0, 50),
        catalogProductsOnPage: catalogCards,
        description: (schemaProduct?.description || $('meta[name="description"]').attr('content') || '').slice(0, 500),
        scrapedAt: new Date().toISOString()
    });
}

await Actor.exit();
