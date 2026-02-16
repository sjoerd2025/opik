import React from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import useOllieStore from "@/store/OllieStore";
import { cn } from "@/lib/utils";

const OllieTriggerButton: React.FC = () => {
  const { isOpen, mode, togglePanel } = useOllieStore();

  const shouldHide = isOpen && mode === "wide";

  if (shouldHide) {
    return null;
  }

  return (
    <TooltipWrapper content="Open OllieAI Assistant">
      <Button
        size="icon"
        onClick={togglePanel}
        className={cn(
          "fixed bottom-6 right-6 z-40 size-14 rounded-full shadow-lg transition-all hover:scale-110",
          "bg-primary hover:bg-primary/90",
          isOpen && "opacity-0 pointer-events-none",
        )}
        aria-label="Toggle OllieAI Assistant"
      >
        <SparklesIcon className="size-6" />
      </Button>
    </TooltipWrapper>
  );
};

export default OllieTriggerButton;
