import { can } from "../../../shared/access";
import { useId, useRef, useState } from "react";
import { Button } from "../design-system/Button";
import { useApplication } from "../context";
import type { Product } from "../types";
import "./product-delete.css";

export function ProductDeleteButton({ product }: { product: Product }) {
  const { controller, user } = useApplication();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = () => {
    popover.current?.hidePopover();
    trigger.current?.focus();
  };
  if (!can(user, "edit")) return null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="product-delete"
        aria-label={`删除产品 ${product.name}`}
        title="删除产品"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (open) return close();
          const rect = trigger.current!.getBoundingClientRect();
          popover.current?.showPopover();
          const bubble = popover.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(rect.right + 8, window.innerWidth - bubble.width - 8),
            ),
            top: Math.max(
              8,
              Math.min(
                rect.top - bubble.height - 8,
                window.innerHeight - bubble.height - 8,
              ),
            ),
          });
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path
            d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        role="alertdialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="product-delete-popover"
        style={position}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <strong id={`${id}-title`}>删除这个产品？</strong>
        <p id={`${id}-description`}>
          产品、历史记录和表格行将删除，无法撤销。无引用的图片会自动清理。
        </p>
        <div className="product-delete-actions">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={close}
            autoFocus
          >
            取消
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={async () => {
              if (submitting.current) return;
              submitting.current = true;
              setPending(true);
              try {
                await controller.dispatch("delete-product", {
                  id: product.id,
                  confirmed: "true",
                });
                close();
              } finally {
                submitting.current = false;
                setPending(false);
              }
            }}
          >
            {pending ? "删除中…" : "确认删除"}
          </Button>
        </div>
      </div>
    </>
  );
}
