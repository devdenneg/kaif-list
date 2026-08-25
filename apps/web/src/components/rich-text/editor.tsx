import * as React from 'react';
import {
  BubbleMenu,
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';

import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Mention from '@tiptap/extension-mention';
import type { PublicUser, RichTextDoc } from '@kaif/shared';
import {
  AlignCenter,
  AlignLeft,
  Bold,
  Code,
  Heading2,
  ImagePlus,
  Paperclip,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { useFormFieldA11y } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { createMentionSuggestion } from './mention-suggestion';
import { IMAGE_WIDTHS, SizedImage } from './sized-image';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export interface RichTextEditorProps {
  value: RichTextDoc | null;
  onChange: (value: RichTextDoc | null, isEmpty: boolean) => void;
  placeholder?: string;
  users?: PublicUser[];
  editable?: boolean;
  minHeight?: string;
  className?: string;
  /** Показывать панель инструментов. Для коротких комментариев её можно скрыть. */
  toolbar?: boolean;
  /** Куда привязывать загруженные изображения. */
  uploadTarget?: { boardId?: string; taskId?: string };
  /**
   * Уже приложенные к задаче картинки — их можно вставить в текст,
   * не загружая заново. Главный сценарий: тестировщик приложил скриншот,
   * а автор ставит его в нужное место описания.
   */
  attachments?: { id: string; url: string; filename: string; isImage: boolean }[];
  onSubmit?: () => void;
  autoFocus?: boolean;
}

/**
 * Редактор описаний и комментариев.
 *
 * Поддерживает форматирование, чек-листы, ссылки, упоминания `@`
 * и вставку изображений из буфера (Ctrl+V со скриншотом — самый частый
 * способ приложить картинку к багу).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Опишите задачу…',
  users = [],
  editable = true,
  minHeight = '120px',
  className,
  toolbar = true,
  uploadTarget,
  attachments = [],
  onSubmit,
  autoFocus = false,
}: RichTextEditorProps): React.ReactElement {
  const formField = useFormFieldA11y();
  const usersRef = React.useRef(users);
  usersRef.current = users;

  const [uploading, setUploading] = React.useState(false);

  const uploadImage = React.useCallback(
    async (file: File): Promise<string | null> => {
      if (!file.type.startsWith('image/')) {
        toast.error('Можно вставлять только изображения');
        return null;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const result = await api.upload<{ items: { url: string }[] }>(
          '/api/attachments',
          formData,
          uploadTarget ?? {},
        );
        return result.items[0]?.url ?? null;
      } catch (error) {
        toast.error('Не удалось загрузить изображение', error);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [uploadTarget],
  );

  const editor = useEditor({
    extensions: [
      // Ссылки подключаем отдельным расширением с настройками безопасности.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'rounded-lg' } },
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      TextStyle,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      SizedImage.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        suggestion: createMentionSuggestion(() => usersRef.current),
      }),
    ],
    content: (value ?? undefined) as JSONContent | undefined,
    editable,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        ...(formField?.controlId ? { id: formField.controlId } : {}),
        ...(formField?.labelId ? { 'aria-labelledby': formField.labelId } : {}),
        ...(formField?.descriptionId ? { 'aria-describedby': formField.descriptionId } : {}),
        ...(formField?.required ? { 'aria-required': 'true' } : {}),
        class: cn('prose-kaif tiptap focus:outline-none', 'px-3 py-2'),
        style: `min-height:${minHeight}`,
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const image = files.find((file) => file.type.startsWith('image/'));
        if (!image) return false;
        event.preventDefault();
        void uploadImage(image).then((url) => {
          if (url) editorRef.current?.chain().focus().setImage({ src: url }).run();
        });
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        const image = files.find((file) => file.type.startsWith('image/'));
        if (!image) return false;
        event.preventDefault();
        void uploadImage(image).then((url) => {
          if (url) editorRef.current?.chain().focus().setImage({ src: url }).run();
        });
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (!onSubmit || event.key !== 'Enter') return false;

        // Cmd/Ctrl+Enter отправляет всегда — привычка остаётся рабочей.
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        // Shift+Enter — перенос строки, как в мессенджерах.
        if (event.shiftKey) return false;

        // Внутри блока кода Enter обязан переносить строку: отправлять код
        // построчно бессмысленно.
        if (editorRef.current?.isActive('codeBlock')) return false;

        // Подсказка упоминаний перехватывает Enter раньше нас — там он
        // выбирает человека, а не отправляет сообщение.
        event.preventDefault();
        onSubmit();
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const json = instance.getJSON() as RichTextDoc;
      onChange(json, instance.isEmpty);
    },
  });

  const editorRef = React.useRef<Editor | null>(null);
  editorRef.current = editor;

  // Внешнее изменение значения (сброс формы, загрузка задачи).
  React.useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(value ?? { type: 'doc', content: [] })) return;
    // Второй аргумент — emitUpdate: не хотим зациклить onChange на внешнем обновлении.
    editor.commands.setContent((value ?? '') as JSONContent | string, false);
  }, [editor, value]);

  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const imageAttachments = attachments.filter((attachment) => attachment.isImage);

  if (!editor) {
    return <div className="skeleton" style={{ minHeight }} />;
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-input bg-surface shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
        !editable && 'border-transparent bg-transparent shadow-none',
        className,
      )}
    >
      {/* Картинку выделили — показываем, что с ней можно сделать. */}
      {editable && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: instance }) => instance.isActive('image')}
          tippyOptions={{ duration: 120, placement: 'top' }}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-card"
        >
          {IMAGE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              onClick={() => editor.chain().focus().updateAttributes('image', { width }).run()}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                editor.getAttributes('image').width === width
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-secondary',
              )}
            >
              {width}%
            </button>
          ))}

          <Divider />

          <ToolbarButton
            icon={<AlignLeft />}
            label="По левому краю"
            active={editor.getAttributes('image').align !== 'center'}
            onClick={() => editor.chain().focus().updateAttributes('image', { align: 'left' }).run()}
          />
          <ToolbarButton
            icon={<AlignCenter />}
            label="По центру"
            active={editor.getAttributes('image').align === 'center'}
            onClick={() =>
              editor.chain().focus().updateAttributes('image', { align: 'center' }).run()
            }
          />

          <Divider />

          <ToolbarButton
            icon={<Trash2 />}
            label="Убрать из описания"
            onClick={() => editor.chain().focus().deleteSelection().run()}
          />
        </BubbleMenu>
      )}

      {toolbar && editable && (
        <div className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1">
          <ToolbarButton
            icon={<Bold />}
            label="Жирный (Ctrl+B)"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={<Italic />}
            label="Курсив (Ctrl+I)"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={<UnderlineIcon />}
            label="Подчёркнутый (Ctrl+U)"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            icon={<Strikethrough />}
            label="Зачёркнутый"
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />

          <Divider />

          <ToolbarButton
            icon={<Heading2 />}
            label="Заголовок"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            icon={<List />}
            label="Маркированный список"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={<ListOrdered />}
            label="Нумерованный список"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            icon={<ListChecks />}
            label="Чек-лист"
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />

          <Divider />

          <ToolbarButton
            icon={<Quote />}
            label="Цитата"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            icon={<Code />}
            label="Код"
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          <ToolbarButton
            icon={<Link2 />}
            label="Ссылка"
            active={editor.isActive('link')}
            onClick={() => {
              const previous = editor.getAttributes('link').href as string | undefined;
              const url = window.prompt('Адрес ссылки', previous ?? 'https://');
              if (url === null) return;
              if (url === '') {
                editor.chain().focus().unsetLink().run();
                return;
              }
              editor.chain().focus().setLink({ href: url }).run();
            }}
          />
          <ToolbarButton
            icon={<ImagePlus />}
            label="Загрузить изображение"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          />
          {imageAttachments.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Вставить из вложений"
                  aria-label="Вставить из вложений"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&_svg]:size-4"
                >
                  <Paperclip />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2">
                <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Вложения задачи
                </p>
                <div className="scrollbar-thin grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
                  {imageAttachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() =>
                        editor
                          .chain()
                          .focus()
                          .setImage({ src: attachment.url, alt: attachment.filename })
                          .run()
                      }
                      title={attachment.filename}
                      className="overflow-hidden rounded-md border border-border transition-colors hover:border-primary"
                    >
                      <img
                        src={attachment.url}
                        alt={attachment.filename}
                        className="h-16 w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            <ToolbarButton
              icon={<Undo2 />}
              label="Отменить"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            />
            <ToolbarButton
              icon={<Redo2 />}
              label="Повторить"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void uploadImage(file).then((url) => {
                if (url) editor.chain().focus().setImage({ src: url }).run();
              });
            }}
          />
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}

function Divider(): React.ReactElement {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function ToolbarButton({
  icon,
  label,
  active,
  disabled,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors [&_svg]:size-4 [@media(pointer:coarse)]:size-10',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          (disabled || loading) && 'pointer-events-none opacity-40',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
