import React, { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { StringParam, useQueryParam } from "use-query-params";

import Loader from "@/components/shared/Loader/Loader";
import DataTableNoData from "@/components/shared/DataTableNoData/DataTableNoData";
import { Button } from "@/components/ui/button";
import useConfigHistoryListInfinite from "@/api/agent-configs/useConfigHistoryListInfinite";
import { ConfigHistoryItem } from "@/types/agent-configs";
import ConfigurationHistoryTimeline from "./ConfigurationHistoryTimeline";
import ConfigurationDetailView from "./ConfigurationDetailView";
import ConfigurationEditView from "./ConfigurationEditView";

type ConfigurationTabProps = {
  projectId: string;
};

const ConfigurationTab: React.FC<ConfigurationTabProps> = ({ projectId }) => {
  const [selectedId, setSelectedId] = useQueryParam("configId", StringParam, {
    updateType: "replaceIn",
  });
  const [isEditing, setIsEditing] = useState(false);

  const { data, isPending } = useConfigHistoryListInfinite({ projectId });

  const allRows = useMemo(
    () => data?.pages.flatMap((p) => p.content) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;

  const selectedIndex = useMemo(() => {
    if (!selectedId) return 0;
    const idx = allRows.findIndex((r) => r.id === selectedId);
    return idx >= 0 ? idx : 0;
  }, [allRows, selectedId]);

  if (isPending) {
    return <Loader />;
  }

  if (allRows.length === 0) {
    return <DataTableNoData title="No configuration history" />;
  }

  const selectedItem = allRows[selectedIndex] as ConfigHistoryItem;
  const latestItem = allRows[0] as ConfigHistoryItem;

  if (isEditing && latestItem) {
    return (
      <div className="max-w-[60vw]">
        <ConfigurationEditView
          item={latestItem}
          projectId={projectId}
          version={total}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setSelectedId(undefined);
            setIsEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex gap-0">
      <div className="min-w-0 max-w-[60vw] flex-1">
        <div className="mx-6 mt-6 flex items-center justify-between">
          <p className="comet-body-s-accented">Agent configuration</p>
          <Button size="xs" onClick={() => setIsEditing(true)}>
            <PlusIcon className="mr-1.5 size-3.5" />
            Add new version
          </Button>
        </div>

        {selectedItem ? (
          <ConfigurationDetailView
            item={selectedItem}
            version={total - selectedIndex}
            projectId={projectId}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-slate">
            Select a version to view its configuration
          </div>
        )}
      </div>

      <div className="w-[25vw] shrink-0 pr-2">
        <p className="comet-body-s-accented ml-3 mt-6">Version history</p>

        <ConfigurationHistoryTimeline
          items={allRows}
          total={total}
          selectedIndex={selectedIndex}
          onSelect={(index) => setSelectedId(allRows[index]?.id ?? undefined)}
        />
      </div>
    </div>
  );
};

export default ConfigurationTab;

// ALEX
// SCROLLING
// DESCRIPTIONS
// PROMPT UPDATES WITH REGULAR UPDATES
// width of editing
// empty fields
