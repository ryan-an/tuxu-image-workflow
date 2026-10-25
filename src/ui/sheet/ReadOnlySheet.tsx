import { productPage } from "../../view-models/product-page.js";
import { useApplication } from "../context";
import { PreviewImage } from "../PreviewImage";
export function ReadOnlySheet() {
  const { state, ui } = useApplication();
  const { products } = productPage(state, ui);
  return (
    <div className="readonly-sheet">
      <p>
        只读预览，可在图片工作台查看历史版本并下载。导出 Excel 包含完整工作表。
      </p>
      <table>
        <thead>
          <tr>
            <th>产品</th>
            <th>图片位置</th>
            <th>参考图</th>
            <th>提示词</th>
            <th>当前结果</th>
          </tr>
        </thead>
        <tbody>
          {products.flatMap((product) =>
            product.tasks.map((task) => {
              const version =
                task.versions.find((v) => v.id === task.primaryId) ||
                task.versions.at(-1);
              return (
                <tr key={task.id}>
                  <td>
                    {product.code}
                    <br />
                    {product.name}
                  </td>
                  <td>{task.role}</td>
                  <td>
                    {task.references.map((source, index) => (
                      <a
                        key={index}
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <PreviewImage
                          src={source}
                          alt={`参考图 ${index + 1}`}
                        />
                      </a>
                    ))}
                  </td>
                  <td>
                    <div className="readonly-prompt">
                      {task.prompt || "暂无提示词"}
                    </div>
                  </td>
                  <td>
                    {version ? (
                      <a href={version.source} target="_blank" rel="noreferrer">
                        <PreviewImage
                          src={version.source}
                          alt={`结果 V${version.number}`}
                        />
                      </a>
                    ) : (
                      "暂无结果"
                    )}
                  </td>
                </tr>
              );
            }),
          )}
          {!products.length && (
            <tr>
              <td colSpan={5}>暂无产品资料</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
