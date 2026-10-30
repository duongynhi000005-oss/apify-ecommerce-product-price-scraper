# Universal E-Commerce Product, Variant, Stock & Price Scraper

Multi-platform e-commerce intelligence engine for Shopify, WooCommerce, Magento, BigCommerce & Schema.org stores. Extracts full SKU variants, real-time stock status, compare-at discounts, GTIN/MPN, ratings, and category listings.

## Why Use Universal E-Commerce Product, Variant, Stock & Price Scraper?
- **Production-Grade & Zero Maintenance**: Built specifically for automated workflows in **n8n, Make.com, Zapier, Clay, LangChain, and MCP servers**.
- **Pay-Per-Event (PPE) Transparent Pricing**: Only **$0.003 per enriched result** (`$3.00 per 1,000 results`) with structured JSON, CSV, and Excel export.
- **Fast & Lightweight**: Uses high-concurrency HTTP parsing and structured JSON-LD / API discovery without expensive headless browser overhead.

## Key Features
1. **Deep Structured Extraction**: Automatically normalizes every output record against a strict dataset schema.
2. **Plug-and-Play API & Webhook Integration**: Call directly via `POST https://api.apify.com/v2/acts/huynguyen-data-cloud~ecommerce-product-price-scraper/run-sync-get-dataset-items`.
3. **Built-in Data Hygiene**: Deduplicates records, filters false positives, and computes actionable scoring metrics.

## Quick Start (cURL / API)
```bash
curl -X POST "https://api.apify.com/v2/acts/huynguyen-data-cloud~ecommerce-product-price-scraper/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startUrls": [{"url": "https://webscraper.io/test-sites/e-commerce/allinone"}], "tryShopifyJsonApi": true}'
```
