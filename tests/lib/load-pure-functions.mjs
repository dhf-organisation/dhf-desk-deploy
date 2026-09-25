// Extracts named top-level `function name(...){...}` declarations straight
// out of app-main.js and evaluates just those, so the tests exercise the
// real production source (no copy that can drift) without loading the rest
// of the file — most of it assumes a browser (document, window, a live
// Supabase client) and isn't safe to run under `node --test`.
//
// Brace matching is naive (it doesn't understand string/regex literals), so
// this only works for functions whose body contains no unbalanced/quoted
// '{' or '}'. That's true of every function this is used for today — if a
// future one needs it and fails, extract that function's exact body by hand
// instead of extending this matcher.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MAIN_PATH = path.join(__dirname, '..', '..', 'app-main.js');

function extractFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`load-pure-functions: "function ${name}(" not found in app-main.js — was it renamed?`);
  }
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) {
    throw new Error(`load-pure-functions: could not find a balanced closing brace for function ${name}`);
  }
  return source.slice(start, end);
}

export function loadPureFunctions(names) {
  const source = fs.readFileSync(APP_MAIN_PATH, 'utf8');
  const extracted = names.map((name) => extractFunctionSource(source, name)).join('\n\n');
  const factory = new Function(`${extracted}\nreturn { ${names.join(', ')} };`);
  return factory();
}
