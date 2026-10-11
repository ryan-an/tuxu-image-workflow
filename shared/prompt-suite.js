import { ROLES } from "./model.js";

export const FIXED_PRODUCT_REQUIREMENTS = `1. 必须严格使用我上传的实拍产品图片作为唯一产品参考来源。
2. 生成结果中的产品必须与上传的实拍图高度一致，不得擅自修改产品本身。
3. 最终图像必须让人明确识别为基于我上传实拍产品生成的真实场景图。
4.一切产品内容、外观、结构、颜色、花型、材质、尺寸关系、开合方式、细节表现，全部以我上传的产品图为唯一依据。
严格锁定参考图内产品的长宽比例、产品实际尺寸 大小以及画面内所有物体之间的相对尺寸关系，禁止放大、缩小、拉伸、变形产品，全程保留产品原始尺寸比例与画面物体大小对比关系，不做任何尺寸畸变修改。
图中的文字字数控制在5-10词以内，简单描述。
出现的产品不能带有LOGO
在上传的实拍图中选用合适的实拍图`;

export const DEFAULT_COMMON = `我会提供一套亚马逊对标图（10张），按顺序分别是尺寸图、卖点图、细节图、场景1、场景2、场景3、A+(1)、A+(2)、A+(3)、A+(4)，以及对应的产品信息（使用本产品顶部资料）。
一次识别整套对标图片的布局版面和图片定位，给出适合 nanobanana 生成图片的10条提示词。先统一整套设计，再逐张编写，不要逐张独立分析。

第一部份：图片的版面布局以及图片对应的文案。
根据各张对标图和本产品信息生成，适当调整配景、小图标及文字位置，不得和对标图相同。图上所有文案均为英文，改成贴合本产品的近义表达，不得照搬对标文案。尺寸图必须包含提供的产品尺寸和数量；A+(1)必须包含提供的品牌。品牌只出现在版面文案，不在产品本体增加LOGO。

第二部份：整套图的版面、横幅、边框颜色协调好看、有设计感，色调风格协调，不能跟对标布局一样。
推荐主色（背景/留白）、辅色（底板/边框）、强调色（标题/小标签）、正文/细线文字的具体色值。字体风格采用类似电商无衬线风；推荐免费可商用的标题、正文、标签字体及合适字号。10张使用同一套设计规范，A+横版适配字号和留白。

第三部份：（固定要求-不要变）
${FIXED_PRODUCT_REQUIREMENTS}

第四部份：尺寸图、卖点图、细节图、场景1、场景2、场景3为1610X1610像素，分辨率300；A+(1)、A+(2)、A+(3)、A+(4)为970X600像素，分辨率300。`;

export function productPhotos(product) {
  return [
    ...new Set([product.photo, ...(product.photos || [])].filter(Boolean)),
  ];
}
export function requirementSection(common, number) {
  const names = ["", "一", "二", "三", "四"];
  const heading = new RegExp(`^第${names[number]}[部份分]+[^\\n]*`, "m").exec(
    common || "",
  );
  if (!heading) return "";
  const tail = common.slice(heading.index);
  const next = /\n第[一二三四][部份分]+/.exec(tail.slice(heading[0].length));
  const body = next ? tail.slice(0, heading[0].length + next.index) : tail;
  if (number === 3) return body.slice(heading[0].length).trim();
  return body;
}
export function outputSpec(role, common = DEFAULT_COMMON) {
  const rule = requirementSection(common, 4);
  const pairs = [...rule.matchAll(/(\d+)\s*[Xx×]\s*(\d+)/g)];
  const pair = pairs[role.startsWith("A+") ? 1 : 0] || pairs[0];
  if (!pair) return null;
  return {
    width: Number(pair[1]),
    height: Number(pair[2]),
    dpi: /分辨率\s*(\d+)/.exec(rule)?.[1] || "",
  };
}
export function assemblePrompt(
  role,
  layout,
  copy,
  style,
  common = DEFAULT_COMMON,
  modelThird = "",
  modelFourth = "",
) {
  const size = outputSpec(role, common);
  const third = requirementSection(common, 3) || modelThird;
  const fourth = size
    ? `图片尺寸是：${size.width}X${size.height}像素${size.dpi ? `\n分辨率${size.dpi}` : ""}`
    : modelFourth;
  return `第一部份：图片的版面布局以及图片对应的文案\n图片类型：${role}\n${layout}\n图中仅出现以下文案：\n${copy.map((line) => `“${line}”`).join("\n")}\n\n第二部份：整套统一设计规范\n${style}\n\n第三部份：产品要求\n${third}\n\n第四部份：图片尺寸\n${fourth}`;
}
export function suiteInstruction(product, common) {
  return `以下全部是用户当前可编辑的提示词生成要求，请按当前版本执行，不套用其他默认规则：\n${common}\n\n产品名称：${product.name}\n产品编号：${product.code}\n产品信息：${product.facts || "资料暂缺；不要猜测规格。"}\n\n一次输出完整10张，严格按此顺序：${ROLES.join("、")}。未提供对标图的位置说明缺少参考，不声称已识别。
仅返回一个JSON对象，不要Markdown：{"style":"按用户当前第二部分要求确定的整套统一设计规范", "images":[{"role":"尺寸图","layout":"按当前第一部分要求生成此位置的布局，所有可见文案放copy里", "copy":["按用户当前规则生成的图上文案"],"thirdPart":"原样保留用户当前第三部分正文", "fourthPart":"按用户当前第四部分为此图片确定的尺寸和分辨率要求", "photoIndices":[0]}]}。
images必须恰好10项，角色不重不漏；语言、字数、品牌、数量、配色、字体、尺寸及产品规则全部以用户当前要求为准。photoIndices从0开始，从标注的实拍图选择合适视角。第三部分不得自行改写用户当前文字。`;
}
export function productSpecs(product) {
  const info = `${product.name} ${product.facts || ""}`;
  const brand = /(?:品牌|brand)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9 -]*)/i
    .exec(info)?.[1]
    ?.trim();
  const quantity = /(\d+)\s*个(?:装)?/.exec(info)?.[1];
  let measurements = [...info.matchAll(/(\d+(?:\.\d+)?)\s*(cm|mm|in)\b/gi)].map(
    (m) => ({ number: m[1], unit: m[2] }),
  );
  const combined =
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|mm|in)\b/i.exec(info);
  if (combined)
    measurements = [
      { number: combined[1], unit: combined[3] },
      { number: combined[2], unit: combined[3] },
    ];
  return { brand, quantity, measurements };
}
export function parseSuiteResponse(
  content,
  photoCount = 0,
  product,
  common = DEFAULT_COMMON,
) {
  let value;
  try {
    value = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error("整套提示词返回格式不正确，请重试整套生成");
  }
  if (
    typeof value.style !== "string" ||
    !value.style.trim() ||
    !Array.isArray(value.images) ||
    value.images.length !== 10
  )
    throw new Error("整套提示词必须包含统一设计规范和完整10张");
  const seen = new Set();
  const specs = product && productSpecs(product);
  const english = /(?:文案|文字)[^\n。]*英文/.test(common);
  const limits = /(\d+)\s*[-–~至]\s*(\d+)\s*词/.exec(common);
  const needsDimensions = /尺寸图[^\n；]*必须[^\n；]*(?:尺寸|数量)/.test(
    common,
  );
  const needsBrand = /A\+[^\n；]*必须[^\n；]*品牌/.test(common);
  const prompts = value.images.map((item) => {
    if (
      !ROLES.includes(item.role) ||
      seen.has(item.role) ||
      typeof item.layout !== "string" ||
      !item.layout.trim() ||
      !Array.isArray(item.copy) ||
      !item.copy.length ||
      item.copy.some(
        (s) =>
          typeof s !== "string" ||
          !s.trim() ||
          (english && /[^\x00-\x7F×°–—’“”]/.test(s)),
      )
    )
      throw new Error("整套提示词角色、布局或英文文案不完整，请重试");
    seen.add(item.role);
    const words =
      item.copy.join(" ").match(/[A-Za-z0-9]+(?:[-'.][A-Za-z0-9]+)*/g) || [];
    if (
      english &&
      limits &&
      (words.length < Number(limits[1]) || words.length > Number(limits[2]))
    )
      throw new Error(
        `${item.role}文案不符合当前${limits[1]}–${limits[2]}词要求，请重试整套生成`,
      );
    const indices = [...new Set(item.photoIndices || [])].filter(
      (i) => Number.isInteger(i) && i >= 0 && i < photoCount,
    );
    const visible = item.copy.join(" ");
    if (
      specs &&
      needsDimensions &&
      item.role === "尺寸图" &&
      [specs.quantity, ...specs.measurements.map((m) => m.number)]
        .filter(Boolean)
        .some((number) => !words.includes(number))
    )
      throw new Error("尺寸图文案遗漏产品尺寸或数量，请重试整套生成");
    if (
      specs?.brand &&
      needsBrand &&
      item.role === "A+ 1" &&
      !visible.toLowerCase().includes(specs.brand.toLowerCase())
    )
      throw new Error("A+1文案遗漏品牌，请重试整套生成");
    return {
      role: item.role,
      prompt: assemblePrompt(
        item.role,
        item.layout,
        item.copy,
        value.style,
        common,
        item.thirdPart || "",
        item.fourthPart || "",
      ),
      photoIndices: indices.length ? indices : photoCount ? [0] : [],
    };
  });
  return {
    style: value.style,
    prompts: ROLES.map((role) => prompts.find((p) => p.role === role)),
  };
}
export function demoSuite(product, common = DEFAULT_COMMON) {
  const style = `主色（背景/留白）：#FFF8F3；辅色（底板/边框）：#EADFD8；强调色（标题/小标签）：#A72D3F；正文/细线文字：#27313C。
字体风格：类似电商无衬线风。标题：Inter Bold，方图80px / A+横图44px；正文：Inter Regular，方图42px / A+横图24px；标签：Inter Medium，方图32px / A+横图20px。Inter为免费商用字体（SIL OFL 1.1）。横幅使用同一强调色，边框细线、留白充足，各图布局变化且整体一致。
演示设计规范：未调用视觉模型，不代表已经识别对标图。`;
  const { brand, quantity, measurements: sizes } = productSpecs(product);
  const measurements = sizes.slice(0, 2).map((m) => `${m.number} ${m.unit}`);
  const images = ROLES.map((role, i) => ({
    role,
    layout: `演示布局：${i < 6 ? "方形" : "横版"}画面采用${["右侧产品、左侧尺寸标注", "错位卖点卡片与产品主体", "局部特写和留白标题", "自然桌面使用场景", "简洁包装工作台", "日常收纳场景", "左侧品牌标题、右侧产品", "分栏产品介绍", "实拍细节组合", "整套应用场景横幅"][i]}。配景、图标和文字位置重新设计；产品仅依据实拍图。${product.tasks[i].references.length ? "需真实视觉模型分析对标后完善。" : "此位置尚未提供对标图。"}`,
    copy: [
      i === 0 && quantity && measurements.length === 2
        ? `${quantity} Pack ${measurements.join(" x ")} Outer Size`
        : i === 6 && brand
          ? `${brand} Made For Your Everyday Packing`
          : [
              "Simple Dimensions For Your Everyday Needs",
              "Thoughtful Design For Daily Packing Needs",
              "See The Details Of Your Product",
              "Ready For Your Everyday Packing Routine",
              "Keep Your Packing Space Neatly Organized",
              "Bring Simple Organization To Daily Tasks",
              "Made For Your Everyday Packing Needs",
              "Explore The Design Of Your Product",
              "A Closer Look At Product Details",
              "Designed To Fit Your Daily Routine",
            ][i],
    ],
    photoIndices: productPhotos(product).length ? [0] : [],
  }));
  return parseSuiteResponse(
    JSON.stringify({ style, images }),
    productPhotos(product).length,
    undefined,
    common,
  );
}
