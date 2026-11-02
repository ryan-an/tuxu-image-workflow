export function ProductPhotoHint({
  id,
  detailed = false,
}: {
  id: string;
  detailed?: boolean;
}) {
  if (detailed)
    return (
      <div id={id} className="product-photo-hint product-photo-hint-detailed">
        <strong>请勿把参考图 / 对标图上传到实拍区</strong>
        <p>
          这里的图片会被作为产品外观依据。误传对标图容易让模型沿用其产品、构图和背景，导致生成结果与原图高度相似。
        </p>
        <p>
          <b>上传建议：</b>建议上传本产品清晰背景简单、无遮挡的实拍照片
        </p>
        <p>
          参考图、对标图、宣传海报请放到各卡片的「参考图」。
          <b>没有产品实拍图就留空，请勿用参考图代替。</b>
        </p>
      </div>
    );
  return (
    <p id={id} className="product-photo-hint">
      实拍区禁止上传参考图／对标图，误传容易导致生成结果与原图高度相似，参考图请放各卡片内，没有产品实拍图可留空。
    </p>
  );
}
