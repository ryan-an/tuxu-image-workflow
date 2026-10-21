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
