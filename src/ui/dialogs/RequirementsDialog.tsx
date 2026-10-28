import { can } from "../../../shared/access";
import {
  useRef,
  useState,
  type FormHTMLAttributes,
  type RefObject,
} from "react";
import type { Product, PromptTemplate } from "../types";
import { useApplication } from "../context.tsx";
import { Button } from "../design-system/Button";
import { DialogActions } from "./DialogActions";
import { productRequirements } from "../../../shared/prompt-suite.js";
import { uid } from "../../../shared/model.js";
import {
  requirementDraftKey,
  readRequirementDraft,
  writeRequirementDraft,
} from "../../integrations/requirement-drafts.js";

function EditorForm({
  readOnly,
  formRef,
  children,
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  readOnly: boolean;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  return readOnly ? (
    <div className={props.className}>{children}</div>
  ) : (
    <form ref={formRef} {...props}>
      {children}
    </form>
  );
}

function ToolIcon({
  name,
}: {
  name: "search" | "expand" | "collapse" | "close";
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "search" ? (
        <>
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4 4" />
        </>
      ) : name === "expand" ? (
        <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" />
      ) : name === "collapse" ? (
        <path d="M3 7h4V3m6 0v4h4M7 17v-4H3m14 0h-4v4" />
      ) : (
        <path d="m5 5 10 10M15 5 5 15" />
      )}
    </svg>
  );
}

export function RequirementsDialog({ product }: { product: Product }) {
  const { state, user, controller } = useApplication();
  const readOnly = !can(user, "edit");
  const [saved, setSaved] = useState(() => ({
    text: productRequirements(product, state.common),
    before: product.promptRequirements ?? null,
  }));
  const draftKey = requirementDraftKey(user, product.id);
  const [restored] = useState(() =>
    readOnly ? null : readRequirementDraft(draftKey),
  );
  const [draft, setDraft] = useState<string>(
    () => restored?.content ?? saved.text,
  );
  const [draftStored, setDraftStored] = useState(true);
  const [undo, setUndo] = useState<string | null>(null);
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [templateChoice, setTemplateChoice] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    restored && restored.content !== saved.text
      ? restored.base === saved.text
        ? "已恢复未保存的草稿"
        : "已恢复草稿；已保存内容有更新，可恢复查看。"
      : "",
  );
  const editor = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const templates = Object.values(state.promptTemplates ?? {}).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const changed = draft !== saved.text;
  const analyzing = state.jobs.some(
    (job) =>
      job.productId === product.id &&
      job.kind === "prompt-set" &&
      ["queued", "running"].includes(job.status),
  );
  const matches = query ? draft.split(query).length - 1 : 0;
  const status =
    notice ||
    (!draftStored
      ? "草稿未能保留，请及时保存"
      : changed
        ? "草稿已保留"
        : analyzing
          ? "当前任务继续使用启动时的要求；修改用于下一次生成。"
          : "仅当前产品 · 保存后下次生成生效");

  function changeDraft(text: string) {
    setDraft(text);
    setDraftStored(writeRequirementDraft(draftKey, text, saved.text));
    setError("");
    setNotice("");
  }
  function replaceDraft(text: string) {
    setUndo(draft);
    changeDraft(text);
  }
  async function work(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function chooseTemplate(value: string) {
    setTemplateChoice(value);
    setNaming(false);
    setConfirmDelete(false);
    const template = value.startsWith("template:")
      ? (state.promptTemplates?.[value.slice(9)] ?? null)
      : null;
    setSelected(template ? { ...template } : null);
    if (!value) return;
    replaceDraft(
      value === "default" ? state.common : (template?.content ?? saved.text),
    );
    setNotice("已套用，可继续修改；保存后生效");
  }
  function openNaming() {
    setName(selected?.name ?? "");
    setNaming(!naming);
    setConfirmDelete(false);
    setError("");
  }
  function saveTemplate(asNew = false) {
    void work(async () => {
      if (!name.trim()) throw new Error("给模板起个名字，方便下次找到");
      const template = {
        id: !asNew && selected ? selected.id : uid(),
        name: name.trim(),
        content: draft,
        updatedAt: Date.now(),
      };
      await controller.savePromptTemplate(template, !asNew ? selected : null);
      setSelected(template);
      setTemplateChoice(`template:${template.id}`);
      setNaming(false);
      setNotice("模板已保存；用于当前产品还需点击保存");
    });
  }
  function restoreSaved() {
    const text = productRequirements(product, state.common);
    setUndo(draft);
    setSaved({ text, before: product.promptRequirements ?? null });
    setDraft(text);
    setDraftStored(writeRequirementDraft(draftKey, text, text));
    setTemplateChoice("");
    setSelected(null);
    setError("");
    setNotice("已恢复当前产品保存的内容");
  }
  function findNext() {
    if (!query || !editor.current) return;
    const element = editor.current;
    let start = draft.indexOf(query, element.selectionEnd);
    if (start < 0) start = draft.indexOf(query);
    if (start >= 0) {
      element.focus();
      element.setSelectionRange(start, start + query.length);
    }
  }
  function toggleSearch() {
    setSearchOpen(!searchOpen);
  }
  function toggleExpanded() {
    // Move focus before the clicked toolbar button is unmounted.
    editor.current?.focus({ preventScroll: true });
    setExpanded(!expanded);
  }
  const saveButton = (
    <Button
      size="sm"
      variant={naming && !expanded ? "secondary" : "primary"}
      type="submit"
      form="common-form"
      aria-label="保存当前产品要求"
      disabled={busy || !changed || !draft.trim()}
    >
      {busy ? "保存中…" : "保存"}
    </Button>
  );

  return (
    <div
      className={`requirements-editor${expanded ? " requirements-editor-expanded" : ""}`}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && (searchOpen || expanded || naming)) {
          event.preventDefault();
          event.stopPropagation();
          if (naming && !expanded) setNaming(false);
          else if (searchOpen) {
            setSearchOpen(false);
            editor.current?.focus({ preventScroll: true });
          } else setExpanded(false);
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          if (!readOnly && !busy && changed) form.current?.requestSubmit();
        }
      }}
    >
      <header className="requirements-header">
        <h2 id="requirements-dialog-title">
          {expanded ? "提示词编辑" : "整套提示词要求"}
        </h2>
        {!expanded && (
          <span
            className="requirements-product"
            title={`${product.code} · ${product.name}`}
          >
            {product.code} · {product.name}
          </span>
        )}
        {expanded && (
          <span className="requirements-word-count">
            {draft.length.toLocaleString()} 字
          </span>
        )}
        <div className="requirements-header-actions">
          {expanded ? (
            <>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={searchOpen}
                  aria-label="查找替换"
                  title="查找替换（Ctrl+F）"
                  onClick={toggleSearch}
                >
                  <ToolIcon name="search" />
                  <span>查找替换</span>
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={toggleExpanded}>
                <ToolIcon name="collapse" />
                <span>退出全屏</span>
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label="关闭"
              disabled={busy}
              onClick={() => controller.closeModal()}
            >
              <ToolIcon name="close" />
            </Button>
          )}
        </div>
      </header>
      {!expanded && (
        <div className="requirements-toolbar">
          {!readOnly && (
            <div className="requirements-template-bar">
              <label
                className="requirements-sr-only"
                htmlFor="requirement-template"
              >
                套用模板
              </label>
              <select
                id="requirement-template"
                value={templateChoice}
                disabled={busy}
                onChange={(e) => chooseTemplate(e.target.value)}
              >
                <option value="">套用模板（可选）</option>
                <option value="default">默认要求</option>
                {templates.map((template) => (
                  <option key={template.id} value={`template:${template.id}`}>
                    {template.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={naming}
                disabled={busy || !draft.trim()}
                onClick={openNaming}
              >
                {selected ? "保存模板…" : "存为模板…"}
              </Button>
            </div>
          )}
          <div className="requirements-editor-tools">
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={searchOpen}
                aria-label="查找替换"
                title="查找替换（Ctrl+F）"
                onClick={toggleSearch}
              >
                <ToolIcon name="search" />
                <span>查找替换</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label="放大编辑"
              title="全屏编辑"
              onClick={toggleExpanded}
            >
              <ToolIcon name="expand" />
              <span>放大编辑</span>
            </Button>
          </div>
        </div>
      )}
      {naming && !expanded && !readOnly && (
        <section className="requirements-template-editor" aria-label="保存模板">
          <div className="requirements-template-name-row">
            <label
              className="requirements-sr-only"
              htmlFor="requirement-template-name"
            >
              模板名称
            </label>
            <input
              id="requirement-template-name"
              value={name}
              maxLength={60}
              placeholder="模板名称，例如家居暖色"
              disabled={busy}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveTemplate();
                }
              }}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !name.trim() || !draft.trim()}
              onClick={() => saveTemplate()}
            >
              {selected ? "更新模板" : "保存模板"}
            </Button>
            {selected && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || !name.trim() || !draft.trim()}
                onClick={() => saveTemplate(true)}
              >
                另存一份
              </Button>
            )}
            {selected && !confirmDelete && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                删除模板
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setNaming(false);
                setConfirmDelete(false);
              }}
            >
              取消
            </Button>
          </div>
          {confirmDelete && selected && (
            <div className="requirements-delete-confirm">
              <span>删除模板？已保存的产品要求会保留。</span>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await controller.deletePromptTemplate(selected);
                    setSelected(null);
                    setTemplateChoice("");
                    setNaming(false);
                    setConfirmDelete(false);
                    setNotice("模板已删除，文本框内容已保留");
                  })
                }
              >
                确定删除
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                保留
              </Button>
            </div>
          )}
        </section>
      )}
      <EditorForm
        readOnly={readOnly}
        formRef={form}
        id="common-form"
        className="requirements-form"
        data-product={product.id}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          if (readOnly || busy || !changed) return;
          void work(async () => {
            await controller.saveProductRequirements(
              product.id,
              draft,
              saved.before,
            );
            writeRequirementDraft(draftKey, draft, draft);
            controller.closeModal();
          });
        }}
      >
        {searchOpen && !readOnly && (
          <div className="requirements-search">
            <input
              ref={search}
              autoFocus
              aria-label="查找内容"
              placeholder="查找"
              value={query}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  findNext();
                }
              }}
            />
            <input
              aria-label="替换为"
              placeholder="替换为"
              value={replacement}
              disabled={busy}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />
            <span className="requirements-match-count" aria-live="polite">
              {matches} 处
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !matches}
              onClick={findNext}
            >
              下一处
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !matches}
              onClick={() => {
                const next = draft.split(query).join(replacement);
                if (next.length > 100000) {
                  setError("替换后超过 100000 字，请缩短内容");
                  return;
                }
                replaceDraft(next);
              }}
            >
              全部替换
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="关闭查找替换"
              onClick={() => {
                setSearchOpen(false);
                editor.current?.focus({ preventScroll: true });
              }}
            >
              <ToolIcon name="close" />
            </Button>
          </div>
        )}
        <div className="requirements-text-surface">
          <label
            className="requirements-sr-only"
            htmlFor="product-requirements"
          >
            {readOnly ? "生成要求（只读）" : "生成要求"}
          </label>
          <textarea
            ref={editor}
            id="product-requirements"
            name="common"
            rows={18}
            required={!readOnly}
            readOnly={readOnly}
            disabled={busy}
            maxLength={100000}
            value={readOnly ? saved.text : draft}
            onChange={(event) => changeDraft(event.target.value)}
            aria-describedby="requirements-effect"
            spellCheck={false}
            placeholder="写下文案、风格、产品外观和尺寸等要求，格式不限…"
            onKeyDown={(event) => {
              if (
                !readOnly &&
                (event.ctrlKey || event.metaKey) &&
                ["f", "h"].includes(event.key.toLowerCase())
              ) {
                event.preventDefault();
                setSearchOpen(true);
                search.current?.focus();
              }
            }}
          />
        </div>
        <span id="requirements-effect" className="requirements-sr-only">
          保存后仅对当前产品的下一次提示词生成生效。关闭窗口会保留草稿。
        </span>
        {!expanded && (
          <footer className="requirements-footer">
            <span
              className="requirements-feedback"
              role="status"
              title={status}
            >
              {readOnly ? "只读" : status}
            </span>
            {!readOnly && (
              <div className="requirements-footer-tools">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="恢复已保存内容"
                  disabled={
                    busy ||
                    (!changed &&
                      draft === productRequirements(product, state.common))
                  }
                  onClick={restoreSaved}
                >
                  恢复
                </Button>
                {undo !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="撤销替换"
                    disabled={busy}
                    onClick={() => {
                      changeDraft(undo);
                      setUndo(null);
                    }}
                  >
                    撤销
                  </Button>
                )}
              </div>
            )}
            <span className="requirements-word-count">
              {draft.length.toLocaleString()} 字
            </span>
            {!readOnly && saveButton}
          </footer>
        )}
        {expanded && !readOnly && (
          <DialogActions className="requirements-focus-footer">
            {saveButton}
          </DialogActions>
        )}
      </EditorForm>
      {expanded && (
        <span className="requirements-sr-only" role="status">
          {notice || (changed ? "草稿已保留" : "与当前保存内容一致")}
        </span>
      )}
      {error && (
        <p className="requirements-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
