import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import styles from "./nima.module.css";

export function NimaDialog({
  children,
  titleId,
  onClose,
}: {
  children: ReactNode;
  titleId: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport className={styles["nima-overlay"]}>
          <Dialog.Popup className={styles["nima-dialog-popup"]} aria-labelledby={titleId}>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
