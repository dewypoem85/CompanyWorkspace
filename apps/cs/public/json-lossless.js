export function prettyPrintJsonLossless(value) {
  const source = String(value ?? '');
  JSON.parse(source);
  let output = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const indent = () => '  '.repeat(depth);
  const nextNonWhitespace = (start) => {
    for (let index = start; index < source.length; index += 1) {
      if (!/\s/.test(source[index])) return source[index];
    }
    return '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (/\s/.test(character)) continue;
    if (character === '{' || character === '[') {
      output += character;
      depth += 1;
      const closing = character === '{' ? '}' : ']';
      if (nextNonWhitespace(index + 1) !== closing) output += `\n${indent()}`;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      const opening = character === '}' ? '{' : '[';
      if (output.at(-1) !== opening) output += `\n${indent()}`;
      output += character;
    } else if (character === ',') {
      output += `,\n${indent()}`;
    } else if (character === ':') {
      output += ': ';
    } else {
      output += character;
    }
  }
  return output;
}

export function isValidJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
