import test from "node:test";
import assert from "node:assert/strict";
import { streamedPrompts } from "../../../shared/streamed-prompts.js";
test("partial JSON previews stay mapped to their own roles and tolerate broken escapes", () => {
  const sizePrompt =
    '  第一部分：尺寸 \\ "标注"\r\n文案：Five yards\n第二部分：统一风格\n第三部分：产品规则\n第四部分：1610X1610  ';
  const text = JSON.stringify({
    images: [
      {
        role: "尺寸图",
        prompt: sizePrompt,
      },
      { role: "卖点图", prompt: "柔软的缎面\nSoft satin" },
    ],
  });
  for (let i = 0; i <= text.length; i++)
    assert.doesNotThrow(() => streamedPrompts(text.slice(0, i)));
  const drafts = streamedPrompts(text);
  assert.equal(drafts["尺寸图"], sizePrompt);
  assert.equal(drafts["卖点图"], "柔软的缎面\nSoft satin");
  assert.deepEqual(streamedPrompts('{"images":['), {});
  assert.match(
    streamedPrompts('{"images":[{"role":"尺寸图","prompt":"逐字输出\\u')[
      "尺寸图"
    ],
    /逐字输出/,
  );
});

test("streaming previews use the same canonical roles as final validation for equivalent typography", () => {
  const text = JSON.stringify({
    images: [
      { role: "场景1", prompt: "场景专用布局" },
      { role: "A+(1)", prompt: "品牌专用布局" },
      { role: "Ａ＋（２）", prompt: "横版细节布局" },
      { role: "未知位置", prompt: "不能按顺序猜测归属" },
    ],
  });
  for (let index = 0; index <= text.length; index++)
    assert.doesNotThrow(() => streamedPrompts(text.slice(0, index)));

  const drafts = streamedPrompts(text);
  assert.deepEqual(Object.keys(drafts), ["场景 1", "A+ 1", "A+ 2"]);
  assert.match(drafts["场景 1"], /场景专用布局/);
  assert.match(drafts["A+ 1"], /品牌专用布局/);
  assert.match(drafts["A+ 2"], /横版细节布局/);
  assert.doesNotMatch(drafts["A+ 1"], /场景专用布局|不能按顺序猜测归属/);
});

test("preview preserves complete prompts with reversed keys, embedded JSON and braces at every stream boundary", () => {
  const prompt =
    '第一部分\n包含 {"role":"卖点图","prompt":"正文中的示例"} 和 ]、\\、"引号"。\n第二部分\n第三部分\n第四部分\n';
  const text = JSON.stringify({
    style: "不应拼入正文的旧字段",
    images: [{ prompt, role: "尺寸图", layout: "也不应拼入正文" }],
  });
  for (let i = 0; i <= text.length; i++) {
    const draft = streamedPrompts(text.slice(0, i))["尺寸图"];
    if (draft !== undefined) assert.ok(prompt.startsWith(draft));
  }
  assert.deepEqual(streamedPrompts(text), { 尺寸图: prompt });
});
