import * as React from 'react';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { LIMITS, type AttachmentDto, type TaskDetailDto } from '@kaif/shared';
import { api } from '@/lib/api';
import { invalidateEntity, invalidateTaskScopes } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Lightbox } from '@/components/ui/lightbox';
import { formatBytes, formatRelative, cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Вложения задачи.
 * Файлы можно перетащить прямо в область — самый ожидаемый жест.
 */
export function TaskAttachments({
  task,
  editable,
}: {
  task: TaskDetailDto;
  editable: boolean;
}): React.ReactElement {
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files).slice(0, LIMITS.attachment.maxPerRequest);
    if (list.length === 0) return;

    const oversized = list.find((file) => file.size > LIMITS.attachment.maxBytes);
    if (oversized) {
      toast.error('Файл слишком большой', new Error(`«${oversized.name}» больше 25 МБ`));
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of list) formData.append('files', file);
      await api.upload(`/api/tasks/${task.id}/attachments`, formData);
      invalidateEntity('task', task.id);
      invalidateTaskScopes(task.board.id);
      toast.success(list.length === 1 ? 'Файл приложен' : `Приложено файлов: ${list.length}`);
    } catch (error) {
      toast.error('Не удалось загрузить файл', error);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (attachment: AttachmentDto): Promise<void> => {
    try {
      await api.delete(`/api/attachments/${attachment.id}`);
      invalidateEntity('task', task.id);
      invalidateTaskScopes(task.board.id);
    } catch (error) {
      toast.error('Не удалось удалить файл', error);
    }
  };

  const images = task.attachments.filter((attachment) => attachment.isImage);
  const files = task.attachments.filter((attachment) => !attachment.isImage);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Вложения</h3>
        {task.attachments.length > 0 && (
          <span className="text-xs text-muted-foreground">{task.attachments.length}</span>
        )}
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto [@media(pointer:coarse)]:min-h-11"
            onClick={() => inputRef.current?.click()}
            loading={uploading}
          >
            <Upload />
            Загрузить
          </Button>
        )}
      </div>

      {editable && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void upload(event.dataTransfer.files);
          }}
          className={cn(
            'rounded-lg border border-dashed p-4 text-center text-xs transition-colors',
            dragOver
              ? 'border-primary bg-accent/40 text-accent-foreground'
              : 'border-border text-muted-foreground',
          )}
        >
          Перетащите файлы сюда или{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md font-medium text-primary hover:underline [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:px-1"
          >
            выберите на устройстве
          </button>
          <p className="mt-1 opacity-70">до 25 МБ · картинки, документы, архивы, видео</p>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((attachment, index) => (
            <figure
              key={attachment.id}
              className="group relative overflow-hidden rounded-lg border border-border"
            >
              <button
                type="button"
                onClick={() => setLightboxIndex(index)}
                className="block w-full"
                aria-label={`Открыть ${attachment.filename}`}
              >
                <img
                  src={attachment.thumbnailUrl ?? attachment.url}
                  alt={attachment.filename}
                  className="h-28 w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </button>
              <figcaption className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
                {editable && (
                  <button
                    type="button"
                    onClick={() => void remove(attachment)}
                    className="shrink-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:opacity-100"
                    aria-label="Удалить"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <Lightbox
        images={images.map((attachment) => ({
          id: attachment.id,
          url: attachment.url,
          filename: attachment.filename,
          size: attachment.size,
        }))}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((attachment) => (
            <li
              key={attachment.id}
              className="group flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(attachment.size)}
              </span>
              <Tooltip
                content={`${attachment.uploader.displayName} · ${formatRelative(attachment.createdAt)}`}
              >
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:p-0"
                  aria-label="Скачать"
                >
                  <Download className="size-3.5" />
                </a>
              </Tooltip>
              {editable && (
                <button
                  type="button"
                  onClick={() => void remove(attachment)}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100 [@media(pointer:coarse)]:flex [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-center [@media(pointer:coarse)]:p-0 [@media(pointer:coarse)]:opacity-100"
                  aria-label="Удалить"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {task.attachments.length === 0 && !editable && (
        <p className="text-sm text-muted-foreground">Вложений нет.</p>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          event.target.value = '';
          if (files) void upload(files);
        }}
      />
    </section>
  );
}
