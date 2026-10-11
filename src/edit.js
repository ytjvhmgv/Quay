export function applyEdit(content, oldStr, newStr) {
  if (typeof oldStr !== "string" || oldStr.length === 0) {
    throw new Error("old_string 不能为空");
  }
  if (typeof newStr !== "string") {
    throw new Error("new_string 必须是字符串");
  }
  if (oldStr === newStr) throw new Error("old_string 和 new_string 一样，没有需要改的内容");
  const first = content.indexOf(oldStr);
  if (first < 0) {
    throw new Error("没有找到 old_string。请先 read_file，并原样复制要替换的片段。");
  }
  const second = content.indexOf(oldStr, first + oldStr.length);
  if (second >= 0) {
    throw new Error("old_string 匹配到多处。请带上更多前后文，让它只命中一处。");
  }
  return content.slice(0, first) + newStr + content.slice(first + oldStr.length);
}
