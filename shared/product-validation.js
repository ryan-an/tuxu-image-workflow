export function productCodeIssue(code) {
  if (typeof code !== "string")
    return { reason: "invalid_code", message: "产品编号必须是文字" };
  if (!code.trim())
    return { reason: "empty_code", message: "产品编号不能为空" };
  return null;
}

/** @returns {{reason: string, message: string}[]} */
export function productMetadataIssues(product) {
  const codeIssue = productCodeIssue(product.code);
  const issues = codeIssue ? [codeIssue] : [];
  const invalid = (reason, message) => issues.push({ reason, message });
  if (typeof product.name !== "string")
    invalid("invalid_name", "产品名称必须是文字");
  else if (!product.name.trim()) invalid("empty_name", "产品名称不能为空");
  if (typeof product.facts !== "string")
    invalid("invalid_facts", "产品资料必须是文字，可以留空");
  if (product.promptRequirements != null) {
    if (typeof product.promptRequirements !== "string")
      invalid("invalid_requirements", "本产品生成要求必须是文字");
    else if (!product.promptRequirements.trim())
      invalid(
        "empty_requirements",
        "本产品生成要求不能为空，请填写内容或恢复共用要求",
      );
    else if (product.promptRequirements.length > 100000)
      invalid("requirements_too_long", "本产品生成要求不能超过 100000 字");
  }
  return issues;
}
