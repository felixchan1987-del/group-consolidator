/**
 * Accounting systems (Xero in particular) export report totals as formulas without a stored result, so a spreadsheet
 * reader sees 0. This evaluates the simple arithmetic those exports use — SUM(ranges, cells), + - * /, brackets,
 * numbers and same-sheet cell references — and writes the result back into the cell.
 * Anything else (other sheets, functions other than SUM) keeps the value saved in the file.
 */
import type { CellObject, WorkSheet } from 'xlsx';

const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

type Tok = { t: 'num'; v: number } | { t: 'ref'; c: number; r: number } | { t: 'op'; v: string } | { t: 'fn'; v: string };

function tokenize(f: string): Tok[] | null {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|\$?([A-Z]{1,3})\$?(\d+)|([A-Z][A-Z0-9.]*)\s*\(|([-+*/(),:]))/y;
  let i = 0;
  const s = f.replace(/^=/, '').trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: +m[1] });
    else if (m[2] !== undefined) out.push({ t: 'ref', c: colNum(m[2]), r: +m[3] });
    else if (m[4] !== undefined) {
      out.push({ t: 'fn', v: m[4].toUpperCase() });
      out.push({ t: 'op', v: '(' });
    } else out.push({ t: 'op', v: m[5] });
    while (i < s.length && s[i] === ' ') i++;
  }
  return out;
}

export function evaluateFormulas(ws: WorkSheet): number {
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();
  let updated = 0;

  const cellValue = (addr: string): number | null => {
    const cell = ws[addr] as CellObject | undefined;
    if (!cell) return 0;
    if (cell.f) return evalCell(addr);
    if (cell.t === 'n') return cell.v as number;
    if (cell.t === 'z' || cell.v === '' || cell.v === undefined) return 0;
    return null; // text in arithmetic: not something we can evaluate safely
  };

  function evalCell(addr: string): number | null {
    if (memo.has(addr)) return memo.get(addr)!;
    if (visiting.has(addr)) return null;
    visiting.add(addr);
    const cell = ws[addr] as CellObject;
    const toks = tokenize(String(cell.f));
    let res: number | null = null;
    if (toks) {
      try {
        res = parse(toks);
      } catch {
        res = null;
      }
    }
    visiting.delete(addr);
    memo.set(addr, res);
    return res;
  }

  function parse(toks: Tok[]): number | null {
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
    const expect = (v: string) => {
      if (!isOp(v)) throw new Error('syntax');
      p++;
    };
    const expr = (): number | null => {
      let a = term();
      while (isOp('+') || isOp('-')) {
        const op = (toks[p++] as { v: string }).v;
        const b = term();
        a = a === null || b === null ? null : op === '+' ? a + b : a - b;
      }
      return a;
    };
    const term = (): number | null => {
      let a = unary();
      while (isOp('*') || isOp('/')) {
        const op = (toks[p++] as { v: string }).v;
        const b = unary();
        a = a === null || b === null ? null : op === '*' ? a * b : b === 0 ? null : a / b;
      }
      return a;
    };
    const unary = (): number | null => {
      if (isOp('-')) {
        p++;
        const v = unary();
        return v === null ? null : -v;
      }
      if (isOp('+')) {
        p++;
        return unary();
      }
      return atom();
    };
    const range = (a: { c: number; r: number }, b: { c: number; r: number }): number | null => {
      let s = 0;
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
          const cell = ws[`${colName(c)}${r}`] as CellObject | undefined;
          if (!cell) continue;
          if (cell.f) {
            const v = evalCell(`${colName(c)}${r}`);
            if (v === null) return null;
            s += v;
          } else if (cell.t === 'n') s += cell.v as number; // SUM ignores text and blanks
        }
      return s;
    };
    const atom = (): number | null => {
      const t = toks[p++];
      if (!t) throw new Error('syntax');
      if (t.t === 'num') return t.v;
      if (t.t === 'ref') return cellValue(`${colName(t.c)}${t.r}`);
      if (t.t === 'op' && t.v === '(') {
        const v = expr();
        expect(')');
        return v;
      }
      if (t.t === 'fn') {
        if (t.v !== 'SUM') throw new Error('unsupported');
        expect('(');
        let s: number | null = 0;
        if (!isOp(')'))
          for (;;) {
            let v: number | null;
            const a = peek(),
              b = toks[p + 1],
              c = toks[p + 2];
            if (a?.t === 'ref' && b?.t === 'op' && b.v === ':' && c?.t === 'ref') {
              p += 3;
              v = range(a, c);
            } else v = expr();
            s = s === null || v === null ? null : s + v;
            if (isOp(',')) {
              p++;
              continue;
            }
            break;
          }
        expect(')');
        return s;
      }
      throw new Error('syntax');
    };
    const v = expr();
    if (p !== toks.length) throw new Error('syntax');
    return v;
  }

  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const cell = ws[addr] as CellObject;
    if (!cell.f) continue;
    const v = evalCell(addr);
    if (v === null || !Number.isFinite(v)) continue;
    const rounded = Math.round(v * 1e6) / 1e6;
    if (cell.t !== 'n' || cell.v !== rounded) updated++;
    cell.t = 'n';
    cell.v = rounded;
    delete cell.w;
  }
  return updated;
}
