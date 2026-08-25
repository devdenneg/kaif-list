import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { ALLOWED_ATTACHMENT_MIME, IMAGE_MIME, LIMITS } from '@kaif/shared';
import { env } from '../config/env.js';
import { BadRequestError, PayloadTooLargeError } from './errors.js';
import { logger } from './logger.js';

/**
 * Хранилище файлов на диске.
 *
 * Принципы:
 *  - имя файла на диске генерирует сервер (исходное имя — только для показа);
 *  - тип определяется по сигнатуре, а не по заголовку Content-Type;
 *  - изображения перекодируются: это убивает полиглот-файлы и вырезает EXIF
 *    (в том числе геометки со смартфонов);
 *  - файлы лежат вне webroot и отдаются только авторизованным роутом.
 */

const ROOT = path.resolve(env.STORAGE_DIR);
const FILES_DIR = path.join(ROOT, 'files');
const THUMBS_DIR = path.join(ROOT, 'thumbs');
const AVATARS_DIR = path.join(ROOT, 'avatars');

/** Типы без узнаваемой сигнатуры — разрешаем только если содержимое похоже на текст. */
const TEXT_LIKE_MIME = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

const MAX_IMAGE_DIMENSION = 4000;
const THUMB_SIZE = 480;

export async function ensureStorageDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(FILES_DIR, { recursive: true }),
    fs.mkdir(THUMBS_DIR, { recursive: true }),
    fs.mkdir(AVATARS_DIR, { recursive: true }),
  ]);
}

/** Раскладываем файлы по подпапкам, чтобы не упереться в лимит записей каталога. */
function shardDir(base: string, storedName: string): string {
  return path.join(base, storedName.slice(0, 2));
}

export function storedFilePath(storedName: string): string {
  assertSafeStoredName(storedName);
  return path.join(shardDir(FILES_DIR, storedName), storedName);
}

export function thumbFilePath(thumbName: string): string {
  assertSafeStoredName(thumbName);
  return path.join(shardDir(THUMBS_DIR, thumbName), thumbName);
}

export function avatarFilePath(name: string): string {
  assertSafeStoredName(name);
  return path.join(AVATARS_DIR, name);
}

/** Имя файла на диске всегда генерируем сами — но проверка лишней не бывает. */
export function assertSafeStoredName(name: string): void {
  if (!/^[a-f0-9]{24,64}\.[a-z0-9]{1,8}$/.test(name)) {
    throw new BadRequestError('Некорректное имя файла');
  }
}

export interface StoredFile {
  storedName: string;
  filename: string;
  mime: string;
  size: number;
  checksum: string;
  width: number | null;
  height: number | null;
  thumbName: string | null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-7z-compressed': '7z',
  'application/vnd.rar': 'rar',
  'application/gzip': 'gz',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

/** Отображаемое имя: без путей, без управляющих символов, разумной длины. */
export function sanitizeFilename(original: string): string {
  const base = path.basename(original).replace(/[\x00-\x1f\x7f]/g, '');
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').trim();
  const safe = cleaned.length > 0 ? cleaned : 'file';
  return safe.length > 180 ? `${safe.slice(0, 150)}~${path.extname(safe).slice(0, 10)}` : safe;
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isPrintable = byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (!isPrintable) suspicious += 1;
  }
  return suspicious / Math.max(sample.length, 1) < 0.05;
}

/**
 * Определяет фактический тип файла.
 * `declaredMime` используется только как подсказка для текстовых форматов,
 * у которых нет сигнатуры.
 */
export async function detectMime(buffer: Buffer, declaredMime: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    if (!ALLOWED_ATTACHMENT_MIME.includes(detected.mime)) {
      throw new BadRequestError(`Тип файла ${detected.mime} не разрешён`);
    }
    return detected.mime;
  }

  const normalized = declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (TEXT_LIKE_MIME.has(normalized) && looksLikeText(buffer)) return normalized;
  if (looksLikeText(buffer)) return 'text/plain';

  throw new BadRequestError('Не удалось определить тип файла или он не разрешён');
}

/** Сохраняет вложение: проверяет тип, перекодирует изображения, делает превью. */
export async function storeAttachment(
  buffer: Buffer,
  originalName: string,
  declaredMime: string,
): Promise<StoredFile> {
  if (buffer.length === 0) throw new BadRequestError('Пустой файл');
  const maxBytes = Math.min(LIMITS.attachment.maxBytes, env.maxUploadBytes);
  if (buffer.length > maxBytes) {
    throw new PayloadTooLargeError(
      `Максимальный размер файла — ${Math.floor(maxBytes / 1024 / 1024)} МБ`,
    );
  }

  const mime = await detectMime(buffer, declaredMime);
  const isImage = IMAGE_MIME.includes(mime);

  let payload = buffer;
  let width: number | null = null;
  let height: number | null = null;
  let thumbName: string | null = null;
  let finalMime = mime;

  if (isImage) {
    const processed = await processImage(buffer, mime);
    payload = processed.buffer;
    width = processed.width;
    height = processed.height;
    finalMime = processed.mime;
  }

  const extension = EXTENSION_BY_MIME[finalMime] ?? 'bin';
  const storedName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  const checksum = crypto.createHash('sha256').update(payload).digest('hex');

  const targetDir = shardDir(FILES_DIR, storedName);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, storedName), payload, { mode: 0o640 });

  if (isImage) {
    try {
      const thumb = await sharp(payload, { animated: false })
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      thumbName = `${storedName.split('.')[0]}.webp`;
      const thumbDir = shardDir(THUMBS_DIR, thumbName);
      await fs.mkdir(thumbDir, { recursive: true });
      await fs.writeFile(path.join(thumbDir, thumbName), thumb, { mode: 0o640 });
    } catch (error) {
      logger.warn({ err: error }, 'Не удалось построить превью изображения');
      thumbName = null;
    }
  }

  return {
    storedName,
    filename: sanitizeFilename(originalName),
    mime: finalMime,
    size: payload.length,
    checksum,
    width,
    height,
    thumbName,
  };
}

interface ProcessedImage {
  buffer: Buffer;
  width: number | null;
  height: number | null;
  mime: string;
}

/**
 * Перекодирование изображения. Побочный, но главный эффект — файл на диске
 * гарантированно является картинкой и не содержит ни EXIF, ни постороннего кода.
 */
async function processImage(buffer: Buffer, mime: string): Promise<ProcessedImage> {
  const animated = mime === 'image/gif' || mime === 'image/webp';
  let pipeline = sharp(buffer, { animated, limitInputPixels: 100_000_000 });

  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) {
    throw new BadRequestError('Повреждённое изображение');
  }

  if (!animated) pipeline = pipeline.rotate();

  if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
    pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let output: Buffer;
  let finalMime = mime;
  switch (mime) {
    case 'image/jpeg':
      output = await pipeline.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      break;
    case 'image/png':
      output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      break;
    case 'image/gif':
      output = await pipeline.gif().toBuffer();
      break;
    case 'image/avif':
      output = await pipeline.avif({ quality: 60 }).toBuffer();
      break;
    default:
      output = await pipeline.webp({ quality: 86 }).toBuffer();
      finalMime = 'image/webp';
      break;
  }

  const finalMeta = await sharp(output, { animated }).metadata();
  return {
    buffer: output,
    width: finalMeta.width ?? metadata.width,
    height: finalMeta.pageHeight ?? finalMeta.height ?? metadata.height,
    mime: finalMime,
  };
}

/** Аватар: квадрат 256×256 webp, метаданные вырезаны. */
export async function storeAvatar(buffer: Buffer, declaredMime: string): Promise<string> {
  if (buffer.length > LIMITS.avatar.maxBytes) {
    throw new PayloadTooLargeError('Аватар не должен превышать 5 МБ');
  }
  const mime = await detectMime(buffer, declaredMime);
  if (!IMAGE_MIME.includes(mime)) throw new BadRequestError('Аватар должен быть изображением');

  const output = await sharp(buffer, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(LIMITS.avatar.size, LIMITS.avatar.size, { fit: 'cover', position: 'attention' })
    .webp({ quality: 88 })
    .toBuffer();

  const name = `${crypto.randomBytes(16).toString('hex')}.webp`;
  await fs.mkdir(AVATARS_DIR, { recursive: true });
  await fs.writeFile(path.join(AVATARS_DIR, name), output, { mode: 0o640 });
  return name;
}

export async function deleteStoredFile(
  storedName: string,
  thumbName?: string | null,
): Promise<void> {
  const targets = [storedFilePath(storedName)];
  if (thumbName) targets.push(thumbFilePath(thumbName));
  await Promise.all(
    targets.map(async (target) => {
      try {
        await fs.unlink(target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') logger.warn({ err: error, target }, 'Не удалось удалить файл');
      }
    }),
  );
}

export async function deleteAvatar(name: string): Promise<void> {
  try {
    await fs.unlink(avatarFilePath(name));
  } catch {
    // Файла может уже не быть — это не ошибка.
  }
}

/** Отдавать ли файл встроенно (картинки, pdf, медиа) или заставить скачать. */
export function isInlineSafe(mime: string): boolean {
  return (
    IMAGE_MIME.includes(mime) ||
    mime === 'application/pdf' ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/')
  );
}

/** Скачать аватар из Telegram и сохранить локально (чтобы не зависеть от их CDN). */
export async function downloadAndStoreAvatar(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > LIMITS.avatar.maxBytes) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > LIMITS.avatar.maxBytes) return null;
    return await storeAvatar(buffer, response.headers.get('content-type') ?? '');
  } catch (error) {
    logger.warn({ err: error }, 'Не удалось загрузить аватар из Telegram');
    return null;
  }
}
