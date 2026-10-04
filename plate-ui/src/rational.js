// 有理数（"3/4"、"-5" 形式字符串）的解析与展示工具。

export function parseRational(s) {
  if (typeof s !== "string") return Number(s);
  const i = s.indexOf("/");
  if (i === -1) return Number(s);
  return Number(s.slice(0, i)) / Number(s.slice(i + 1));
}

export function formatRational(s, digits = 3) {
  const v = parseRational(s);
  if (!Number.isFinite(v)) return String(s);
  if (Number.isInteger(v)) return String(v);
  let str = v.toFixed(digits);
  if (str.includes(".")) str = str.replace(/0+$/, "").replace(/\.$/, "");
  if (str === "-0") str = "0";
  return str;
}

// 无向边键： "r1,c1|r2,c2"，端点按字典序排列。
export function edgeKey(r1, c1, r2, c2) {
  const a = `${r1},${c1}`;
  const b = `${r2},${c2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function edgeFromKey(key) {
  const [a, b] = key.split("|");
  const [r1, c1] = a.split(",").map(Number);
  const [r2, c2] = b.split(",").map(Number);
  return { r1, c1, r2, c2 };
}

export function cellKey(r, c) {
  return `${r},${c}`;
}

// 精确有理数：{ num: bigint, den: bigint }（den 恒为正），
// 供逆向校准逐格差值使用，避免前端浮点误差冒充精确结论。
function bigPair(s) {
  const i = String(s).indexOf("/");
  if (i === -1) return [BigInt(s), 1n];
  return [BigInt(s.slice(0, i)), BigInt(s.slice(i + 1))];
}

export function subRational(a, b) {
  const [an, ad] = bigPair(a);
  const [bn, bd] = bigPair(b);
  const num = an * bd - bn * ad;
  const den = ad * bd;
  return `${num}/${den}`;
}

// 解析用户输入的有理数目标：整数、p/q 或十进制小数；空/非法返回 null。
export function parseTargetInput(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  if (/^[+-]?\d+$/.test(t)) return t;
  let m;
  if ((m = t.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/))) {
    if (BigInt(m[2]) === 0n) return null;
    return `${BigInt(m[1])}/${BigInt(m[2])}`;
  }
  if (/^[+-]?(\d+\.\d+|\.\d+)$/.test(t)) {
    const neg = t.startsWith("-");
    const body = neg ? t.slice(1) : t;
    const [intPart, fracPart] = body.split(".");
    const den = 10n ** BigInt(fracPart.length);
    const num = BigInt(intPart || "0") * den + BigInt(fracPart);
    return `${neg ? -num : num}/${den}`;
  }
  return null;
}
