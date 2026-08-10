const CP1251: Record<string, number> = {
  Ё: 0xa8,
  ё: 0xb8,
  А: 0xc0,
  Б: 0xc1,
  В: 0xc2,
  Г: 0xc3,
  Д: 0xc4,
  Е: 0xc5,
  Ж: 0xc6,
  З: 0xc7,
  И: 0xc8,
  Й: 0xc9,
  К: 0xca,
  Л: 0xcb,
  М: 0xcc,
  Н: 0xcd,
  О: 0xce,
  П: 0xcf,
  Р: 0xd0,
  С: 0xd1,
  Т: 0xd2,
  У: 0xd3,
  Ф: 0xd4,
  Х: 0xd5,
  Ц: 0xd6,
  Ч: 0xd7,
  Ш: 0xd8,
  Щ: 0xd9,
  Ъ: 0xda,
  Ы: 0xdb,
  Ь: 0xdc,
  Э: 0xdd,
  Ю: 0xde,
  Я: 0xdf,
  а: 0xe0,
  б: 0xe1,
  в: 0xe2,
  г: 0xe3,
  д: 0xe4,
  е: 0xe5,
  ж: 0xe6,
  з: 0xe7,
  и: 0xe8,
  й: 0xe9,
  к: 0xea,
  л: 0xeb,
  м: 0xec,
  н: 0xed,
  о: 0xee,
  п: 0xef,
  р: 0xf0,
  с: 0xf1,
  т: 0xf2,
  у: 0xf3,
  ф: 0xf4,
  х: 0xf5,
  ц: 0xf6,
  ч: 0xf7,
  ш: 0xf8,
  щ: 0xf9,
  ъ: 0xfa,
  ы: 0xfb,
  ь: 0xfc,
  э: 0xfd,
  ю: 0xfe,
  я: 0xff,
};

export function encodeWindows1251Query(input: string): string {
  let out = "";
  for (const ch of input) {
    if (/[A-Za-z0-9\-_.!~*'()]/.test(ch)) {
      out += ch;
      continue;
    }
    if (ch === " ") {
      out += "+";
      continue;
    }
    const mapped = CP1251[ch];
    if (mapped !== undefined) {
      out += `%${mapped.toString(16).toUpperCase().padStart(2, "0")}`;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code <= 0xff) {
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
      continue;
    }
    out += encodeURIComponent(ch);
  }
  return out;
}

export function decodeWindows1251(buf: ArrayBuffer | Uint8Array): string {
  return new TextDecoder("windows-1251").decode(buf);
}
