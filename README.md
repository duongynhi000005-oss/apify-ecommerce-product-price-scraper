# Universal E-Commerce Product, Price & Stock Scraper

High-speed, zero-browser-overhead Apify Actor that extracts normalized product intelligence (**Title, Brand, SKU, Price, Currency, In-Stock Availability, Aggregate Rating, Review Count, Images, and Variants**) from **Shopify, WooCommerce, Magento, BigCommerce, and custom e-commerce storefronts**.

## Features
- **3-Layer Extraction Engine**:
  1. `application/ld+json` (`@type: Product` & `@type: AggregateOffer` / `Offer`)
  2. Shopify `.json` product endpoint & `meta[property^="og:"]` / `product:price:amount` OpenGraph fallback
  3. Schema.org Microdata (`itemprop="price"`, `itemprop="availability"`)
- **Pay-Per-Event Pricing**: `$0.003` per normalized product (`product-scraped`), with zero charge on failed or non-product URLs.
- **AI Agent & MCP Ready**: Outputs deterministic JSON schemas ready for price-monitoring pipelines, competitor intelligence agents, and RAG product catalogs.
