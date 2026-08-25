import Image from '@tiptap/extension-image';

/**
 * Картинка с размером и выравниванием.
 *
 * Скриншот в описании должен показывать, куда смотреть: узкая картинка на всю
 * ширину теряется, а широкая занимает экран. Поэтому у изображения есть ширина
 * в процентах и выравнивание — их выставляют кнопками, когда картинка выделена.
 *
 * Ширина хранится числом процентов, а не пикселями: описание читают и с
 * телефона, и с широкого монитора.
 */

export const IMAGE_WIDTHS = [33, 66, 100] as const;
export type ImageAlign = 'left' | 'center';

function parsePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return clamp(value);
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,3})%$/.exec(value.trim());
  return match ? clamp(Number(match[1])) : null;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(10, Math.round(value)));
}

export const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),

      width: {
        default: null as number | null,
        parseHTML: (element) =>
          parsePercent(element.getAttribute('data-width') ?? element.style.width),
        renderHTML: (attributes) => {
          const width = parsePercent(attributes.width);
          if (!width) return {};
          return { 'data-width': String(width), style: `width:${width}%` };
        },
      },

      align: {
        default: null as ImageAlign | null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-align');
          return value === 'left' || value === 'center' ? value : null;
        },
        renderHTML: (attributes) => {
          const align = attributes.align;
          if (align !== 'left' && align !== 'center') return {};
          return { 'data-align': align };
        },
      },
    };
  },
});
