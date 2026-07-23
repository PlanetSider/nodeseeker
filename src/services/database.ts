import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'fs';
import { createDatabaseConnection, getDatabaseConfig } from '../config/database';
import type { BaseConfig, Post, KeywordSub, CleanupResult, RSSSource, AITranslationConfig } from '../types';
import { logger } from '../utils/logger';

export class DatabaseService {
  private queryCache: Map<string, { data: any; timestamp: number; ttl: number }>;
  private readonly CACHE_TTL = 60000; // 1分钟缓存

  constructor(private db: Database) {
    this.queryCache = new Map();
  }

  // 静态工厂方法
  static create(): DatabaseService {
    const db = createDatabaseConnection();
    return new DatabaseService(db);
  }

  // 缓存助手方法
  private getCacheKey(method: string, params: any[]): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  private getFromCache<T>(key: string): T | null {
    const cached = this.queryCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data as T;
    }
    this.queryCache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttl: number = this.CACHE_TTL): void {
    this.queryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  private clearCacheByPattern(pattern: string): void {
    const keysToDelete: string[] = [];
    this.queryCache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.queryCache.delete(key));
  }

  /**
   * 检查数据库表是否存在
   */
  checkTablesExist(): boolean {
    try {
      // 检查主要表是否存在
      const tables = ['base_config', 'posts', 'keywords_sub'];
      
      for (const table of tables) {
        const result = this.db.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name=?
        `).get(table);
        
        if (!result) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('检查数据库表存在性失败:', error);
      return false;
    }
  }

  // 基础配置相关操作
  getBaseConfig(): BaseConfig | null {
    const cacheKey = this.getCacheKey('getBaseConfig', []);
    const cached = this.getFromCache<BaseConfig | null>(cacheKey);
    if (cached !== null) return cached;

    const result = this.db.query('SELECT * FROM base_config LIMIT 1').get() as BaseConfig | null;
    
    // 缓存120秒，配置变化不频繁
    this.setCache(cacheKey, result, 120000);
    return result;
  }

  createBaseConfig(config: Omit<BaseConfig, 'id' | 'created_at' | 'updated_at'>): BaseConfig {
    const stmt = this.db.query(`
      INSERT INTO base_config (username, password, stop_push, only_title, rss_url, rss_interval_seconds, rss_proxy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    
    const result = stmt.get(
      config.username,
      config.password,
      config.stop_push,
      config.only_title,
      config.rss_url || 'https://rss.nodeseek.com/',
      config.rss_interval_seconds || 60,
      config.rss_proxy || null
    ) as BaseConfig;
    
    // 清理相关缓存
    this.clearCacheByPattern('BaseConfig');
    
    return result;
  }

  updateBaseConfig(config: Partial<BaseConfig>): BaseConfig | null {
    const updates: string[] = [];
    const values: any[] = [];

    if (config.username !== undefined) {
      updates.push('username = ?');
      values.push(config.username);
    }
    if (config.password !== undefined) {
      updates.push('password = ?');
      values.push(config.password);
    }
    if (config.feishu_app_id !== undefined) {
      updates.push('feishu_app_id = ?');
      values.push(config.feishu_app_id);
    }
    if (config.feishu_app_secret !== undefined) {
      updates.push('feishu_app_secret = ?');
      values.push(config.feishu_app_secret);
    }
    if (config.feishu_chat_id !== undefined) {
      updates.push('feishu_chat_id = ?');
      values.push(config.feishu_chat_id);
    }
    if (config.feishu_user_open_id !== undefined) {
      updates.push('feishu_user_open_id = ?');
      values.push(config.feishu_user_open_id);
    }
    if (config.bound_user_name !== undefined) {
      updates.push('bound_user_name = ?');
      values.push(config.bound_user_name);
    }
    if (config.bound_user_username !== undefined) {
      updates.push('bound_user_username = ?');
      values.push(config.bound_user_username);
    }
    if (config.stop_push !== undefined) {
      updates.push('stop_push = ?');
      values.push(config.stop_push);
    }
    if (config.only_title !== undefined) {
      updates.push('only_title = ?');
      values.push(config.only_title);
    }
    if (config.rss_url !== undefined) {
      updates.push('rss_url = ?');
      values.push(config.rss_url);
    }
    if (config.rss_interval_seconds !== undefined) {
      updates.push('rss_interval_seconds = ?');
      values.push(config.rss_interval_seconds);
    }
    if (config.rss_proxy !== undefined) {
      updates.push('rss_proxy = ?');
      values.push(config.rss_proxy);
    }
    if (updates.length === 0) {
      return this.getBaseConfig();
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const stmt = this.db.query(`
      UPDATE base_config 
      SET ${updates.join(', ')}
      WHERE id = (SELECT id FROM base_config LIMIT 1)
      RETURNING *
    `);

    const result = stmt.get(...values) as BaseConfig | null;

    // 清理相关缓存
    this.clearCacheByPattern('BaseConfig');

    return result;
  }

  // 文章相关操作
  createPost(post: Omit<Post, 'id' | 'created_at'>): Post {
    const stmt = this.db.query(`
      INSERT INTO posts (post_id, title, memo, category, creator, push_status, sub_id, rss_source_id, link, pub_date, push_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const result = stmt.get(
      post.post_id,
      post.title,
      post.memo,
      post.category,
      post.creator,
      post.push_status,
      post.sub_id || null,
      post.rss_source_id || null,
      post.link || null,
      post.pub_date,
      post.push_date || null
    ) as Post;

    // 清除相关缓存
    this.clearCacheByPattern('posts');
    this.clearCacheByPattern('Stats');

    return result;
  }

  /**
   * 批量创建文章
   */
  batchCreatePosts(posts: Array<Omit<Post, 'id' | 'created_at'>>): number {
    if (posts.length === 0) {
      return 0;
    }

    const stmt = this.db.query(`
      INSERT INTO posts (post_id, title, memo, category, creator, push_status, sub_id, rss_source_id, link, pub_date, push_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 使用事务进行批量插入
    const transaction = this.db.transaction((posts: Array<Omit<Post, 'id' | 'created_at'>>) => {
      let insertedCount = 0;
      for (const post of posts) {
        try {
          stmt.run(
            post.post_id,
            post.title,
            post.memo,
            post.category,
            post.creator,
            post.push_status,
            post.sub_id || null,
            post.rss_source_id || null,
            post.link || null,
            post.pub_date,
            post.push_date || null
          );
          insertedCount++;
        } catch (error) {
          logger.error(`插入文章失败 (post_id: ${post.post_id}):`, error);
        }
      }
      return insertedCount;
    });

    const insertedCount = transaction(posts);
    
    // 清除相关缓存
    this.clearCacheByPattern('posts');
    this.clearCacheByPattern('Stats');
    
    return insertedCount;
  }

  getPostByPostId(postId: number): Post | null {
    const stmt = this.db.query('SELECT * FROM posts WHERE post_id = ?');
    return stmt.get(postId) as Post | null;
  }

  /**
   * 批量查询文章，根据 post_id 数组
   */
  getPostsByPostIds(postIds: number[], rssSourceId?: number): Map<number, Post> {
    if (postIds.length === 0) {
      return new Map();
    }

    // 构建 IN 查询的占位符
    const placeholders = postIds.map(() => '?').join(',');
    const query = `SELECT * FROM posts WHERE post_id IN (${placeholders})${rssSourceId ? ' AND rss_source_id = ?' : ''}`;
    
    const stmt = this.db.query(query);
    const results = stmt.all(...postIds, ...(rssSourceId ? [rssSourceId] : [])) as Post[];
    
    // 将结果转换为 Map，以 post_id 为键
    const postMap = new Map<number, Post>();
    results.forEach(post => {
      postMap.set(post.post_id, post);
    });
    
    return postMap;
  }

  updatePostPushStatus(postId: number, pushStatus: number, subId?: number, pushDate?: string, rssSourceId?: number): void {
    const stmt = this.db.query(`
      UPDATE posts 
      SET push_status = ?, sub_id = ?, push_date = ?
      WHERE post_id = ? AND (? IS NULL OR rss_source_id = ?)
    `);
    
    stmt.run(pushStatus, subId || null, pushDate || null, postId, rssSourceId || null, rssSourceId || null);
  }

  getRecentPosts(limit: number = 10): Post[] {
    const stmt = this.db.query(`
      SELECT * FROM posts 
      ORDER BY pub_date DESC 
      LIMIT ?
    `);
    
    return stmt.all(limit) as Post[];
  }

  getUnpushedPosts(): Post[] {
    const stmt = this.db.query(`
      SELECT p.*, rs.name AS rss_source_name
      FROM posts p
      LEFT JOIN rss_sources rs ON p.rss_source_id = rs.id
      WHERE p.push_status = 0
      ORDER BY p.pub_date ASC
    `);
    
    return stmt.all() as Post[];
  }

  // 新增：带分页的文章查询（包含匹配的关键词信息）
  getPostsWithPagination(
    page: number = 1, 
    limit: number = 30, 
    filters?: {
      pushStatus?: number;
      pushStatusIn?: number[];  // 新增：IN 查询
      pushStatusNot?: number;
      creator?: string;
      category?: string;
      search?: string;
      subId?: number;
    }
  ): {
    posts: Array<Post & { keywords?: string[] }>;
    total: number;
    page: number;
    totalPages: number;
  } {
    const offset = (page - 1) * limit;
    
    // 构建查询条件
    const conditions: string[] = [];
    const params: any[] = [];
    

    if (filters) {
      if (filters.pushStatusIn && filters.pushStatusIn.length > 0) {
        const placeholders = filters.pushStatusIn.map(() => '?').join(',');
        conditions.push(`p.push_status IN (${placeholders})`);
        params.push(...filters.pushStatusIn);
      } else if (filters.pushStatus !== undefined && filters.pushStatus !== null && filters.pushStatus.toString() !== '') {
        conditions.push('p.push_status = ?');
        params.push(filters.pushStatus);
      }
      
      if (filters.pushStatusNot !== undefined && filters.pushStatusNot !== null && filters.pushStatusNot.toString() !== '') {
        conditions.push('p.push_status != ?');
        params.push(filters.pushStatusNot);
      }
      
      if (filters.creator) {
        conditions.push('p.creator LIKE ?');
        params.push(`%${filters.creator}%`);
      }
      
      if (filters.category) {
        conditions.push('p.category LIKE ?');
        params.push(`%${filters.category}%`);
      }
      
      if (filters.search) {
        conditions.push('p.title LIKE ?');
        params.push(`%${filters.search}%`);
      }
      
      // 按订阅筛选：直接从订阅详情构建查询条件，而非通过 sub_id 关联
      if (filters.subId !== undefined) {
        const sub = this.getKeywordSubById(filters.subId);
        if (sub) {
          // 关键词匹配：每个非空关键词必须在标题或内容中出现（AND 关系）
          const keywords = [sub.keyword1, sub.keyword2, sub.keyword3]
            .filter(k => k && k.trim().length > 0) as string[];
          
          for (const keyword of keywords) {
            conditions.push('(p.title LIKE ? OR p.memo LIKE ?)');
            params.push(`%${keyword}%`, `%${keyword}%`);
          }
          
          // 作者匹配
          if (sub.creator && sub.creator.trim().length > 0) {
            conditions.push('p.creator LIKE ?');
            params.push(`%${sub.creator.trim()}%`);
          }
          
          // 分类匹配
          if (sub.category && sub.category.trim().length > 0) {
            conditions.push('p.category LIKE ?');
            params.push(`%${sub.category.trim()}%`);
          }

          if (sub.rss_source_id) {
            conditions.push('p.rss_source_id = ?');
            params.push(sub.rss_source_id);
          }
        } else {
          // 订阅不存在，返回空结果
          conditions.push('1 = 0');
        }
      }
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // 查询文章，LEFT JOIN 订阅表以获取匹配的订阅详情
    const postsStmt = this.db.query(`
      SELECT p.*,
             ks.keyword1 AS sub_keyword1,
             ks.keyword2 AS sub_keyword2,
             ks.keyword3 AS sub_keyword3,
             ks.creator  AS sub_creator,
             ks.category AS sub_category,
             rs.name AS rss_source_name,
             subrs.name AS sub_rss_source_name
      FROM posts p
      LEFT JOIN keywords_sub ks ON p.sub_id = ks.id
      LEFT JOIN rss_sources rs ON p.rss_source_id = rs.id
      LEFT JOIN rss_sources subrs ON ks.rss_source_id = subrs.id
      ${whereClause}
      ORDER BY p.pub_date DESC 
      LIMIT ? OFFSET ?
    `);
    const posts = postsStmt.all(...params, limit, offset) as Post[];
    
    // 查询总数（使用与主查询相同的别名和 JOIN）
    const countStmt = this.db.query(`
      SELECT COUNT(*) as count
      FROM posts p
      LEFT JOIN keywords_sub ks ON p.sub_id = ks.id
      LEFT JOIN rss_sources rs ON p.rss_source_id = rs.id
      LEFT JOIN rss_sources subrs ON ks.rss_source_id = subrs.id
      ${whereClause}
    `);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult?.count || 0;
    const totalPages = Math.ceil(total / limit);
    
    return {
      posts,
      total,
      page,
      totalPages
    };
  }

  // 新增：批量更新文章推送状态
  batchUpdatePostPushStatus(updates: Array<{
    postId: number;
    pushStatus: number;
    subId?: number;
    pushDate?: string;
    rssSourceId?: number;
  }>): void {
    if (updates.length === 0) return;
    
    const stmt = this.db.query(`
      UPDATE posts 
      SET push_status = ?, sub_id = ?, push_date = ?
      WHERE post_id = ? AND (? IS NULL OR rss_source_id = ?)
    `);
    
    // 使用事务进行批量更新
    const transaction = this.db.transaction((updates) => {
      for (const update of updates) {
        stmt.run(
          update.pushStatus,
          update.subId || null,
          update.pushDate || null,
          update.postId,
          update.rssSourceId || null,
          update.rssSourceId || null
        );
      }
    });
    
    transaction(updates);
  }

  // 关键词订阅相关操作
  createKeywordSub(sub: Omit<KeywordSub, 'id' | 'created_at' | 'updated_at'>): KeywordSub {
    const stmt = this.db.query(`
      INSERT INTO keywords_sub (keyword1, keyword2, keyword3, keyword1_strict, keyword2_strict, keyword3_strict, creator, category, rss_source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);

    const result = stmt.get(
      sub.keyword1 || null,
      sub.keyword2 || null,
      sub.keyword3 || null,
      sub.keyword1_strict || 0,
      sub.keyword2_strict || 0,
      sub.keyword3_strict || 0,
      sub.creator || null,
      sub.category || null,
      sub.rss_source_id || null
    ) as KeywordSub;

    // 清理相关缓存
    this.clearCacheByPattern('KeywordSubs');
    this.clearCacheByPattern('Subscriptions');

    return result;
  }

  getAllKeywordSubs(): KeywordSub[] {
    const cacheKey = this.getCacheKey('getAllKeywordSubs', []);
    const cached = this.getFromCache<KeywordSub[]>(cacheKey);
    if (cached !== null) return cached;

    const stmt = this.db.query(`
      SELECT ks.*, rs.name AS rss_source_name
      FROM keywords_sub ks
      LEFT JOIN rss_sources rs ON ks.rss_source_id = rs.id
      ORDER BY ks.created_at DESC
    `);
    const subscriptions = stmt.all() as KeywordSub[];
    
    // 缓存60秒，因为订阅变化不频繁
    this.setCache(cacheKey, subscriptions, 60000);
    return subscriptions;
  }

  deleteKeywordSub(id: number): boolean {
    const stmt = this.db.query('DELETE FROM keywords_sub WHERE id = ?');
    const result = stmt.run(id);
    
    // 清理相关缓存
    this.clearCacheByPattern('KeywordSubs');
    this.clearCacheByPattern('Subscriptions');
    
    return result.changes > 0;
  }

  updateKeywordSub(id: number, sub: Partial<Omit<KeywordSub, 'id' | 'created_at' | 'updated_at'>>): KeywordSub | null {
    const updates: string[] = [];
    const values: any[] = [];

    if (sub.keyword1 !== undefined) {
      updates.push('keyword1 = ?');
      values.push(sub.keyword1 || null);
    }
    if (sub.keyword2 !== undefined) {
      updates.push('keyword2 = ?');
      values.push(sub.keyword2 || null);
    }
    if (sub.keyword3 !== undefined) {
      updates.push('keyword3 = ?');
      values.push(sub.keyword3 || null);
    }
    if (sub.keyword1_strict !== undefined) {
      updates.push('keyword1_strict = ?');
      values.push(sub.keyword1_strict || 0);
    }
    if (sub.keyword2_strict !== undefined) {
      updates.push('keyword2_strict = ?');
      values.push(sub.keyword2_strict || 0);
    }
    if (sub.keyword3_strict !== undefined) {
      updates.push('keyword3_strict = ?');
      values.push(sub.keyword3_strict || 0);
    }
    if (sub.creator !== undefined) {
      updates.push('creator = ?');
      values.push(sub.creator || null);
    }
    if (sub.category !== undefined) {
      updates.push('category = ?');
      values.push(sub.category || null);
    }
    if (sub.rss_source_id !== undefined) {
      updates.push('rss_source_id = ?');
      values.push(sub.rss_source_id || null);
    }

    if (updates.length === 0) {
      return this.getKeywordSubById(id);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.query(`
      UPDATE keywords_sub 
      SET ${updates.join(', ')}
      WHERE id = ?
      RETURNING *
    `);

    const result = stmt.get(...values) as KeywordSub | null;
    this.clearCacheByPattern('KeywordSubs');
    this.clearCacheByPattern('Subscriptions');
    return result;
  }

  getKeywordSubById(id: number): KeywordSub | null {
    const stmt = this.db.query(`
      SELECT ks.*, rs.name AS rss_source_name
      FROM keywords_sub ks
      LEFT JOIN rss_sources rs ON ks.rss_source_id = rs.id
      WHERE ks.id = ?
    `);
    return stmt.get(id) as KeywordSub | null;
  }

  getAllRSSSources(includeDisabled: boolean = false): RSSSource[] {
    const stmt = this.db.query(`
      SELECT * FROM rss_sources
      ${includeDisabled ? '' : 'WHERE enabled = 1'}
      ORDER BY id ASC
    `);
    return stmt.all() as RSSSource[];
  }

  ensureDefaultRSSSource(url: string = 'https://rss.nodeseek.com/'): RSSSource {
    const existing = this.getAllRSSSources(true)[0];
    if (existing) return existing;
    return this.createRSSSource({ name: 'NodeSeek', url, enabled: 1, subscription_enabled: 1 });
  }

  getRSSSourceById(id: number): RSSSource | null {
    const stmt = this.db.query('SELECT * FROM rss_sources WHERE id = ?');
    return stmt.get(id) as RSSSource | null;
  }

  createRSSSource(source: Omit<RSSSource, 'id' | 'created_at' | 'updated_at'>): RSSSource {
    const stmt = this.db.query(`
      INSERT INTO rss_sources (name, url, enabled, subscription_enabled)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `);
    const result = stmt.get(source.name, source.url, source.enabled ?? 1, source.subscription_enabled ?? 1) as RSSSource;
    this.queryCache.clear();
    return result;
  }

  updateRSSSource(id: number, source: Partial<Omit<RSSSource, 'id' | 'created_at' | 'updated_at'>>): RSSSource | null {
    const updates: string[] = [];
    const values: any[] = [];
    if (source.name !== undefined) {
      updates.push('name = ?');
      values.push(source.name);
    }
    if (source.url !== undefined) {
      updates.push('url = ?');
      values.push(source.url);
    }
    if (source.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(source.enabled);
    }
    if (source.subscription_enabled !== undefined) {
      updates.push('subscription_enabled = ?');
      values.push(source.subscription_enabled);
    }
    if (updates.length === 0) return this.getRSSSourceById(id);

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    const stmt = this.db.query(`
      UPDATE rss_sources
      SET ${updates.join(', ')}
      WHERE id = ?
      RETURNING *
    `);
    const result = stmt.get(...values) as RSSSource | null;
    this.queryCache.clear();
    return result;
  }

  deleteRSSSource(id: number): boolean {
    this.db.query('DELETE FROM ai_translation_sources WHERE rss_source_id = ?').run(id);
    this.db.query('UPDATE keywords_sub SET rss_source_id = NULL WHERE rss_source_id = ?').run(id);
    this.db.query('UPDATE posts SET rss_source_id = NULL WHERE rss_source_id = ?').run(id);
    const stmt = this.db.query('DELETE FROM rss_sources WHERE id = ?');
    const result = stmt.run(id);
    this.queryCache.clear();
    return result.changes > 0;
  }

  getAITranslationConfig(): AITranslationConfig {
    const config = this.db.query('SELECT * FROM ai_translation_config WHERE id = 1').get() as Omit<AITranslationConfig, 'rss_source_ids'>;
    const sources = this.db.query('SELECT rss_source_id FROM ai_translation_sources ORDER BY rss_source_id').all() as Array<{ rss_source_id: number }>;
    return { ...config, rss_source_ids: sources.map((source) => source.rss_source_id) };
  }

  updateAITranslationConfig(config: Partial<AITranslationConfig>): AITranslationConfig {
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const key of ['enabled', 'api_url', 'api_key', 'model', 'prompt'] as const) {
      if (config[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(config[key]);
      }
    }

    const transaction = this.db.transaction(() => {
      if (updates.length > 0) {
        this.db.query(`UPDATE ai_translation_config SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(...values);
      }
      if (config.rss_source_ids !== undefined) {
        this.db.query('DELETE FROM ai_translation_sources').run();
        const insert = this.db.query('INSERT INTO ai_translation_sources (rss_source_id) VALUES (?)');
        for (const sourceId of new Set(config.rss_source_ids)) insert.run(sourceId);
      }
    });
    transaction();
    return this.getAITranslationConfig();
  }

  // 数据库初始化检查：只要用户存在即视为已初始化
  isInitialized(): boolean {
    try {
      const config = this.getBaseConfig();
      return config !== null;
    } catch (error) {
      return false;
    }
  }

  // 统计查询方法（使用 COUNT 提高效率和缓存）
  getPostsCount(): number {
    const cacheKey = this.getCacheKey('getPostsCount', []);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts
    `);
    const result = stmt.get() as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 30000); // 30秒缓存
    return count;
  }

  getPostsCountByStatus(pushStatus: number): number {
    const cacheKey = this.getCacheKey('getPostsCountByStatus', [pushStatus]);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts
      WHERE push_status = ?
    `);
    const result = stmt.get(pushStatus) as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 30000); // 30秒缓存
    return count;
  }

  getSubscriptionsCount(): number {
    const cacheKey = this.getCacheKey('getSubscriptionsCount', []);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    const stmt = this.db.query(`SELECT COUNT(*) as count FROM keywords_sub`);
    const result = stmt.get() as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 60000); // 1分钟缓存（关键词变化较少）
    return count;
  }

  getTodayPostsCount(): number {
    const cacheKey = this.getCacheKey('getTodayPostsCount', []);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    // 从当天 0 点（UTC）开始
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStart = today.toISOString().replace('T', ' ').substring(0, 19);

    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts
      WHERE datetime(pub_date) >= datetime(?)
    `);
    const result = stmt.get(todayStart) as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 60000);
    return count;
  }

  getTodayPushedCount(): number {
    const cacheKey = this.getCacheKey('getTodayMatchedCount', []);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    // 从当天 0 点（UTC）开始
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStart = today.toISOString().replace('T', ' ').substring(0, 19);

    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts
      WHERE push_status IN (1, 3) AND datetime(pub_date) >= datetime(?)
    `);
    const result = stmt.get(todayStart) as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 60000);
    return count;
  }

  getTodayMessagesCount(): number {
    const cacheKey = this.getCacheKey('getTodayMessagesCount', []);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;

    // 从当天 0 点（UTC）开始
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStart = today.toISOString().replace('T', ' ').substring(0, 19);

    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts
      WHERE push_status = 3 AND datetime(push_date) >= datetime(?)
    `);
    const result = stmt.get(todayStart) as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 60000);
    return count;
  }

  getPostsCountByDateRange(startDate: string, endDate: string): number {
    const cacheKey = this.getCacheKey('getPostsCountByDateRange', [startDate, endDate]);
    const cached = this.getFromCache<number>(cacheKey);
    if (cached !== null) return cached;
    
    const stmt = this.db.query(`
      SELECT COUNT(*) as count FROM posts 
      WHERE DATE(pub_date) BETWEEN ? AND ?
    `);
    const result = stmt.get(startDate, endDate) as { count: number };
    const count = result?.count || 0;
    this.setCache(cacheKey, count, 60000); // 1分钟缓存
    return count;
  }

  getLastUpdateTime(): string | null {
    const stmt = this.db.query(`
      SELECT created_at as last_update FROM posts order by id desc limit 1
    `);
    const result = stmt.get() as { last_update: string } | null;
    return result?.last_update || null; // 返回最后更新时间
  }

  getDatabaseSizeMb(): number {
    const dbPath = getDatabaseConfig().path;
    const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    const totalBytes = paths.reduce((total, filePath) => {
      if (!existsSync(filePath)) return total;
      return total + statSync(filePath).size;
    }, 0);

    return Math.round((totalBytes / 1024 / 1024) * 100) / 100;
  }

  cleanupPostsBefore(cutoffDate: Date): CleanupResult {
    const cutoff = cutoffDate.toISOString();
    const databaseSizeBeforeMb = this.getDatabaseSizeMb();
    const result = this.db.query(`
      DELETE FROM posts
      WHERE datetime(pub_date) < datetime(?)
    `).run(cutoff);

    this.queryCache.clear();

    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
    } catch (error) {
      logger.warn('数据库清理后压缩失败:', error);
    }

    return {
      deletedCount: result.changes || 0,
      cutoffDate: cutoff,
      databaseSizeBeforeMb,
      databaseSizeAfterMb: this.getDatabaseSizeMb()
    };
  }

  // 获取综合统计信息
  getComprehensiveStats(): {
    total_posts: number;
    pushed_posts: number; // 已推送成功 (状态 3)
    matched_not_pushed: number; // 已匹配但未推送 (状态 1)
    total_subscriptions: number;
    today_pushed: number;
    today_posts: number;
    last_update: string | null;
    database_size_mb: number;
  } {
    try {
      const totalPosts = this.getPostsCount();
      const pushedPosts = this.getPostsCountByStatus(3); // 已推送成功
      const matchedNotPushed = this.getPostsCountByStatus(1); // 已匹配但未推送
      const totalSubscriptions = this.getSubscriptionsCount();
      const todayPushed = this.getTodayPushedCount();
      const todayPosts = this.getTodayPostsCount();
      const lastUpdate = this.getLastUpdateTime();
      const databaseSizeMb = this.getDatabaseSizeMb();

      return {
        total_posts: totalPosts,
        pushed_posts: pushedPosts,
        matched_not_pushed: matchedNotPushed,
        total_subscriptions: totalSubscriptions,
        today_pushed: todayPushed,
        today_posts: todayPosts,
        last_update: lastUpdate,
        database_size_mb: databaseSizeMb
      };
    } catch (error) {
      logger.error('获取综合统计信息失败:', error);
      return {
        total_posts: 0,
        pushed_posts: 0,
        matched_not_pushed: 0,
        total_subscriptions: 0,
        today_pushed: 0,
        today_posts: 0,
        last_update: null,
        database_size_mb: 0
      };
    }
  }

  /**
   * 最近 24 小时发帖趋势：按小时统计过去 24 小时内每小时的发帖数
   * 返回 24 个桶，index 0 = 24h 前，index 23 = 1h 前（时间顺序从左到右）
   */
  getLast24HoursPostStats(): Array<{ hour: number; count: number }> {
    const cacheKey = this.getCacheKey('getLast24HoursPostStats', []);
    const cached = this.getFromCache<Array<{ hour: number; count: number }>>(cacheKey);
    if (cached !== null) return cached;

    // hours_ago: 0=最近1小时, 23=24小时前
    const rows = this.db.query(`
      SELECT
        CAST((julianday('now') - julianday(datetime(pub_date))) * 24 AS INTEGER) AS hours_ago,
        COUNT(*) AS count
      FROM posts
      WHERE datetime(pub_date) >= datetime('now', '-24 hours')
      GROUP BY hours_ago
    `).all() as Array<{ hours_ago: number; count: number }>;

    const countByHoursAgo = new Map<number, number>();
    rows.forEach((r) => {
      const h = Math.max(0, Math.min(23, r.hours_ago));
      countByHoursAgo.set(h, r.count);
    });

    // 转为时间顺序：index 0 = 24h 前，index 23 = 1h 前
    const result = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: countByHoursAgo.get(23 - i) || 0,
    }));

    this.setCache(cacheKey, result, 60000);
    return result;
  }

  /**
   * 按小时统计最近 N 天的发帖数量（已弃用，保留供兼容）
   * days=-1 → 仅今日（从 0 点开始）；days=0 → 全部；days>0 → 最近 N 天
   */
  getHourlyPostStats(days: number = 7): Array<{ hour: number; count: number }> {
    const cacheKey = this.getCacheKey('getHourlyPostStats', [days]);
    const cached = this.getFromCache<Array<{ hour: number; count: number }>>(cacheKey);
    if (cached !== null) return cached;

    let rows: Array<{ hour: number; count: number }>;

    if (days === -1) {
      // 仅今日：从当天 0 点（UTC）开始
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayStart = today.toISOString().replace('T', ' ').substring(0, 19);

      rows = this.db.query(`
        SELECT CAST(strftime('%H', datetime(pub_date)) AS INTEGER) AS hour, COUNT(*) AS count
        FROM posts
        WHERE datetime(pub_date) >= datetime(?)
        GROUP BY hour
        ORDER BY hour
      `).all(todayStart) as Array<{ hour: number; count: number }>;
    } else if (days === 0) {
      rows = this.db.query(`
        SELECT CAST(strftime('%H', datetime(pub_date)) AS INTEGER) AS hour, COUNT(*) AS count
        FROM posts
        GROUP BY hour
        ORDER BY hour
      `).all() as Array<{ hour: number; count: number }>;
    } else {
      // 最近 N 天：从 N 天前的 0 点开始
      const startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - days);
      startDate.setUTCHours(0, 0, 0, 0);
      const startTime = startDate.toISOString().replace('T', ' ').substring(0, 19);

      rows = this.db.query(`
        SELECT CAST(strftime('%H', datetime(pub_date)) AS INTEGER) AS hour, COUNT(*) AS count
        FROM posts
        WHERE datetime(pub_date) >= datetime(?)
        GROUP BY hour
        ORDER BY hour
      `).all(startTime) as Array<{ hour: number; count: number }>;
    }

    // 填充缺失的小时（保证 0-23 都有值）
    const hourMap = new Map<number, number>();
    rows.forEach(r => hourMap.set(r.hour, r.count));
    const result = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: hourMap.get(i) || 0,
    }));

    this.setCache(cacheKey, result, 60000);
    return result;
  }

  /**
   * 统计最近 N 天各分类的帖子数量
   * days=-1 → 仅今日（从 0 点开始）；days=0 → 全部；days>0 → 最近 N 天
   */
  getCategoryDistribution(days: number = 7): Array<{ category: string; count: number }> {
    const cacheKey = this.getCacheKey('getCategoryDistribution', [days]);
    const cached = this.getFromCache<Array<{ category: string; count: number }>>(cacheKey);
    if (cached !== null) return cached;

    let result: Array<{ category: string; count: number }>;

    if (days === -1) {
      // 仅今日：从当天 0 点（UTC）开始
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const todayStart = today.toISOString().replace('T', ' ').substring(0, 19);

      result = this.db.query(`
        SELECT category, COUNT(*) AS count
        FROM posts
        WHERE datetime(pub_date) >= datetime(?)
        GROUP BY category
        ORDER BY count DESC
      `).all(todayStart) as Array<{ category: string; count: number }>;
    } else if (days === 0) {
      result = this.db.query(`
        SELECT category, COUNT(*) AS count
        FROM posts
        GROUP BY category
        ORDER BY count DESC
      `).all() as Array<{ category: string; count: number }>;
    } else {
      // 最近 N 天：从 N 天前的 0 点开始
      const startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - days);
      startDate.setUTCHours(0, 0, 0, 0);
      const startTime = startDate.toISOString().replace('T', ' ').substring(0, 19);

      result = this.db.query(`
        SELECT category, COUNT(*) AS count
        FROM posts
        WHERE datetime(pub_date) >= datetime(?)
        GROUP BY category
        ORDER BY count DESC
      `).all(startTime) as Array<{ category: string; count: number }>;
    }

    this.setCache(cacheKey, result, 60000);
    return result;
  }


  // 关闭数据库连接
  close(): void {
    this.db.close();
  }
}
