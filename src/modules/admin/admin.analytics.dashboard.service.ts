import { esClient, pingElasticsearch } from '@/config/elasticsearch.js';
import { logger } from '@/shared/utils/logger.js';
import type {
  IAdminAnalyticsDashboard,
  IAdminAnalyticsDashboardQuery,
  ITimeSeriesPoint,
  IHourlyPoint,
  IGroupChatMetricRow,
  INamedValue,
} from './admin.types.js';

const MS_PER_DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;

function resolveRange(query: IAdminAnalyticsDashboardQuery): { fromIso: string; toIso: string } {
  const now = Date.now();
  let toMs = query.to ? new Date(query.to).getTime() : now;
  let fromMs = query.from ? new Date(query.from).getTime() : toMs - DEFAULT_RANGE_DAYS * MS_PER_DAY;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    toMs = now;
    fromMs = toMs - DEFAULT_RANGE_DAYS * MS_PER_DAY;
  }
  if (toMs < fromMs) {
    const t = fromMs;
    fromMs = toMs;
    toMs = t;
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * MS_PER_DAY) {
    fromMs = toMs - MAX_RANGE_DAYS * MS_PER_DAY;
  }
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

function calendarInterval(
  interval: IAdminAnalyticsDashboardQuery['interval'],
): 'hour' | 'day' | 'week' | 'month' {
  switch (interval) {
    case 'hour':
      return 'hour';
    case 'week':
      return 'week';
    case 'month':
      return 'month';
    case 'day':
    default:
      return 'day';
  }
}

function dateHistogramBuckets(
  aggs: Record<string, unknown> | undefined,
  aggName: string,
): { key: number; key_as_string?: string; doc_count: number }[] {
  const root = aggs?.[aggName] as { buckets?: unknown[] } | undefined;
  const buckets = root?.buckets;
  if (!Array.isArray(buckets)) return [];
  return buckets as { key: number; key_as_string?: string; doc_count: number }[];
}

function toTimeSeries(
  buckets: { key: number; key_as_string?: string; doc_count: number }[],
): ITimeSeriesPoint[] {
  return buckets.map((b) => ({
    t: b.key_as_string ?? new Date(b.key).toISOString(),
    count: b.doc_count,
  }));
}

function toHourlySeries(
  buckets: { key: number; key_as_string?: string; doc_count: number }[],
): IHourlyPoint[] {
  return buckets.map((b) => {
    const d = new Date(b.key);
    return {
      t: b.key_as_string ?? d.toISOString(),
      hour: d.getUTCHours(),
      count: b.doc_count,
    };
  });
}

function emptyDashboard(
  fromIso: string,
  toIso: string,
  interval: IAdminAnalyticsDashboardQuery['interval'],
  source: IAdminAnalyticsDashboard['meta']['source'],
): IAdminAnalyticsDashboard {
  return {
    meta: { from: fromIso, to: toIso, interval: interval ?? 'day', source },
    kpi: {
      totalMessages: 0,
      totalPosts: 0,
      groupConversationsWithMessages: 0,
      peakHourUtc: null,
    },
    messagesByInterval: [],
    messagesByHour: [],
    groupChatTop: [],
    postsByInterval: [],
    postsByType: [],
  };
}

export const adminAnalyticsDashboardService = {
  getDashboard: async (query: IAdminAnalyticsDashboardQuery): Promise<IAdminAnalyticsDashboard> => {
    const interval = query.interval ?? 'day';
    const { fromIso, toIso } = resolveRange(query);
    const cal = calendarInterval(interval);

    const esUp = await pingElasticsearch();
    if (!esUp) {
      logger.warn('Admin analytics dashboard: Elasticsearch unavailable');
      return emptyDashboard(fromIso, toIso, interval, 'unavailable');
    }

    const rangeFilter = { range: { createdAt: { gte: fromIso, lte: toIso } } };

    try {
      const [messagesRes, postsRes] = await Promise.all([
        esClient.search({
          index: 'messages',
          size: 0,
          track_total_hits: true,
          query: { bool: { filter: [rangeFilter] } },
          aggs: {
            main_histogram: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: cal,
                min_doc_count: 0,
              },
            },
            peak_histogram: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: 'hour',
                min_doc_count: 0,
              },
            },
            group_chats: {
              filter: { term: { conversationType: 'group' } },
              aggs: {
                by_conv: {
                  terms: { field: 'conversationId', size: 25 },
                },
              },
            },
          },
        }),
        esClient.search({
          index: 'posts',
          size: 0,
          track_total_hits: true,
          query: { bool: { filter: [rangeFilter] } },
          aggs: {
            main_histogram: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: cal,
                min_doc_count: 0,
              },
            },
            by_type: {
              terms: { field: 'type', size: 20 },
            },
          },
        }),
      ]);

      const msgAggs = messagesRes.aggregations as Record<string, unknown> | undefined;
      const postAggs = postsRes.aggregations as Record<string, unknown> | undefined;

      const mainMsgBuckets = dateHistogramBuckets(msgAggs, 'main_histogram');
      const peakBuckets = dateHistogramBuckets(msgAggs, 'peak_histogram');
      const groupTerms = ((
        msgAggs?.group_chats as { by_conv?: { buckets?: unknown[] } } | undefined
      )?.by_conv?.buckets ?? []) as { key: string; doc_count: number }[];

      const mainPostBuckets = dateHistogramBuckets(postAggs, 'main_histogram');
      const typeBuckets = ((postAggs?.by_type as { buckets?: unknown[] } | undefined)?.buckets ??
        []) as { key: string; doc_count: number }[];

      const totalMessages =
        typeof messagesRes.hits.total === 'number'
          ? messagesRes.hits.total
          : (messagesRes.hits.total?.value ?? 0);
      const totalPosts =
        typeof postsRes.hits.total === 'number'
          ? postsRes.hits.total
          : (postsRes.hits.total?.value ?? 0);

      let peakHourUtc: string | null = null;
      if (peakBuckets.length > 0) {
        const top = peakBuckets.reduce(
          (a, b) => (b.doc_count >= a.doc_count ? b : a),
          peakBuckets[0],
        );
        peakHourUtc = new Date(top.key).toISOString();
      }

      const groupChatTop: IGroupChatMetricRow[] = groupTerms.map((b) => ({
        conversationId: b.key,
        messageCount: b.doc_count,
        name: null,
      }));

      const postsByType: INamedValue[] = typeBuckets.map((b) => ({
        name: b.key || 'unknown',
        value: b.doc_count,
      }));

      return {
        meta: { from: fromIso, to: toIso, interval, source: 'elasticsearch' },
        kpi: {
          totalMessages,
          totalPosts,
          groupConversationsWithMessages: groupTerms.length,
          peakHourUtc,
        },
        messagesByInterval: toTimeSeries(mainMsgBuckets),
        messagesByHour: toHourlySeries(peakBuckets),
        groupChatTop,
        postsByInterval: toTimeSeries(mainPostBuckets),
        postsByType,
      };
    } catch (error) {
      logger.error('Admin analytics dashboard ES error:', error);
      return emptyDashboard(fromIso, toIso, interval, 'unavailable');
    }
  },
};
