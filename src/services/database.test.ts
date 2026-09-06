import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DatabaseService } from './database';

describe('DatabaseService database size', () => {
    it('reads size from the active SQLite database instead of a deployment path', () => {
        const db = new Database(':memory:');
        db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)');
        const insert = db.query('INSERT INTO entries (value) VALUES (?)');
        for (let index = 0; index < 100; index++) insert.run('x'.repeat(1000));

        const size = new DatabaseService(db).getDatabaseSizeMb();

        expect(size).toBeGreaterThan(0);
        db.close();
    });
});

describe('DatabaseService post content', () => {
    it('stores the original RSS HTML with the post', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                memo TEXT NOT NULL,
                category TEXT NOT NULL,
                creator TEXT NOT NULL,
                push_status INTEGER DEFAULT 0,
                sub_id INTEGER,
                rss_source_id INTEGER,
                link TEXT,
                content_html TEXT,
                pub_date TEXT NOT NULL,
                push_date TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        const service = new DatabaseService(db);
        const contentHtml = '<p>First paragraph</p><p><strong>Second paragraph</strong></p>';

        service.createPost({
            post_id: 101,
            title: 'Formatted post',
            memo: 'First paragraph\n\nSecond paragraph',
            content_html: contentHtml,
            category: 'tech',
            creator: 'tester',
            push_status: 0,
            rss_source_id: 1,
            link: 'https://example.com/post/101',
            pub_date: new Date().toISOString(),
        });

        expect(service.getPostByPostId(101)?.content_html).toBe(contentHtml);
        db.close();
    });
});
