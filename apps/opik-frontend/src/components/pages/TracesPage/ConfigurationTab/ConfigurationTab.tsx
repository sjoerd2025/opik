import React, { useMemo, useState } from "react";
import { Book, PlusIcon, Settings2 } from "lucide-react";
import { StringParam, useQueryParam } from "use-query-params";

import Loader from "@/components/shared/Loader/Loader";
import { Button } from "@/components/ui/button";
import { buildDocsUrl } from "@/lib/utils";
import useConfigHistoryListInfinite from "@/api/agent-configs/useConfigHistoryListInfinite";
import { ConfigHistoryItem } from "@/types/agent-configs";
import { isProdTag } from "@/utils/agent-configurations";
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

  const prodVersion = useMemo(() => {
    const idx = allRows.findIndex((r) => r.tags.some(isProdTag));
    return idx >= 0 ? total - idx : null;
  }, [allRows, total]);

  const prodItem = useMemo(() => {
    return allRows.find((r) => r.tags.some(isProdTag));
  }, [allRows]);

  if (isPending) {
    return <Loader />;
  }

  if (allRows.length === 0) {
    return (
      <div className="flex w-full justify-center p-6">
        <div className="flex w-full flex-col items-center rounded-md border px-6 py-14">
          <Settings2 className="mb-3 size-4 text-light-slate" />
          <h2 className="comet-title-xs">No agent configuration found</h2>
          <p className="comet-body-s mt-2 text-center text-muted-slate">
            This project doesn&apos;t include an agent configuration.
            <br />
            Configure your agent to track and edit prompts and parameters here.
          </p>
          <a
            href={buildDocsUrl("/tracing/log_agents")}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Book className="size-4" />
            Learn how to configure your agent
          </a>
        </div>
      </div>
    );
  }

  const selectedItem = allRows[selectedIndex] as ConfigHistoryItem;
  const latestItem = allRows[0] as ConfigHistoryItem;

  if (isEditing && latestItem) {
    return (
      <div className="w-[70vw]">
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
      <div className="min-w-0 w-[60vw] flex-1 [overflow-anchor:none]">
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
            prodItemId={prodItem?.id}
            prodVersion={prodVersion}
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
// move files that are shared
// check bug with time