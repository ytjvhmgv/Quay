export function compactDiff(filePath, before, after) {
  if (before === after) return "(没有变化)";
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const ctx = 3;
  const from = Math.max(0, start - ctx);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (let i = from; i < start; i += 1) lines.push(` ${a[i]}`);
  for (let i = start; i <= endA; i += 1) lines.push(`-${a[i]}`);
  for (let i = start; i <= endB; i += 1) lines.push(`+${b[i]}`);
  const tailFrom = endA + 1;
  const tailTo = Math.min(a.length, tailFrom + ctx);
  for (let i = tailFrom; i < tailTo; i += 1) lines.push(` ${a[i]}`);
  const text = lines.join("\n");
  return text.length > 4000 ? `${text.slice(0, 4000)}\n...` : text;
}
