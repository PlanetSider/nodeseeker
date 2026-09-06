import { describe, expect, it } from 'bun:test';
import { htmlToMarkdown, htmlToReadableText } from './content';

describe('RSS HTML content conversion', () => {
    const html = `
        <h2>Section</h2>
        <p>A <strong>bold</strong> paragraph.</p>
        <ol><li>First</li><li>Second</li></ol>
        <pre><code>const value = 1;</code></pre>
        <p><a href="https://example.com">Documentation</a></p>
        <script>alert('ignored')</script>
    `;

    it('converts supported HTML formatting to Markdown', () => {
        const markdown = htmlToMarkdown(html);

        expect(markdown).toContain('## Section');
        expect(markdown).toContain('A **bold** paragraph.');
        expect(markdown).toContain('1.  First');
        expect(markdown).toContain('```\nconst value = 1;\n```');
        expect(markdown).toContain('[Documentation](https://example.com)');
        expect(markdown).not.toContain('ignored');
    });

    it('creates searchable text without losing document structure', () => {
        const text = htmlToReadableText(html);

        expect(text).toContain('Section\n\nA bold paragraph.');
        expect(text).toContain('1.  First');
        expect(text).toContain('const value = 1;');
        expect(text).toContain('Documentation (https://example.com)');
    });
});
