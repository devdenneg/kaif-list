import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RichTextDoc } from '@kaif/shared';
import { RichTextViewer } from './viewer';

describe('просмотр форматированного текста', () => {
  it('сохраняет пустые строки из редактора', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'До отступа' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'После отступа' }] },
      ],
    };

    const html = renderToStaticMarkup(<RichTextViewer doc={doc} />);

    expect(html.match(/<p><br\/?><\/p>/g)).toHaveLength(2);
    expect(html).toContain('До отступа');
    expect(html).toContain('После отступа');
  });

  it('сохраняет выравнивание абзаца', () => {
    const doc: RichTextDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [{ type: 'text', text: 'По центру' }],
        },
      ],
    };

    expect(renderToStaticMarkup(<RichTextViewer doc={doc} />)).toContain(
      'style="text-align:center"',
    );
  });
});
