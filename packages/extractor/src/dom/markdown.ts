import TurndownService from 'turndown';

/**
 * Renders cleaned HTML to Markdown. Used in compile prompts where the LLM
 * does better with a flatter representation than full DOM. The executor
 * always runs against the cleaned HTML (locators need structure) — markdown
 * is purely a compile-time view.
 *
 * Configured to:
 *   - keep link URLs (`[text](href)`) so the compiler can see anchor targets
 *   - keep `<code>` blocks intact (docs pages depend on them)
 *   - drop images (selector generation doesn't need them; tokens are precious)
 */
export type MarkdownOptions = {
  /** Override the default heading style. ATX (`#`) is more compact. */
  headingStyle?: 'atx' | 'setext';
  /** When true, include image references; default false. */
  keepImages?: boolean;
};

function buildService(opts: MarkdownOptions): TurndownService {
  const service = new TurndownService({
    headingStyle: opts.headingStyle ?? 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });

  if (!opts.keepImages) {
    service.addRule('drop-images', {
      filter: 'img',
      replacement: () => '',
    });
  }

  // Preserve <pre><code> blocks with language hints when present.
  service.addRule('fenced-code', {
    filter: (node) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector('code');
      const lang =
        code?.className.match(/language-([\w-]+)/)?.[1] ??
        code?.getAttribute('data-language') ??
        '';
      const text = code?.textContent ?? '';
      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    },
  });

  return service;
}

export function htmlToMarkdown(html: string, opts: MarkdownOptions = {}): string {
  return buildService(opts).turndown(html).trim();
}
