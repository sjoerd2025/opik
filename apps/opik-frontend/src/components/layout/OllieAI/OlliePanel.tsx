import React from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import useOllieStore from "@/store/OllieStore";
import { cn } from "@/lib/utils";
import OllieChatView from "./OllieChatView";

const OlliePanel: React.FC = () => {
  const { isOpen, mode, setIsOpen, setMode } = useOllieStore();

  if (!isOpen) {
    return null;
  }

  const isCompact = mode === "compact";
  const isWide = mode === "wide";

  const toggleMode = () => {
    setMode(isCompact ? "wide" : "compact");
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <>
      {/* Panel */}
      <div
        className={cn(
          "fixed z-50 flex flex-col bg-background border shadow-xl transition-all duration-300",
          isCompact &&
            "bottom-6 right-6 w-[400px] h-[550px] rounded-lg animate-in slide-in-from-bottom-4",
          isWide &&
            "top-0 right-0 bottom-0 w-[500px] border-l animate-in slide-in-from-right-4",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="comet-title-s">OllieAI</h2>
          </div>
          <div className="flex items-center gap-1">
            <TooltipWrapper
              content={
                isCompact ? "Expand to wide mode" : "Collapse to compact mode"
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleMode}
                aria-label={isCompact ? "Expand" : "Collapse"}
              >
                {isCompact ? (
                  <Maximize2 className="size-4" />
                ) : (
                  <Minimize2 className="size-4" />
                )}
              </Button>
            </TooltipWrapper>
            <TooltipWrapper content="Close">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleClose}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </TooltipWrapper>
          </div>
        </div>

        {/* Chat View */}
        <div className="flex-1 overflow-hidden">
          <OllieChatView />
        </div>
      </div>
    </>
  );
};

export default OlliePanel;
