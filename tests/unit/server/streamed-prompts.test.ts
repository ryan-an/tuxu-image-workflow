import test from "node:test";
import assert from "node:assert/strict";
import { streamedPrompts } from "../../../shared/streamed-prompts.js";
test("partial JSON previews stay mapped to their own roles and tolerate broken escapes", () => {
  const text = JSON.stringify({
    style: "统一风格",
    images: [
      {
        role: "尺寸图",
        layout: '尺寸 \\ \"标注\"',
        copy: ["Five yards"],
        thirdPart: "产品规则",
        fourthPart: "1610X1610",
      },
      { role: "卖点图", layout: "柔软的缎面", copy: ["Soft satin"] },
    ],
  });
  for (let i = 0; i <= text.length; i++)
    assert.doesNotThrow(() => streamedPrompts(text.slice(0, i)));
  const drafts = streamedPrompts(text);
  assert.match(drafts["尺寸图"], /Five yards/);
  assert.doesNotMatch(drafts["尺寸图"], /Soft satin/);
  assert.match(drafts["卖点图"], /Soft satin/);
  assert.deepEqual(streamedPrompts('{"style":"等待中的风格'), {});
  assert.match(
    streamedPrompts('{"images":[{"role":"尺寸图","layout":"逐字输出\\u')[
      "尺寸图"
    ],
    /逐字输出/,
  );
});

test("streaming previews use the same canonical roles as final validation for equivalent typography", () => {
  const text = JSON.stringify({
    style: "统一风格",
    images: [
      { role: "场景1", layout: "场景专用布局" },
      { role: "A+(1)", layout: "品牌专用布局" },
      { role: "Ａ＋（２）", layout: "横版细节布局" },
      { role: "未知位置", layout: "不能按顺序猜测归属" },
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
