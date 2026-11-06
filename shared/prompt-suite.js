import { ROLES } from "./model.js";
import { normalizePromptRole } from "./prompt-roles.js";

export const ANALYSIS_SYSTEM_PROMPT = `你是一名准确、可靠、善于理解用户需求的 AI 助手。

认真理解用户的目标，结合当前对话和提供的资料完成任务。

完整遵循用户明确提出的要求，保留重要条件和细节，
不要擅自省略、替换或把具体要求概括成模糊描述。

根据任务需要决定回答的详细程度。
用户要求完整方案、详细分析或可直接使用的成品时，
应充分展开并交付完整内容，不要只给概要或建议。

输出应排版规整、结构清晰、层次分明，语言自然易懂。

按内容含义分组，同一段落集中表达一类事项；较长内容合理分段，并列事项适当使用简短标签或分项。同类内容保持一致的组织方式，避免把多个主题堆在一个长段落中。

说明与可直接使用的文案、数据应清楚区分，需要查找和核对的内容集中呈现，避免散落、重复或遗漏。

以实际提供的资料为依据，保持事实、条件和前后表述一致，不声称使用未提供的素材。遇到无法同时满足的要求，应明确说明冲突，不编造信息，也不擅自改写用户要求保留的原文。

涉及数值、单位、尺寸和比例时，检查其准确性与一致性；建议参数应符合实际用途和输出规格。

优先遵循用户指定的语言、结构、格式和原文要求。`;

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
/** @returns {{ referenceImages: string[], referenceImageKind: "product-photo" | "reference", referenceImageContext?: string }} */
export function generationImages(product, task) {
  const photos = productPhotos(product);
  if (!photos.length) {
    const cards = product.tasks || [task];
    const referenceImages = [
      ...new Set(
        cards.flatMap((card) => card.references || []).filter(Boolean),
      ),
    ];
    const numbers = new Map(
      referenceImages.map((source, index) => [source, index + 1]),
    );
    const labels = (sources) =>
      [...new Set(sources || [])]
        .filter((source) => numbers.has(source))
        .map((source) => `图片 ${numbers.get(source)}`)
        .join("、");
    const current = labels(task.references);
    return {
      referenceImages,
      referenceImageKind: "reference",
      ...(referenceImages.length
        ? {
            referenceImageContext: `本次只生成「${task.role}」一张图片，不生成其他卡片或整套拼图。
附图按上传顺序从 1 编号，对应关系：
${cards
  .filter((card) => card.references?.length)
  .map((card) => `${card.role}：${labels(card.references)}`)
  .join("\n")}
${current ? `当前要做的对标图：${current}（${task.role}）。` : `当前卡片「${task.role}」未提供对标图，请依据以下提示词自主设计。`}
其他位置的对标图仅用于参考整套风格、配色和产品信息，不作为本张的目标版式。`,
          }
        : {}),
    };
  }
  return {
    referenceImages: photos,
    referenceImageKind: "product-photo",
  };
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
export function suiteInstruction(product, common) {
  const roles = product.tasks.map((task) => task.role);
  const photoCount = productPhotos(product).length;
  return `以下全部是用户当前可编辑的提示词生成要求，请按当前版本执行，不套用其他默认规则：\n${common}\n\n产品名称：${product.name}\n产品编号：${product.code}\n产品信息：${product.facts || "资料暂缺；不要猜测规格。"}\n\n本次仅分析以下${roles.length}张卡片，严格按此顺序：${roles.join("、")}。共用要求中的整套数量仅作为设计背景，本次输出范围以上述卡片为准，不要输出其他位置。对标图是可选资料；部分或全部位置未提供对标图时，依据产品资料、实拍图、当前要求和图片类型自主设计，仍须输出所有指定卡片的完整提示词，不要求补图，不声称已识别未提供的对标图。
产品实拍图也是可选资料。本次提供${photoCount}张产品实拍图。${photoCount ? "产品外观以标注的实拍图为依据，对标图仅用于参考设计。" : "本次没有产品实拍图，各卡片附图均为参考图／对标图，不能称为实拍图。依据产品资料、当前卡片参考图和当前要求设计，不照搬参考图，不声称已上传实拍图；模板中依赖实拍图的要求按实际未提供实拍图的情况处理，photoIndices必须返回空数组。"}
用户要求是自由文本，标题、编号和段落格式不限；必须通读全文，不得因缺少“第一部分”等标题而忽略要求。下面的JSON只用于将完整提示词对应到卡片，不用于拆分正文。
每项prompt由你直接写成该位置完整、可复制用于生图的最终提示词，标题、顺序、段落、文案及各部分内容全部按用户全文要求组织。用户要求四部分时，由你在每张prompt内完整写出四部分，包括用户要求每张重复的整套设计规范、固定原文及尺寸，不写“同上”或让程序补齐。用户指定原样保留的文字必须原样保留，指定某部分末尾的句子由你安排在该部分末尾。不要把正文拆到style、layout、copy、thirdPart、fourthPart等其他字段；程序会原样展示、保存和用于生图，不再添加标题、重排或拼接各部分。
除用户明确要求简写外，应依据用户全文要求、对应参考图及实际产品资料充分展开具体、可执行的作图说明，保留适用于本图的条件和细节，不要让生图模型自行补齐用户已要求明确的内容。用户对图上文字规定的词数只约束可见文案，不是完整作图说明的长度限制；用户对整体提示词的长度或格式另有要求时仍按用户要求执行，不为凑长度编造信息。
仅返回一个JSON对象，不要在JSON外添加Markdown或说明：{"images":[{"role":${JSON.stringify(roles[0] || ROLES[0])},"prompt":"由你按用户全文要求组织好的本张完整提示词正文，所有要求的部分均在此字符串内完整展开", "photoIndices":${JSON.stringify(Array.from({ length: photoCount }, (_, index) => index))}}]}。
images必须恰好${roles.length}项，角色不重不漏；每项role必须逐字使用上述卡片名称（包括空格），不要改写或新增位置名称。语言、字数、品牌、数量、配色、字体、尺寸及产品规则全部以用户当前要求为准。photoIndices从0开始，列出本次全部实拍图编号；每次生图始终附带全部产品实拍图，不按视角筛选或删减。`;
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
    !Array.isArray(value.images) ||
    value.images.length !== roles.length
  )
    throw new PromptValidationError(
      `提示词必须包含完整${roles.length}张`,
      "incomplete_suite",
    );
  const seen = new Set();
  const prompts = value.images.map((item) => {
    const role = normalizePromptRole(item?.role);
    if (!role || !roles.includes(role))
      throw new PromptValidationError(
        "提示词无法对应到图片位置：返回了无法识别或本次未要求的位置，请重新生成",
        "invalid_card",
      );
    if (seen.has(role))
      throw new PromptValidationError(
        `提示词无法对应到图片位置：「${role}」重复，请重新生成`,
        "invalid_card",
        role,
      );
    seen.add(role);
    if (typeof item.prompt !== "string" || !item.prompt.trim())
      throw new PromptValidationError(
        `「${role}」未返回完整提示词正文，请重新生成`,
        "empty_prompt",
        role,
      );
    const indices = [...new Set(item.photoIndices || [])].filter(
      (i) => Number.isInteger(i) && i >= 0 && i < photoCount,
    );
    return {
      role,
      prompt: item.prompt,
      photoIndices: indices.length ? indices : photoCount ? [0] : [],
    };
  });
  return {
    prompts: roles.map((role) => prompts.find((p) => p.role === role)),
  };
}
export function demoSuite(product, common = DEFAULT_COMMON) {
  const photoCount = productPhotos(product).length;
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
      prompt: `第一部份：演示布局
${i < 6 ? "方形" : "横版"}画面采用${["右侧产品、左侧尺寸标注", "错位卖点卡片与产品主体", "局部特写和留白标题", "自然桌面使用场景", "简洁包装工作台", "日常收纳场景", "左侧品牌标题、右侧产品", "分栏产品介绍", "实拍细节组合", "整套应用场景横幅"][i]}。配景、图标和文字位置重新设计；${photoCount ? "产品仅依据实拍图。" : "未提供实拍图，结合产品资料设计。"}${task.references.length ? "需真实视觉模型分析对标后完善。" : "此位置尚未提供对标图。"}
图上文案：${
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
              ][i]
      }

第二部份：演示统一设计
${style}

第三部份：演示产品要求
${photoCount ? "依据实拍图保持产品外观，结合产品资料设计。" : "未提供实拍图，依据产品资料和当前卡片参考图设计，不照搬参考图。"}

第四部份：演示图片尺寸
${i < 6 ? "1610X1610" : "970X600"}像素，分辨率300。`,
      photoIndices: photoCount ? [0] : [],
    };
  });
  return parseSuiteResponse(
    JSON.stringify({ images }),
    photoCount,
    undefined,
    common,
    product.tasks.map((task) => task.role),
  );
}
