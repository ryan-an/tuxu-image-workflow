import { useRef, useState } from "react";
import { changePassword } from "../../services/authentication";
import { Button } from "../design-system/Button";
import { DialogActions } from "../dialogs/DialogActions";
import { useDialogDismiss } from "../dialogs/useDialogDismiss";
export function PasswordDialog({ onClose }: { onClose(): void }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const dismiss = useDialogDismiss(onClose, pending);
  return (
    <dialog
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      {...dismiss}
    >
      <Button
        className="modal-close"
        onClick={onClose}
        disabled={pending}
        aria-label="关闭"
      >
        ×
      </Button>
      <h2>修改密码</h2>
      <p className="modal-subtitle">
        保存后所有设备上的登录失效，请使用新密码重新登录。
      </p>
      <form
        className="password-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy.current) return;
          const data = new FormData(e.currentTarget),
            password = String(data.get("password"));
          if (password !== data.get("confirmPassword")) {
            setError("两次密码不一致");
            return;
          }
          busy.current = true;
          setPending(true);
          setError("");
          try {
            await changePassword(String(data.get("currentPassword")), password);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "修改失败");
          } finally {
            busy.current = false;
            setPending(false);
          }
        }}
      >
        <label>
          原密码
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={256}
            required
            disabled={pending}
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={10}
            maxLength={256}
            required
            disabled={pending}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <DialogActions>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "保存中…" : "保存新密码"}
          </Button>
        </DialogActions>
      </form>
    </dialog>
  );
}
