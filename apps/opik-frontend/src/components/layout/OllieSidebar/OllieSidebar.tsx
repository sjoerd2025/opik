import React, { lazy, Suspense, useCallback, useEffect } from "react";
import useLocalStorageState from "use-local-storage-state";
import { useIsFeatureEnabled } from "@/components/feature-toggles-provider";
import { FeatureToggleKeys } from "@/types/feature-toggles";

const OLLIE_SIDEBAR_WIDTH = 380;

const ChatSidebar = lazy(() =>
  import("@comet-ml/ollie-sidebar").then((m) => ({ default: m.ChatSidebar })),
);

// Load ollie CSS lazily when the component mounts, bypassing PostCSS processing
const loadOllieCss = () => {
  const id = "ollie-sidebar-styles";
  if (document.getElementById(id)) return;

  import("@comet-ml/ollie-sidebar/styles.css?raw").then((css) => {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css.default;
    document.head.appendChild(style);
  });
};

interface OllieSidebarProps {
  onWidthChange: (width: number) => void;
}

const OllieSidebar: React.FunctionComponent<OllieSidebarProps> = ({
  onWidthChange,
}) => {
  const isEnabled = useIsFeatureEnabled(
    FeatureToggleKeys.OLLIE_CONSOLE_ENABLED,
  );
  const [isOpen, setIsOpen] = useLocalStorageState("ollie-sidebar-open", {
    defaultValue: true,
  });

  useEffect(() => {
    if (!isEnabled) {
      onWidthChange(0);
      return;
    }
    onWidthChange(isOpen ? OLLIE_SIDEBAR_WIDTH : 32);
  }, [isEnabled, isOpen, onWidthChange]);

  useEffect(() => {
    if (isEnabled) {
      loadOllieCss();
    }
  }, [isEnabled]);

  const handleClose = useCallback(() => setIsOpen(false), [setIsOpen]);

  if (!isEnabled) return null;

  return (
    <div className="absolute right-0 top-[var(--banner-height)] bottom-0 z-10">
      <Suspense>
        <ChatSidebar onClose={handleClose} defaultOpen={isOpen} />
      </Suspense>
    </div>
  );
};

export default OllieSidebar;
