import TurndownService from 'turndown';

const markdownConverter = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
});

markdownConverter.remove(['script', 'style', 'noscript', 'iframe']);

function normalizeWhitespace(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function htmlToMarkdown(html: string): string {
    if (!html.trim()) return '';
    return normalizeWhitespace(markdownConverter.turndown(html));
}

export function htmlToReadableText(html: string): string {
    return normalizeWhitespace(
        htmlToMarkdown(html)
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/^>\s?/gm, '')
            .replace(/^```[^\n]*\n?/gm, '')
            .replace(/```$/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
            .replace(/`([^`]+)`/g, '$1'),
    );
}
