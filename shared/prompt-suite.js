import { ROLES } from "./model.js";

export const FIXED_PRODUCT_REQUIREMENTS = `1. 必须严格使用我上传的实拍产品图片作为唯一产品参考来源。
2. 生成结果中的产品必须与上传的实拍图高度一致，不得擅自修改产品本身。
3. 最终图像必须让人明确识别为基于我上传实拍产品生成的真实场景图。
4.一切产品内容、外观、结构、颜色、花型、材质、尺寸关系、开合方式、细节表现，全部以我上传的产品图为唯一依据。
严格锁定参考图内产品的长宽比例、产品实际尺寸 大小以及画面内所有物体之间的相对尺寸关系，禁止放大、缩小、拉伸、变形产品，全程保留产品原始尺寸比例与画面物体大小对比关系，不做任何尺寸畸变修改。
图中的文字字数控制在5-10词以内，简单描述。
出现的产品不能带有LOGO
在上传的实拍图中选用合适的实拍图`;

export const LEGACY_DEFAULT_COMMON = `我会提供一套亚马逊对标图（10张），按顺序分别是尺寸图、卖点图、细节图、场景1、场景2、场景3、A+(1)、A+(2)、A+(3)、A+(4)，以及对应的产品信息（使用本产品顶部资料）。
一次识别整套对标图片的布局版面和图片定位，给出适合 nanobanana 生成图片的10条提示词。先统一整套设计，再逐张编写，不要逐张独立分析。

第一部份：图片的版面布局以及图片对应的文案。
根据各张对标图和本产品信息生成，适当调整配景、小图标及文字位置，不得和对标图相同。图上所有文案均为英文，改成贴合本产品的近义表达，不得照搬对标文案。尺寸图必须包含提供的产品尺寸和数量；A+(1)必须包含提供的品牌。品牌只出现在版面文案，不在产品本体增加LOGO。

第二部份：整套图的版面、横幅、边框颜色协调好看、有设计感，色调风格协调，不能跟对标布局一样。
推荐主色（背景/留白）、辅色（底板/边框）、强调色（标题/小标签）、正文/细线文字的具体色值。字体风格采用类似电商无衬线风；推荐免费可商用的标题、正文、标签字体及合适字号。10张使用同一套设计规范，A+横版适配字号和留白。

第三部份：（固定要求-不要变）
${FIXED_PRODUCT_REQUIREMENTS}

第四部份：尺寸图、卖点图、细节图、场景1、场景2、场景3为1610X1610像素，分辨率300；A+(1)、A+(2)、A+(3)、A+(4)为970X600像素，分辨率300。`;

export const DEFAULT_COMMON = `我会提供一套亚马逊图（10张），按顺序分别是尺寸图、卖点图、细节图、场景 1、场景 2、场景 3、A+(1)、A+(2)、A+(3)、A+(4)。
以及提供对应的产品信息：使用当前产品的名称和产品资料，包括数量、材质、颜色、内尺寸、外尺寸和品牌；未提供的信息不要编造。

识别对标图片的布局版面，以及图片的定位等，给出适合我的、用于 nanobanana 生成图片的提示词。
每张作图提示词结构包含4个部分，便于 nanobanana 生成图片。

第一部份：
图片的版面布局以及图片对应的文案（需要根据对应的对标图和我的产品信息来生成，图中所有出现的文字均为英文且不能和对标图的文案一样，需要近义表达，贴合我的产品）。
要求：尺寸图里面必须包含我提供的产品尺寸和数量；A+(1)里面必须包含我提供的品牌。

第二部份：
整套图整体的版面、横幅、边框颜色需要协调好看，且有设计感，色调风格协调，不能跟对标的版面布局一样，例如：
主色（背景/留白）：（推荐合适的色值）
辅色（底板/边框）：（推荐合适的色值）
强调色（标题/小标签）：（推荐合适的色值）
正文/细线文字：（推荐合适的色值）
字体风格（英文）（用“类似电商无衬线风”表达即可）：
标题字体：（推荐合适的大小，免费可商用字体）
正文字体：（推荐合适的大小，免费可商用字体）
标签字体：（推荐合适的大小，免费可商用字体）

第三部份：（固定要求-不要变）
${FIXED_PRODUCT_REQUIREMENTS}

第四部份：用来规定图片的尺寸
当生成尺寸图、卖点图、细节图、场景 1、场景 2、场景 3 图片的作图提示词的时候，第四部分内容是：图片尺寸是：1610X1610像素
分辨率300

当生成 A+(1)、A+(2)、A+(3)、A+(4) 图片的作图提示词的时候，第四部分内容是：图片尺寸是：970X600像素
分辨率300`;

export function migrateDefaultCommon(common) {
  return common?.replace(/\r\n/g, "\n").trim() === LEGACY_DEFAULT_COMMON
    ? DEFAULT_COMMON
    : common;
}

export function productPhotos(product) {
  return [
    ...new Set([product.photo, ...(product.photos || [])].filter(Boolean)),
  ];
}
export function productRequirements(product, common = DEFAULT_COMMON) {
  return product?.promptRequirements ?? common;
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
  // Only the bundled defaults have a known section format. Custom text may use
  // any headings or no headings; never guess its meaning from section numbers.
  const bundled = [DEFAULT_COMMON, LEGACY_DEFAULT_COMMON].includes(
    common.replace(/\r\n/g, "\n").trim(),
  );
  const size = bundled ? outputSpec(role, common) : null;
  const third = bundled ? requirementSection(common, 3) : modelThird || common;
  const fourth = size
    ? `图片尺寸是：${size.width}X${size.height}像素${size.dpi ? `\n分辨率${size.dpi}` : ""}`
    : modelFourth;
  return `第一部份：图片的版面布局以及图片对应的文案\n图片类型：${role}\n${layout}\n图中仅出现以下文案：\n${copy.map((line) => `“${line}”`).join("\n")}\n\n第二部份：整套统一设计规范\n${style}\n\n第三部份：产品要求\n${third}\n\n第四部份：图片尺寸\n${fourth}`;
}
export function suiteInstruction(product, common) {
  const roles = product.tasks.map((task) => task.role);
  return `以下全部是用户当前可编辑的提示词生成要求，请按当前版本执行，不套用其他默认规则：\n${common}\n\n产品名称：${product.name}\n产品编号：${product.code}\n产品信息：${product.facts || "资料暂缺；不要猜测规格。"}\n\n本次仅分析以下${roles.length}张卡片，严格按此顺序：${roles.join("、")}。共用要求中的整套数量仅作为设计背景，本次输出范围以上述卡片为准，不要输出其他位置。对标图是可选资料；部分或全部位置未提供对标图时，依据产品资料、实拍图、当前要求和图片类型自主设计，仍须输出所有指定卡片的完整提示词，不要求补图，不声称已识别未提供的对标图。
用户要求是自由文本，标题、编号和段落格式不限；必须通读全文，不得因缺少“第一部分”等标题而忽略要求。下面的JSON字段只是返回格式，与用户正文的标题无关。
仅返回一个JSON对象，不要Markdown：{"style":"依据全文中的视觉与风格要求制定整套统一设计规范", "images":[{"role":"尺寸图","layout":"依据全文要求生成此位置的布局，所有可见文案放copy里", "copy":["按用户当前规则生成的图上文案"],"thirdPart":"提取全文中的产品约束和必须遵守的要求；用户指定原样保留的文字必须原样保留", "fourthPart":"依据全文为此图片确定尺寸和分辨率；未指定的参数不要编造", "photoIndices":[0]}]}。
images必须恰好${roles.length}项，角色不重不漏；语言、字数、品牌、数量、配色、字体、尺寸及产品规则全部以用户当前要求为准。photoIndices从0开始，从标注的实拍图选择合适视角。`;
}
export function productSpecs(product) {
  const info = `${product.name} ${product.facts || ""}`;
  const brand = /(?:品牌|brand)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9 -]*)/i
    .exec(info)?.[1]
    ?.trim();
  const quantity = /(\d+)\s*个(?:装)?/.exec(info)?.[1];
  const measurements = [
    ...info.matchAll(/(\d+(?:\.\d+)?)\s*(cm|mm|in)(?=$|[^a-z]|x\s*\d)/gi),
  ].map((m) => ({ number: m[1], unit: m[2] }));
  for (const combined of info.matchAll(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(cm|mm|in)(?=$|[^a-z]|x\s*\d)/gi,
  ))
    if (!measurements.some((m) => m.number === combined[1]))
      measurements.unshift({ number: combined[1], unit: combined[3] });
  return { brand, quantity, measurements };
}
export class PromptValidationError extends Error {
  constructor(message, code, role = undefined) {
    super(message);
    this.name = "PromptValidationError";
    this.code = code;
    this.role = role;
  }
}
export function parseSuiteResponse(
  content,
  photoCount = 0,
  product,
  common = DEFAULT_COMMON,
  roles = product?.tasks?.map((task) => task.role) || ROLES,
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
    throw new PromptValidationError(
      "整套提示词返回格式不正确，请重试整套生成",
      "invalid_json",
    );
  }
  if (
    !value ||
    typeof value.style !== "string" ||
    !value.style.trim() ||
    !Array.isArray(value.images) ||
    value.images.length !== roles.length
  )
    throw new PromptValidationError(
      `提示词必须包含统一设计规范和完整${roles.length}张`,
      "incomplete_suite",
    );
  const seen = new Set();
  const prompts = value.images.map((item) => {
    if (!item || !roles.includes(item.role) || seen.has(item.role))
      throw new PromptValidationError(
        "提示词无法对应到图片位置，请重新生成",
        "invalid_card",
        roles.includes(item?.role) ? item.role : undefined,
      );
    seen.add(item.role);
    const indices = [...new Set(item.photoIndices || [])].filter(
      (i) => Number.isInteger(i) && i >= 0 && i < photoCount,
    );
    return {
      role: item.role,
      prompt: assemblePrompt(
        item.role,
        typeof item.layout === "string" ? item.layout : "",
        Array.isArray(item.copy)
          ? item.copy.filter((line) => typeof line === "string")
          : typeof item.copy === "string"
            ? [item.copy]
            : [],
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
    prompts: roles.map((role) => prompts.find((p) => p.role === role)),
  };
}
export function demoSuite(product, common = DEFAULT_COMMON) {
  const style = `主色（背景/留白）：#FFF8F3；辅色（底板/边框）：#EADFD8；强调色（标题/小标签）：#A72D3F；正文/细线文字：#27313C。
字体风格：类似电商无衬线风。标题：Inter Bold，方图80px / A+横图44px；正文：Inter Regular，方图42px / A+横图24px；标签：Inter Medium，方图32px / A+横图20px。Inter为免费商用字体（SIL OFL 1.1）。横幅使用同一强调色，边框细线、留白充足，各图布局变化且整体一致。
演示设计规范：未调用视觉模型，不代表已经识别对标图。`;
  const { brand, quantity, measurements: sizes } = productSpecs(product);
  const measurements = sizes.slice(0, 2).map((m) => `${m.number} ${m.unit}`);
  const images = product.tasks.map((task) => {
    const role = task.role,
      i = ROLES.indexOf(role);
    return {
      role,
      layout: `演示布局：${i < 6 ? "方形" : "横版"}画面采用${["右侧产品、左侧尺寸标注", "错位卖点卡片与产品主体", "局部特写和留白标题", "自然桌面使用场景", "简洁包装工作台", "日常收纳场景", "左侧品牌标题、右侧产品", "分栏产品介绍", "实拍细节组合", "整套应用场景横幅"][i]}。配景、图标和文字位置重新设计；产品仅依据实拍图。${task.references.length ? "需真实视觉模型分析对标后完善。" : "此位置尚未提供对标图。"}`,
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
    };
  });
  return parseSuiteResponse(
    JSON.stringify({ style, images }),
    productPhotos(product).length,
    undefined,
    common,
    product.tasks.map((task) => task.role),
  );
}
