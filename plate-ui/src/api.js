export async function simulate(payload) {
  const res = await fetch("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应，按通用错误处理
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `服务返回 ${res.status}`);
  }
  return data;
}

export async function calibrate(payload) {
  const res = await fetch("/api/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应，按通用错误处理
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `服务返回 ${res.status}`);
  }
  return data;
}
