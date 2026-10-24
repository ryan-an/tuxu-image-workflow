import { useEffect, useState } from "react";
import type { WorkspaceDirectoryModel } from "../../application/use-workspaces";
import { Button } from "../design-system/Button";
import { DialogActions } from "../dialogs/DialogActions";
import { useDialogDismiss } from "../dialogs/useDialogDismiss";
import "./workspaces.css";

export function CreateWorkspaceDialog({
  model,
  onClose,
  onCreated,
  beforeCreate,
}: {
  model: WorkspaceDirectoryModel;
  onClose(): void;
  onCreated(id: string): Promise<unknown>;
  beforeCreate?(): Promise<unknown>;
}) {
  const [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const dismiss = useDialogDismiss(onClose, submitting);
  useEffect(() => {
    model.clearError();
  }, []);
  return (
    <dialog
      className="workspace-create-dialog"
      aria-labelledby="create-workspace-title"
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      {...dismiss}
    >
      <span className="eyebrow">NEW WORKSPACE</span>
      <h2 id="create-workspace-title">新建工作区</h2>
      <p>产品、素材和 API Key 独立保存，可随时邀请成员。</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting) return;
          const name = String(new FormData(event.currentTarget).get("name"));
          setSubmitting(true);
          setError("");
          try {
            if (beforeCreate) await beforeCreate();
            const id = await model.create(name);
            if (id) await onCreated(id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label>
          工作区名称
          <input
            name="name"
            aria-label="工作区名称"
            placeholder="例如 新品拍摄项目"
            autoFocus
            required
            maxLength={60}
            disabled={submitting}
          />
        </label>
        {(error || model.error) && (
          <p className="error-text" role="alert">
            {error || model.error}
          </p>
        )}
        <DialogActions className="workspace-dialog-actions">
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "正在创建…" : "创建工作区"}
          </Button>
        </DialogActions>
      </form>
    </dialog>
  );
}
