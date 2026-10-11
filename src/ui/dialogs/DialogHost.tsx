import type { Modal } from "../types";
import { useEffect, useRef } from "react";
import { ActionButton, useApplication } from "../context.tsx";
import {
  PromptDialog,
  ProductDialog,
  CommonDialog,
  VersionDialog,
  ReconcileDialog,
  PasteDialog,
  PromptHistory,
} from "./EditorDialogs.tsx";
import { MediaDialog } from "./MediaDialog.tsx";
import { SettingsDialog, KeyDialog } from "./SettingsDialog.tsx";
import { ParseDialog } from "../sheet/ParseDialog.tsx";

function DialogContent({ modal }: { modal: Modal }) {
  const { state, ui } = useApplication();
  const product = state.products.find((p) => p.id === modal.productId),
    task = product?.tasks.find((t) => t.id === modal.taskId);
  switch (modal.type) {
    case "prompt":
      return product && task ? (
        <PromptDialog product={product} task={task} />
      ) : null;
    case "product":
      return <ProductDialog product={product} isNew={modal.isNew} />;
    case "common":
      return <CommonDialog />;
    case "version": {
      const version = task?.versions.find((v) => v.id === modal.versionId);
      return task && version ? (
        <VersionDialog task={task} version={version} />
      ) : null;
    }
    case "media":
      return product ? <MediaDialog product={product} task={task} /> : null;
    case "settings":
      return <SettingsDialog />;
    case "key":
      return <KeyDialog />;
    case "parser":
      return <ParseDialog context={ui.parser!} />;
    case "reconcile":
      return <ReconcileDialog id={modal.id} />;
    case "paste":
      return <PasteDialog />;
    case "prompt-history":
      return task ? (
        <>
          <h2>{task.role} · 提示词历史</h2>
          <PromptHistory task={task} />
        </>
      ) : null;
    default:
      throw new Error(`未知弹窗：${modal.type}`);
  }
}
export function DialogHost() {
  const { ui, controller } = useApplication(),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (ui.modal && !dialog.open) {
      dialog.showModal();
      dialog
        .querySelector<HTMLElement>(
          "#prompt-form textarea, #product-form input, #key-form input, #media-dropzone, #paste-content",
        )
        ?.focus();
    }
    if (!ui.modal && dialog.open) dialog.close();
  }, [ui.modal?.key]);
  return (
    <dialog
      id="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        controller.closeModal();
      }}
    >
      {ui.modal && (
        <div key={ui.modal.key}>
          <ActionButton
            className="modal-close"
            action="close-modal"
            aria-label="关闭"
          >
            ×
          </ActionButton>
          <DialogContent modal={ui.modal} />
          {ui.formError && !["settings", "key"].includes(ui.modal.type) && (
            <p className="error-text" role="alert">
              {ui.formError}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
