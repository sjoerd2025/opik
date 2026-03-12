import React from "react";
import { ChartLine, ChartBarBig, Pentagon } from "lucide-react";
import { CHART_TYPE } from "@/constants/chart";
import CardSelector, {
  CardOption,
} from "@/components/shared/CardSelector/CardSelector";

// TODO lala custom pentagon icon

const ALL_OPTIONS: Record<CHART_TYPE, CardOption> = {
  [CHART_TYPE.line]: {
    value: CHART_TYPE.line,
    label: "Line chart",
    icon: <ChartLine className="size-4" />,
    iconColor: "text-chart-blue",
  },
  [CHART_TYPE.bar]: {
    value: CHART_TYPE.bar,
    label: "Bar chart",
    icon: <ChartBarBig className="size-4" />,
    iconColor: "text-chart-yellow",
  },
  [CHART_TYPE.radar]: {
    value: CHART_TYPE.radar,
    label: "Radar chart",
    icon: <Pentagon className="size-4" />,
    iconColor: "text-chart-blue",
  },
};

interface VisualizationCardSelectorProps {
  value: string;
  onChange: (value: string) => void;
  types: CHART_TYPE[];
  className?: string;
}

const VisualizationCardSelector: React.FC<VisualizationCardSelectorProps> = ({
  value,
  onChange,
  types,
  className,
}) => {
  const options = types.map((type) => ALL_OPTIONS[type]);

  return (
    <CardSelector
      value={value}
      onChange={onChange}
      options={options}
      className={className}
    />
  );
};

export default VisualizationCardSelector;
