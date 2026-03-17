import React from "react";
import { GripHorizontal } from "lucide-react";

import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import { useDashboardStore, selectReadOnly } from "@/store/DashboardStore";

const DashboardWidgetDragHandle: React.FunctionComponent = () => {
  const readOnly = useDashboardStore(selectReadOnly);

  if (readOnly) return null;

  return (
    <TooltipWrapper content="Drag to reposition">
      <div className="comet-drag-handle flex w-full cursor-grab items-center justify-center text-light-slate hover:text-foreground active:cursor-grabbing">
        <GripHorizontal className="size-3" />
      </div>
    </TooltipWrapper>
  );
};

export default DashboardWidgetDragHandle;
