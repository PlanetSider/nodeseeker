import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('010 multi-source and AI usage migration', () => {
    it('migrates existing source selections and subscription links', () => {
        const db = new Database(':memory:');
        const migrationsDirectory = join(process.cwd(), 'src', 'database', 'migrations');

        for (const filename of [
            '001_initial.sql',
            '002_add_rss_config.sql',
            '003_add_telegram_mode.sql',
            '004_add_feishu_config.sql',
            '005_add_keyword_strict_flags.sql',
        ]) {
            db.exec(readFileSync(join(migrationsDirectory, filename), 'utf8'));
        }
        db.query(`
            INSERT INTO base_config (username, password, stop_push, only_title)
            VALUES (?, ?, 0, 0)
        `).run('admin', 'password');
        for (const filename of [
            '006_add_rss_sources.sql',
            '007_add_ai_translation.sql',
            '008_add_rss_subscription_toggle.sql',
            '009_add_post_link.sql',
        ]) {
            db.exec(readFileSync(join(migrationsDirectory, filename), 'utf8'));
        }

        db.query('UPDATE ai_translation_config SET enabled = 1 WHERE id = 1').run();
        db.query('INSERT INTO ai_translation_sources (rss_source_id) VALUES (1)').run();
        db.query('INSERT INTO keywords_sub (keyword1, rss_source_id) VALUES (?, 1)').run('vps');
        db.exec(readFileSync(join(migrationsDirectory, '010_add_multi_source_and_ai_usage.sql'), 'utf8'));

        expect(db.query('SELECT ai_translation_enabled FROM rss_sources WHERE id = 1').get()).toEqual({
            ai_translation_enabled: 1,
        });
        expect(db.query('SELECT keyword_sub_id, rss_source_id FROM keyword_sub_sources').all()).toEqual([
            { keyword_sub_id: 1, rss_source_id: 1 },
        ]);
        expect(db.query(`
            SELECT prompt_tokens, completion_tokens, total_tokens
            FROM ai_translation_config WHERE id = 1
        `).get()).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });

        db.close();
    });
});
