import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { useDialogDismiss } from "../dialogs/useDialogDismiss";

export const beijingTime = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === "active"
          ? "success"
          : status === "pending"
            ? "warning"
            : status === "disabled"
              ? "danger"
              : "neutral"
      }
    >
      {(
        {
          active: "正常",
          pending: "待激活",
          disabled: "已禁用",
          archived: "已归档",
        } as Record<string, string>
      )[status] || status}
    </Badge>
  );
}
export function AdminHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="admin-actions">{children}</div>
    </div>
  );
}
export function AdminTable({
  headings,
  children,
  empty,
}: {
  headings: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={headings.length} className="admin-empty">
                暂无匹配记录
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
export function AdminPagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage(page: number): void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="admin-pagination" aria-label="列表分页">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </nav>
  );
}
export function AdminFilters({
  q,
  status,
  onChange,
  workspace = false,
}: {
  q: string;
  status: string;
  onChange(q: string, status: string): void;
  workspace?: boolean;
}) {
  return (
    <form className="admin-filters" onSubmit={(e) => e.preventDefault()}>
      <input
        aria-label={workspace ? "搜索工作区" : "搜索账号"}
        type="search"
        placeholder={
          workspace ? "搜索名称、ID 或所有者" : "搜索用户名或个人名称"
        }
        value={q}
        onChange={(e) => onChange(e.target.value, status)}
      />
      <select
        aria-label="状态筛选"
        value={status}
        onChange={(e) => onChange(q, e.target.value)}
      >
        <option value="">全部状态</option>
        {workspace ? (
          <>
            <option value="active">启用中</option>
            <option value="archived">已归档</option>
          </>
        ) : (
          <>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
            <option value="pending">待激活</option>
          </>
        )}
      </select>
    </form>
  );
}
export function AdminFeedback({
  error,
  notice,
  loading,
}: {
  error?: string;
  notice?: string;
  loading?: boolean;
}) {
  return (
    <>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {loading && (
        <p className="admin-muted" role="status">
          正在读取…
        </p>
      )}
    </>
  );
}
export function AdminDialog({
  title,
  confirm = "保存",
  danger,
  confirmDisabled = false,
  children,
  onClose,
  onSubmit,
}: {
  title: string;
  confirm?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  children: ReactNode;
  onClose(): void;
  onSubmit(data: FormData): Promise<unknown>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false);
  const dismiss = useDialogDismiss(onClose, pending);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || confirmDisabled) return;
    const data = new FormData(event.currentTarget);
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="admin-dialog"
      aria-labelledby={id}
      {...dismiss}
    >
      <form onSubmit={submit}>
        <h2 id={id}>{title}</h2>
        <fieldset disabled={pending}>{children}</fieldset>
        {error && (
          <p role="alert" className="admin-error">
            {error}
          </p>
        )}
        <div className="admin-dialog-actions">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            disabled={pending || confirmDisabled}
          >
            {pending ? "处理中…" : confirm}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
export function AdminField({
  label,
  name,
  value,
  type = "text",
  minLength,
  maxLength = 60,
  required = true,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string }>(children)
    ? cloneElement(children, { id })
    : children;
  return (
    <div className="admin-field">
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      {control || (
        <input
          id={id}
          name={name}
          defaultValue={value}
          type={type}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={type === "password" ? "new-password" : "off"}
        />
      )}
    </div>
  );
}
