import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../services/workspace-client.js";
import { ActionButton } from "../context";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { formatTime } from "../selectors";
import "./activity.css";

interface Change {
  path: string[];
  before: any;
  value: any;
  product?: string;
  role?: string;
}
interface Entry {
  id: number;
  createdAt: number;
  actor: { displayName: string; username: string };
  changes: Change[];
}
const fields: Record<string, string> = {
  name: "名称",
  code: "产品编号",
  facts: "产品资料",
  promptRequirements: "生成要求",
  prompt: "提示词",
  references: "参考图",
  photos: "实拍图",
  photo: "主实拍图",
  primaryId: "展示版本",
  selectedIds: "下载选图",
  common: "默认生成要求",
  concurrency: "并发数量",
  promptTemplates: "提示词模板",
  imports: "导入结果",
};
function label(change: Change) {
  const path = change.path;
  if (path[0] === "sheetSnapshot") {
    let column = "";
    for (let n = Number(path[5]) + 1; n > 0; n = Math.floor((n - 1) / 26))
      column = String.fromCharCode(65 + ((n - 1) % 26)) + column;
    return `表格 · ${path[2] === "preview" ? "工作流预览" : path[2]} · ${column}${Number(path[4]) + 1}`;
  }
  return [
    change.product,
    change.role,
    fields[path.at(-1)!] ||
      (path.length === 2 && path[0] === "products"
        ? "新增产品"
        : fields[path[0]] || "资料"),
  ]
    .filter(Boolean)
    .join(" · ");
}
function Value({ value }: { value: any }) {
  if (value == null || value === "")
    return <span className="activity-empty">空</span>;
  if (typeof value === "string" && /^\/api\/assets\/[a-f0-9]{64}$/.test(value))
    return <img src={`${value}/thumbnail`} alt="修改图片" loading="lazy" />;
  if (value?.images?.length)
    return (
      <div>
        {value.images.map((source: string) => (
          <Value key={source} value={source} />
        ))}
        {value.v && <Value value={value.v} />}
      </div>
    );
  if (value?.f) return <Value value={value.f} />;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.p?.body?.dataStream
  )
    return <Value value={value.p.body.dataStream.replace(/\r?\n$/, "")} />;
  if (typeof value === "object" && !Array.isArray(value) && "v" in value)
    return <Value value={value.v} />;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre>{text}</pre>;
}
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const clockFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function HistoryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function ActivityDialog() {
  const [items, setItems] = useState<Entry[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const feed = useRef<HTMLDivElement>(null);
  function scrollToLatest() {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }
  async function load() {
    setPending(true);
    setError("");
    try {
      const result = await api("/api/workspace/activity");
      if (!mounted.current) return;
      setItems(
        result.items.sort((a: Entry, b: Entry) => a.id - b.id).slice(-100),
      );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(scrollToLatest, [items]);
  const days = new Map<string, Entry[]>();
  for (const entry of items) {
    const day = dayFormat.format(entry.createdAt);
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(entry);
  }
  return (
    <div className="activity-dialog">
      <header className="activity-header">
        <div className="activity-heading-icon">
          <HistoryIcon />
        </div>
        <div className="activity-heading">
          <div className="activity-title">
            <h2 id="activity-dialog-title">操作历史</h2>
            <Badge tone="neutral">最近 100 条</Badge>
          </div>
          <p id="activity-dialog-description">
            当前工作区的修改记录，最新的在下方
          </p>
        </div>
        <ActionButton
          action="close-modal"
          variant="ghost"
          size="sm"
          aria-label="关闭操作历史"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </ActionButton>
      </header>
      <div
        className="activity-feed"
        ref={feed}
        tabIndex={0}
        aria-label="操作日志"
        aria-busy={pending}
      >
        {Array.from(days, ([day, entries]) => (
          <section className="activity-day" key={day} aria-label={day}>
            <h3 className="activity-date">{day}</h3>
            <ol className="activity-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <details
                    className="activity-entry"
                    data-entry-id={entry.id}
                    data-latest={entry.id === items.at(-1)?.id || undefined}
                    onToggle={(event) => {
                      if (!event.currentTarget.open) return;
                      if (entry.id === items.at(-1)?.id) scrollToLatest();
                      else
                        event.currentTarget.scrollIntoView({
                          block: "nearest",
                        });
                    }}
                  >
                    <summary>
                      <time
                        dateTime={new Date(entry.createdAt).toISOString()}
                        title={formatTime(entry.createdAt)}
                      >
                        {clockFormat.format(entry.createdAt)}
                      </time>
                      <div className="activity-event">
                        <div className="activity-event-heading">
                          <strong>
                            {entry.actor.displayName || entry.actor.username}
                          </strong>
                          {entry.id === items.at(-1)?.id && (
                            <Badge tone="brand">最新</Badge>
                          )}
                        </div>
                        <span className="activity-target">
                          {entry.changes.length === 1 ? (
                            <>更新了 {label(entry.changes[0])}</>
                          ) : (
                            `保存了 ${entry.changes.length} 项修改`
                          )}
                        </span>
                      </div>
                      <svg
                        className="activity-chevron"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <path
                          d="m6 4 4 4-4 4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </summary>
                    <div className="activity-detail">
                      {entry.changes.map((change, index) => (
                        <section className="activity-change" key={index}>
                          <h3>{label(change)}</h3>
                          <div className="activity-values">
                            <div>
                              <small>修改前</small>
                              <Value value={change.before} />
                            </div>
                            <div>
                              <small>修改后</small>
                              <Value value={change.value} />
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {(!items.length || error) && (
          <div className="activity-placeholder">
            <HistoryIcon />
            {pending ? (
              <p role="status">正在读取操作记录…</p>
            ) : error ? (
              <>
                <p className="error-text" role="alert">
                  {error}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void load()}
                >
                  重新读取
                </Button>
              </>
            ) : (
              <>
                <strong>暂无操作记录</strong>
                <p>工作区的修改会记录在这里</p>
              </>
            )}
          </div>
        )}
      </div>
      <footer className="activity-footer">
        <span>
          {pending ? "正在读取…" : `已显示 ${items.length} 条记录`}
          <span className="activity-footer-hint"> · 点击记录查看详情</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={scrollToLatest}
          disabled={!items.length}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              d="M8 3v9m-4-4 4 4 4-4M4 14h8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          回到最新
        </Button>
      </footer>
    </div>
  );
}
