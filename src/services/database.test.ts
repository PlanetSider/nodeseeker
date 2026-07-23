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
