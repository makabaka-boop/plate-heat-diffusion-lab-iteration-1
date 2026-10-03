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
