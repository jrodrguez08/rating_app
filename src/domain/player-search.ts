export function normalizePlayerSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function playerSearchPrefixes(value: string): string[] {
  const normalized = normalizePlayerSearch(value).slice(0, 80);
  const prefixes = new Set<string>();
  for (const term of [normalized, ...normalized.split(" ")]) {
    for (let length = 1; length <= term.length; length += 1) {
      prefixes.add(term.slice(0, length));
    }
  }
  return [...prefixes].slice(0, 160);
}
