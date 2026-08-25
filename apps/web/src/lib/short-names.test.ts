import { describe, expect, it } from 'vitest';
import { shortNames } from './short-names';

/**
 * В полосе людей помещается только имя. Пока имена разные — этого хватает,
 * но два «Дениса» подряд превращают подпись в бессмыслицу.
 */
describe('короткие имена', () => {
  it('обычно достаточно имени', () => {
    const names = shortNames([
      { id: '1', displayName: 'Денис Негодяев' },
      { id: '2', displayName: 'Вадим Петров' },
    ]);
    expect(names.get('1')).toBe('Денис');
    expect(names.get('2')).toBe('Вадим');
  });

  it('при совпадении имён добавляется первая буква фамилии', () => {
    const names = shortNames([
      { id: '1', displayName: 'Денис Негодяев' },
      { id: '2', displayName: 'Денис Кузнецов' },
      { id: '3', displayName: 'Вадим Петров' },
    ]);
    expect(names.get('1')).toBe('Денис Н.');
    expect(names.get('2')).toBe('Денис К.');
    // Уникальное имя не трогаем.
    expect(names.get('3')).toBe('Вадим');
  });

  it('если и буква совпала, берём больше букв', () => {
    const names = shortNames([
      { id: '1', displayName: 'Денис Негодяев' },
      { id: '2', displayName: 'Денис Некрасов' },
    ]);
    expect(names.get('1')).toBe('Денис Нег.');
    expect(names.get('2')).toBe('Денис Нек.');
  });

  it('совпадение имён без учёта регистра тоже считается', () => {
    const names = shortNames([
      { id: '1', displayName: 'денис Негодяев' },
      { id: '2', displayName: 'Денис Кузнецов' },
    ]);
    expect(names.get('1')).toBe('денис Н.');
    expect(names.get('2')).toBe('Денис К.');
  });

  it('без фамилии различать нечем — показываем как есть', () => {
    const names = shortNames([
      { id: '1', displayName: 'Денис' },
      { id: '2', displayName: 'Денис Кузнецов' },
    ]);
    expect(names.get('1')).toBe('Денис');
    expect(names.get('2')).toBe('Денис К.');
  });

  it('двойная фамилия не превращается в кашу', () => {
    const names = shortNames([
      { id: '1', displayName: 'Анна Иванова-Петрова' },
      { id: '2', displayName: 'Анна Сидорова' },
    ]);
    expect(names.get('1')).toBe('Анна И.');
    expect(names.get('2')).toBe('Анна С.');
  });
});
