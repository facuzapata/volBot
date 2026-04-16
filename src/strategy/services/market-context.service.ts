import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { createClient, RedisClientType } from 'redis';

interface NewsContextItem {
    source: string;
    publishedAt: string;
    title: string;
    summary?: string;
    sentiment?: 'bullish' | 'bearish' | 'neutral';
    relevance?: number;
}

interface MarketContextPayload {
    marketRegime?: string;
    fundingRate?: number;
    openInterest?: number;
    openInterestChangePct?: number;
    liquidationImbalance?: number;
    btcDominanceChangePct?: number;
    fearGreedValue?: number;
    fearGreedClassification?: string;
    priceChange1mPct?: number;
    priceChange5mPct?: number;
    priceChange15mPct?: number;
    priceChange24hPct?: number;
    quoteVolume24h?: number;
    notes?: string[];
}

interface AiContextPayload {
    recentNews: NewsContextItem[];
    marketContext: MarketContextPayload;
}

interface FeedSourceDefinition {
    name: string;
    buildUrl: (symbol: string, keywords: string[]) => string;
}

@Injectable()
export class MarketContextService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MarketContextService.name);
    private readonly xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        trimValues: true,
        parseTagValue: false
    });
    private redisClient: RedisClientType;
    private readonly newsCacheTtlSeconds = Number(process.env.AI_NEWS_CACHE_TTL_SECONDS || 180);
    private readonly marketCacheTtlSeconds = Number(process.env.AI_MARKET_CACHE_TTL_SECONDS || 45);
    private readonly newsLookbackMinutes = Number(process.env.AI_NEWS_LOOKBACK_MINUTES || 240);
    private readonly maxNewsItems = Number(process.env.AI_MAX_NEWS_ITEMS || 8);
    private readonly maxFeedItemsPerSource = Number(process.env.AI_MAX_FEED_ITEMS_PER_SOURCE || 12);
    private readonly feedSources: FeedSourceDefinition[] = [
        {
            name: 'Google News',
            buildUrl: (symbol, keywords) => {
                const query = [symbol, ...keywords, 'crypto', 'market'].join(' OR ');
                return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
            }
        },
        {
            name: 'CoinDesk',
            buildUrl: () => 'https://www.coindesk.com/arc/outboundfeeds/rss/'
        },
        {
            name: 'Cointelegraph',
            buildUrl: () => 'https://cointelegraph.com/rss'
        },
        {
            name: 'Decrypt',
            buildUrl: () => 'https://decrypt.co/feed'
        }
    ];

    constructor() {
        this.redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: {
                connectTimeout: 10000,
            }
        });

        this.redisClient.on('error', (error) => {
            this.logger.error('Redis Client Error:', error);
        });
    }

    async onModuleInit() {
        try {
            await this.redisClient.connect();
            this.logger.log('Servicio de contexto de mercado inicializado');
        } catch (error) {
            this.logger.warn('No se pudo conectar Redis para contexto de mercado, continuando sin cache');
            this.logger.error('Error conectando contexto de mercado:', error);
        }
    }

    async onModuleDestroy() {
        if (this.redisClient.isOpen) {
            await this.redisClient.disconnect();
        }
    }

    async getAiContext(symbol: string): Promise<AiContextPayload> {
        const [recentNews, marketContext] = await Promise.all([
            this.getRecentNews(symbol),
            this.getMarketContext(symbol)
        ]);

        return {
            recentNews,
            marketContext
        };
    }

    private async getRecentNews(symbol: string): Promise<NewsContextItem[]> {
        const cacheKey = `bot:ai-news:${symbol}`;
        const cached = await this.getCachedJson<NewsContextItem[]>(cacheKey);
        if (cached) {
            return cached;
        }

        const keywords = this.getSymbolKeywords(symbol);
        const results = await Promise.allSettled(
            this.feedSources.map((feedSource) => this.fetchFeedItems(feedSource, symbol, keywords))
        );

        const mergedItems = results.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : []
        );

        const uniqueItems = Array.from(
            new Map(
                mergedItems.map((item) => [`${item.title.toLowerCase()}|${item.publishedAt}`, item])
            ).values()
        );

        const relevantItems = uniqueItems
            .filter((item) => (item.relevance ?? 0) > 0)
            .sort((left, right) => {
                const relevanceDiff = (right.relevance ?? 0) - (left.relevance ?? 0);
                if (relevanceDiff !== 0) {
                    return relevanceDiff;
                }

                return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
            })
            .slice(0, this.maxNewsItems);

        await this.setCachedJson(cacheKey, relevantItems, this.newsCacheTtlSeconds);
        return relevantItems;
    }

    private async getMarketContext(symbol: string): Promise<MarketContextPayload> {
        const cacheKey = `bot:ai-market:${symbol}`;
        const cached = await this.getCachedJson<MarketContextPayload>(cacheKey);
        if (cached) {
            return cached;
        }

        const [ticker24h, kline1m, kline5m, kline15m, fearAndGreed, fundingRate, openInterest] = await Promise.allSettled([
            this.fetchJson<any>(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`),
            this.fetchJson<any[]>(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=2`),
            this.fetchJson<any[]>(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=2`),
            this.fetchJson<any[]>(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=15m&limit=2`),
            this.fetchJson<any>('https://api.alternative.me/fng/?limit=1'),
            this.fetchJson<any[]>(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=1`),
            this.fetchJson<any>(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`)
        ]);

        const priceChange1mPct = this.extractKlineChangePct(kline1m);
        const priceChange5mPct = this.extractKlineChangePct(kline5m);
        const priceChange15mPct = this.extractKlineChangePct(kline15m);
        const ticker = ticker24h.status === 'fulfilled' ? ticker24h.value : null;
        const fearGreedEntry = fearAndGreed.status === 'fulfilled' ? fearAndGreed.value?.data?.[0] : null;
        const funding = fundingRate.status === 'fulfilled' ? Number(fundingRate.value?.[0]?.fundingRate) : null;
        const openInterestValue = openInterest.status === 'fulfilled' ? Number(openInterest.value?.openInterest) : null;

        const notes: string[] = [];
        if (Number.isFinite(priceChange1mPct) && Math.abs(priceChange1mPct!) >= 0.0035) {
            notes.push(`Movimiento brusco en 1m: ${(priceChange1mPct! * 100).toFixed(2)}%`);
        }
        if (Number.isFinite(priceChange5mPct) && Math.abs(priceChange5mPct!) >= 0.0075) {
            notes.push(`Aceleracion fuerte en 5m: ${(priceChange5mPct! * 100).toFixed(2)}%`);
        }
        if (ticker && Number(ticker.quoteVolume) > 0) {
            notes.push(`Volumen 24h alto: ${Number(ticker.quoteVolume).toFixed(0)} quote units`);
        }
        if (Number.isFinite(funding) && Math.abs(funding!) >= 0.0005) {
            notes.push(`Funding exigente detectado: ${(funding! * 100).toFixed(4)}%`);
        }
        if (fearGreedEntry?.value_classification) {
            notes.push(`Sentimiento macro: ${fearGreedEntry.value_classification}`);
        }

        const marketContext: MarketContextPayload = {
            marketRegime: this.inferMarketRegime(priceChange1mPct, priceChange5mPct, priceChange15mPct),
            fundingRate: Number.isFinite(funding) ? funding! : undefined,
            openInterest: Number.isFinite(openInterestValue) ? openInterestValue! : undefined,
            fearGreedValue: fearGreedEntry ? Number(fearGreedEntry.value) : undefined,
            fearGreedClassification: fearGreedEntry?.value_classification,
            priceChange1mPct: Number.isFinite(priceChange1mPct) ? priceChange1mPct! : undefined,
            priceChange5mPct: Number.isFinite(priceChange5mPct) ? priceChange5mPct! : undefined,
            priceChange15mPct: Number.isFinite(priceChange15mPct) ? priceChange15mPct! : undefined,
            priceChange24hPct: ticker ? Number(ticker.priceChangePercent) / 100 : undefined,
            quoteVolume24h: ticker ? Number(ticker.quoteVolume) : undefined,
            notes
        };

        await this.setCachedJson(cacheKey, marketContext, this.marketCacheTtlSeconds);
        return marketContext;
    }

    private async fetchFeedItems(feedSource: FeedSourceDefinition, symbol: string, keywords: string[]): Promise<NewsContextItem[]> {
        try {
            const response = await fetch(feedSource.buildUrl(symbol, keywords), {
                headers: {
                    'User-Agent': 'volBot/1.0'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const xml = await response.text();
            const parsed = this.xmlParser.parse(xml);
            const rawItems = this.extractFeedEntries(parsed);
            const now = Date.now();
            const oldestAllowedTs = now - this.newsLookbackMinutes * 60 * 1000;

            return rawItems
                .map((entry) => this.mapFeedItem(entry, feedSource.name, keywords))
                .filter((item): item is NewsContextItem => item !== null)
                .filter((item) => {
                    const publishedAt = new Date(item.publishedAt).getTime();
                    return Number.isFinite(publishedAt) && publishedAt >= oldestAllowedTs;
                })
                .slice(0, this.maxFeedItemsPerSource);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`No se pudo obtener feed ${feedSource.name} para ${symbol}: ${message}`);
            return [];
        }
    }

    private extractFeedEntries(parsed: any): any[] {
        const rssItems = parsed?.rss?.channel?.item;
        if (rssItems) {
            return Array.isArray(rssItems) ? rssItems : [rssItems];
        }

        const atomEntries = parsed?.feed?.entry;
        if (atomEntries) {
            return Array.isArray(atomEntries) ? atomEntries : [atomEntries];
        }

        return [];
    }

    private mapFeedItem(entry: any, defaultSource: string, keywords: string[]): NewsContextItem | null {
        const title = this.cleanText(this.pickText(entry?.title));
        const summary = this.cleanText(this.pickText(entry?.description) || this.pickText(entry?.summary) || this.pickText(entry?.content));
        const publishedAtRaw = this.pickText(entry?.pubDate) || this.pickText(entry?.published) || this.pickText(entry?.updated);
        const publishedAt = publishedAtRaw ? new Date(publishedAtRaw).toISOString() : null;

        if (!title || !publishedAt) {
            return null;
        }

        const source = this.cleanText(this.pickText(entry?.source) || this.pickText(entry?.author?.name) || defaultSource);
        const relevance = this.calculateRelevance(`${title} ${summary || ''}`, keywords);

        return {
            source,
            publishedAt,
            title,
            summary: summary || undefined,
            sentiment: this.inferSentiment(`${title} ${summary || ''}`),
            relevance
        };
    }

    private pickText(value: any): string {
        if (typeof value === 'string') {
            return value;
        }

        if (value && typeof value === 'object') {
            if (typeof value['#text'] === 'string') {
                return value['#text'];
            }

            if (typeof value.text === 'string') {
                return value.text;
            }
        }

        return '';
    }

    private cleanText(value: string): string {
        return value
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    private calculateRelevance(text: string, keywords: string[]): number {
        const lowerText = text.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
            if (lowerText.includes(keyword.toLowerCase())) {
                score += 2;
            }
        }

        const highImpactTerms = ['sec', 'fed', 'cpi', 'etf', 'hack', 'liquidation', 'whale', 'tariff', 'lawsuit', 'binance', 'inflation'];
        for (const term of highImpactTerms) {
            if (lowerText.includes(term)) {
                score += 1;
            }
        }

        return score;
    }

    private inferSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
        const lowerText = text.toLowerCase();
        const bullishTerms = ['surge', 'jump', 'breakout', 'approval', 'inflow', 'rally', 'bullish', 'record high'];
        const bearishTerms = ['crash', 'sell-off', 'hack', 'lawsuit', 'dump', 'bearish', 'liquidation', 'outflow'];
        const bullishHits = bullishTerms.filter((term) => lowerText.includes(term)).length;
        const bearishHits = bearishTerms.filter((term) => lowerText.includes(term)).length;

        if (bullishHits > bearishHits) {
            return 'bullish';
        }

        if (bearishHits > bullishHits) {
            return 'bearish';
        }

        return 'neutral';
    }

    private getSymbolKeywords(symbol: string): string[] {
        const baseAsset = this.extractBaseAsset(symbol);
        const aliasMap: Record<string, string[]> = {
            BTC: ['btc', 'bitcoin'],
            ETH: ['eth', 'ethereum'],
            BNB: ['bnb', 'binance coin', 'binance'],
            SOL: ['sol', 'solana'],
            XRP: ['xrp', 'ripple'],
            ADA: ['ada', 'cardano'],
        };

        return Array.from(new Set([symbol.toLowerCase(), baseAsset.toLowerCase(), ...(aliasMap[baseAsset] || [])]));
    }

    private extractBaseAsset(symbol: string): string {
        const quoteAssets = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'BTC', 'ETH'];
        for (const quoteAsset of quoteAssets) {
            if (symbol.endsWith(quoteAsset) && symbol.length > quoteAsset.length) {
                return symbol.slice(0, -quoteAsset.length);
            }
        }

        return symbol;
    }

    private inferMarketRegime(priceChange1mPct?: number | null, priceChange5mPct?: number | null, priceChange15mPct?: number | null): string {
        const changes = [priceChange1mPct, priceChange5mPct, priceChange15mPct].filter((value): value is number => Number.isFinite(value));
        if (!changes.length) {
            return 'unknown';
        }

        const allPositive = changes.every((value) => value > 0);
        const allNegative = changes.every((value) => value < 0);
        const strongestMove = Math.max(...changes.map((value) => Math.abs(value)));

        if (allPositive && strongestMove >= 0.008) {
            return 'impulsive_uptrend';
        }

        if (allNegative && strongestMove >= 0.008) {
            return 'impulsive_downtrend';
        }

        if (allPositive) {
            return 'uptrend';
        }

        if (allNegative) {
            return 'downtrend';
        }

        return 'mixed';
    }

    private extractKlineChangePct(result: PromiseSettledResult<any[]>): number | null {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value) || result.value.length < 2) {
            return null;
        }

        const previousClose = Number(result.value[0]?.[4]);
        const latestClose = Number(result.value[1]?.[4]);
        if (!Number.isFinite(previousClose) || !Number.isFinite(latestClose) || previousClose === 0) {
            return null;
        }

        return (latestClose - previousClose) / previousClose;
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'volBot/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.json() as Promise<T>;
    }

    private async getCachedJson<T>(key: string): Promise<T | null> {
        if (!this.redisClient.isOpen) {
            return null;
        }

        try {
            const value = await this.redisClient.get(key);
            return value ? JSON.parse(value) as T : null;
        } catch (error) {
            this.logger.warn(`No se pudo leer cache ${key}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }

    private async setCachedJson(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
        if (!this.redisClient.isOpen) {
            return;
        }

        try {
            await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(payload));
        } catch (error) {
            this.logger.warn(`No se pudo escribir cache ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}