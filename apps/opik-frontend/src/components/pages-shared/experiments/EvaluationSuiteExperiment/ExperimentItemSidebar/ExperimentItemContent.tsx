import React, { useEffect, useMemo, useState } from "react";
import sortBy from "lodash/sortBy";
import { Database, ListTree } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

import SyntaxHighlighter from "@/components/shared/SyntaxHighlighter/SyntaxHighlighter";
import NoData from "@/components/shared/NoData/NoData";
import { Tag } from "@/components/ui/tag";
import { DatasetItem, Experiment, ExperimentItem } from "@/types/datasets";
import { OnChangeFn } from "@/types/shared";
import { traceExist, traceVisible } from "@/lib/traces";
import useAppStore from "@/store/AppStore";
import PassFailBadge from "./PassFailBadge";
import AssertionResultsTable from "./AssertionResultsTable";
import MultiRunTabs from "./MultiRunTabs";

type ExperimentItemContentProps = {
  data?: DatasetItem["data"];
  experimentItems: ExperimentItem[];
  openTrace: OnChangeFn<string>;
  description?: string;
  experiments?: Experiment[];
  datasetId?: string;
};

export const ExperimentItemContent: React.FC<ExperimentItemContentProps> = ({
  data,
  experimentItems,
  openTrace,
  description,
  experiments,
  datasetId,
}) => {
  const workspaceName = useAppStore((state) => state.activeWorkspaceName);
  const [activeRunIndex, setActiveRunIndex] = useState(0);

  const sortedItems = useMemo(
    () => sortBy(experimentItems, "created_at"),
    [experimentItems],
  );

  useEffect(() => setActiveRunIndex(0), [experimentItems]);

  const aggregateStatus = useMemo(() => {
    if (sortedItems.length === 0) return undefined;
    return sortedItems[0].status;
  }, [sortedItems]);

  const renderRunContent = (item: ExperimentItem, idx: number) => {
    const assertions = item.assertion_results ?? [];

    if (!traceExist(item)) {
      return (
        <div className="mt-16 flex-1">
          <NoData
            title="No related trace found"
            message="It looks like it was deleted or not created"
            className="min-h-24 text-center"
          />
        </div>
      );
    }

    return (
      <>
        <div className="min-h-0 flex-1 overflow-auto">
          {item.output && (
            <SyntaxHighlighter
              data={item.output}
              prettifyConfig={{ fieldType: "output" }}
              preserveKey={`eval-suite-sidebar-output-${idx}`}
            />
          )}
        </div>
        {assertions.length > 0 && (
          <div className="flex-end mt-4 flex max-h-[50%] min-h-[50%] shrink-0 flex-col justify-end overflow-auto py-4">
            <AssertionResultsTable assertions={assertions} />
          </div>
        )}
      </>
    );
  };

  const activeItem = sortedItems[activeRunIndex];
  const showGoToTraces =
    activeItem && traceExist(activeItem) && traceVisible(activeItem);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="eval-suite-sidebar"
      className="h-full"
    >
      <ResizablePanel defaultSize={35} className="min-w-72">
        <div className="h-full overflow-auto pr-6 pt-4">
          <div className="flex items-center justify-between pb-4">
            <h4 className="comet-body-accented">Item context</h4>
            {datasetId && (
              <Link
                to="/$workspaceName/evaluation-suites/$suiteId/items"
                params={{ workspaceName, suiteId: datasetId }}
                onClick={(e) => e.stopPropagation()}
              >
                <Tag
                  variant="default"
                  size="md"
                  className="flex cursor-pointer items-center gap-1.5"
                >
                  <Database className="size-3" />
                  View evaluation item
                </Tag>
              </Link>
            )}
          </div>
          {description && (
            <div className="pb-4">
              <h4 className="comet-body-s-accented px-0.5 pb-0.5">
                Description
              </h4>
              <div className="rounded-md border border-border px-3 py-2">
                <p className="comet-body-s truncate">{description}</p>
              </div>
            </div>
          )}
          <div>
            <h4 className="comet-body-s-accented px-0.5 pb-0.5">Data</h4>
            {data ? (
              <SyntaxHighlighter
                data={data}
                prettifyConfig={{ fieldType: "input" }}
                preserveKey="eval-suite-sidebar-context"
              />
            ) : (
              <NoData title="No data" className="min-h-24" />
            )}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="min-w-72">
        <div className="flex h-full flex-col px-6 pt-4">
          <div className="flex shrink-0 items-center justify-between pb-4">
            <div className="flex items-center gap-2">
              <h4 className="comet-body-accented">
                {experiments?.[0]?.name ?? "Experiment results"}
              </h4>
              <PassFailBadge status={aggregateStatus} />
            </div>
            {showGoToTraces && (
              <Tag
                variant="default"
                size="md"
                className="flex cursor-pointer items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeItem.trace_id) {
                    openTrace(activeItem.trace_id);
                  }
                }}
              >
                <ListTree className="size-3" />
                Go to traces
              </Tag>
            )}
          </div>
          <MultiRunTabs
            experimentItems={sortedItems}
            renderRunContent={renderRunContent}
            activeIndex={activeRunIndex}
            onActiveIndexChange={setActiveRunIndex}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default ExperimentItemContent;
