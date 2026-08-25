/**
 * Короткие подписи для полосы людей.
 *
 * В плотном ряду аватаров фамилия не нужна: коллегу узнают по имени.
 * Но если имена совпадают, одно имя перестаёт быть именем — тогда
 * добавляем первую букву фамилии, а при необходимости и больше.
 *
 * Считается сразу по всему списку: понять, что имя не уникально,
 * глядя на одного человека, невозможно.
 */
export function shortNames(people: { id: string; displayName: string }[]): Map<string, string> {
  const result = new Map<string, string>();
  const byFirstName = new Map<string, typeof people>();

  for (const person of people) {
    const first = firstWord(person.displayName);
    const group = byFirstName.get(first.toLowerCase()) ?? [];
    group.push(person);
    byFirstName.set(first.toLowerCase(), group);
  }

  for (const group of byFirstName.values()) {
    if (group.length === 1) {
      const person = group[0];
      if (person) result.set(person.id, firstWord(person.displayName) || person.displayName);
      continue;
    }

    // Имя не одно — различаем фамилией. Обычно хватает одной буквы,
    // но если и она совпала, берём столько, сколько нужно.
    const letters = neededLetters(group.map((person) => restWords(person.displayName)));

    for (const person of group) {
      // Написание имени берём у самого человека: «денис» и «Денис» —
      // одно имя для сравнения, но подпись у каждого своя.
      const first = firstWord(person.displayName);
      const rest = restWords(person.displayName);
      if (!rest) {
        // Фамилии нет — различить нечем, оставляем как есть.
        result.set(person.id, person.displayName);
        continue;
      }
      const suffix = rest.slice(0, letters);
      result.set(person.id, `${first} ${suffix}${suffix.length < rest.length ? '.' : ''}`);
    }
  }

  return result;
}

/** Сколько букв фамилии нужно, чтобы все различались. Больше четырёх не берём. */
function neededLetters(surnames: string[]): number {
  const present = surnames.filter(Boolean);
  for (let letters = 1; letters <= 4; letters += 1) {
    const prefixes = present.map((surname) => surname.slice(0, letters).toLowerCase());
    if (new Set(prefixes).size === prefixes.length) return letters;
  }
  return 4;
}

function firstWord(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

function restWords(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}
