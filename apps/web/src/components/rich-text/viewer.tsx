import * as React from 'react';
import { taskKeyScanner, type RichTextDoc, type RichTextNode } from '@kaif/shared';
import { cn } from '@/lib/utils';

/**
 * Рендерер документа TipTap.
 *
 * Намеренно НЕ используем экземпляр редактора для просмотра: в ленте
 * комментариев их были бы десятки, и ProseMirror съел бы память и время.
 * Здесь — обычные React-элементы по белому списку узлов; всё, что не в списке,
 * просто игнорируется (сервер и так санитайзит документ при сохранении).
 */

interface ViewerProps {
  doc: RichTextDoc | null | undefined;
  className?: string;
  /** Ограничить высоту с кнопкой «показать полностью». */
  collapsible?: boolean;
}

export function RichTextViewer({ doc, className, collapsible }: ViewerProps): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);

  React.useEffect(() => {
    if (!collapsible || !contentRef.current) return;
    setOverflows(contentRef.current.scrollHeight > 340);
  }, [collapsible, doc]);

  if (!doc || !doc.content || doc.content.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          'prose-kaif break-words',
          collapsible && !expanded && overflows && 'max-h-[340px] overflow-hidden',
          className,
        )}
      >
        {doc.content.map((node, index) => (
          <NodeRenderer key={index} node={node} />
        ))}
      </div>

      {collapsible && overflows && (
        <>
          {!expanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 h-16 bg-gradient-to-t from-card to-transparent" />
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? 'Свернуть' : 'Показать полностью'}
          </button>
        </>
      )}
    </div>
  );
}

function NodeRenderer({ node }: { node: RichTextNode }): React.ReactElement | null {
  const children = node.content?.map((child, index) => <NodeRenderer key={index} node={child} />);

  switch (node.type) {
    case 'text':
      return <TextNode node={node} />;

    case 'paragraph':
      return <p>{children}</p>;

    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      if (level === 1) return <h1>{children}</h1>;
      if (level === 3) return <h3>{children}</h3>;
      return <h2>{children}</h2>;
    }

    case 'bulletList':
      return <ul>{children}</ul>;

    case 'orderedList':
      return <ol start={Number(node.attrs?.start ?? 1)}>{children}</ol>;

    case 'listItem':
      return <li>{children}</li>;

    case 'taskList':
      return <ul data-type="taskList">{children}</ul>;

    case 'taskItem':
      return (
        <li>
          <label>
            <input type="checkbox" checked={node.attrs?.checked === true} readOnly className="size-3.5" />
          </label>
          <div className={cn(node.attrs?.checked === true && 'text-muted-foreground line-through')}>
            {children}
          </div>
        </li>
      );

    case 'blockquote':
      return <blockquote>{children}</blockquote>;

    case 'codeBlock':
      return (
        <pre>
          <code>{children}</code>
        </pre>
      );

    case 'horizontalRule':
      return <hr />;

    case 'hardBreak':
      return <br />;

    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
      if (!src) return null;

      // Ширина и выравнивание заданы автором описания — в просмотре картинка
      // должна выглядеть ровно так же, иначе смысл «смотри сюда» теряется.
      const width = Number(node.attrs?.width);
      const centered = node.attrs?.align === 'center';

      return (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('block', centered && 'mx-auto w-fit')}
          style={Number.isFinite(width) && width > 0 ? { width: `${width}%` } : undefined}
        >
          <img
            src={src}
            alt={typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''}
            loading="lazy"
            className="w-full"
          />
        </a>
      );
    }

    case 'mention': {
      const label = typeof node.attrs?.label === 'string' ? node.attrs.label : 'участник';
      return <span className="mention">@{label}</span>;
    }

    default:
      return children ? <>{children}</> : null;
  }
}

/**
 * Ключи задач в тексте превращаются в ссылки.
 *
 * В обсуждениях постоянно пишут «см. OPS-12» — заставлять человека
 * копировать ключ и искать его вручную незачем.
 */
function linkifyTaskKeys(text: string): React.ReactNode {
  const scanner = taskKeyScanner();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <a
        key={`${match.index}-${match[0]}`}
        href={`/tasks/${match[0]}`}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        {match[0]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

/** Марки применяются вложенно, порядок не важен — все они инлайновые. */
function TextNode({ node }: { node: RichTextNode }): React.ReactElement {
  const text = node.text ?? '';
  const hasLink = (node.marks ?? []).some((mark) => mark.type === 'link');
  const isCode = (node.marks ?? []).some((mark) => mark.type === 'code');

  // Внутри ссылки и кода автоссылки не нужны: вложенная ссылка невалидна,
  // а в коде «OPS-12» — это просто текст.
  let element: React.ReactNode = hasLink || isCode ? text : linkifyTaskKeys(text);

  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        element = <strong>{element}</strong>;
        break;
      case 'italic':
        element = <em>{element}</em>;
        break;
      case 'underline':
        element = <u>{element}</u>;
        break;
      case 'strike':
        element = <s>{element}</s>;
        break;
      case 'code':
        element = <code>{element}</code>;
        break;
      case 'highlight':
        element = (
          <mark
            style={
              typeof mark.attrs?.color === 'string'
                ? { backgroundColor: `${mark.attrs.color}33` }
                : undefined
            }
          >
            {element}
          </mark>
        );
        break;
      case 'textStyle':
        if (typeof mark.attrs?.color === 'string') {
          element = <span style={{ color: mark.attrs.color }}>{element}</span>;
        }
        break;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '#';
        element = (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {element}
          </a>
        );
        break;
      }
      default:
        break;
    }
  }

  return <>{element}</>;
}
