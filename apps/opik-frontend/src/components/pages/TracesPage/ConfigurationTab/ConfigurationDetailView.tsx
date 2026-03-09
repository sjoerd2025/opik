import React, { useState } from "react";
import {
  Clock,
  CopyPlus,
  FilePen,
  GitCompareArrows,
  Rocket,
  User,
} from "lucide-react";

import {
  BlueprintType,
  BlueprintValue,
  BlueprintValueType,
  ConfigHistoryItem,
} from "@/types/agent-configs";
import { formatDate, getTimeFromNow } from "@/lib/date";
import ColoredTag from "@/components/shared/ColoredTag/ColoredTag";
import Loader from "@/components/shared/Loader/Loader";
import { Card } from "@/components/ui/card";
import ProdTag from "./ProdTag";
import BlueprintValuesList from "@/components/pages-shared/traces/ConfigurationTab/BlueprintValuesList";
import BlueprintDiffDialog from "./BlueprintDiffDialog/BlueprintDiffDialog";
import {
  generateBlueprintDescription,
  isProdTag,
  sortTags,
} from "@/utils/agent-configurations";
import { Button } from "@/components/ui/button";
import useAgentConfigById from "@/api/agent-configs/useAgentConfigById";
import useAgentConfigCreateMutation from "@/api/agent-configs/useAgentConfigCreateMutation";
import useAgentConfigEnvsMutation from "@/api/agent-configs/useAgentConfigEnvsMutation";
import ConfirmDialog from "@/components/shared/ConfirmDialog/ConfirmDialog";
import TooltipWrapper from "@/components/shared/TooltipWrapper/TooltipWrapper";
import NavigationTag from "@/components/shared/NavigationTag/NavigationTag";
import { RESOURCE_TYPE } from "@/components/shared/ResourceLink/ResourceLink";
import { COLUMN_TYPE } from "@/types/shared";

type ConfigurationDetailViewProps = {
  item: ConfigHistoryItem;
  version: number;
  projectId: string;
  prodItemId?: string;
  prodVersion: number | null;
};

const renderTag = (tag: string) =>
  isProdTag(tag) ? (
    <ProdTag key={tag} value={tag} />
  ) : (
    <ColoredTag key={tag} label={tag} />
  );

const ConfigurationDetailView: React.FC<ConfigurationDetailViewProps> = ({
  item,
  version,
  projectId,
  prodItemId,
  prodVersion,
}) => {
  const { data: agentConfig, isPending } = useAgentConfigById({
    blueprintId: item.id,
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const { mutate: promoteToProd, isPending: isPromoting } =
    useAgentConfigEnvsMutation();

  const { mutate: createConfig, isPending: isDuplicating } =
    useAgentConfigCreateMutation();

  const handleConfirmPromote = () => {
    promoteToProd({
      envsRequest: {
        project_id: projectId,
        envs: [{ env_name: "prod", blueprint_id: item.id }],
      },
    });
  };

  const description =
    item.description || generateBlueprintDescription(item.values);

  const handleConfirmDuplicate = () => {
    if (!agentConfig) return;
    const values: BlueprintValue[] = agentConfig.values
      .filter((v) => v.type !== BlueprintValueType.PROMPT)
      .map((v) => ({
        key: v.key,
        type: v.type,
        value: v.value,
        ...(v.description ? { description: v.description } : {}),
      }));
    createConfig({
      agentConfig: {
        project_id: projectId,
        blueprint: {
          description: agentConfig.description || undefined,
          type: BlueprintType.BLUEPRINT,
          values,
        },
      },
    });
  };

  return (
    <>
      <Card className="mx-6 my-4 p-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="comet-title-m">v{version}</h2>
            {sortTags(item.tags).map(renderTag)}
            {prodItemId && prodItemId !== item.id && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setDiffOpen(true)}
              >
                <GitCompareArrows className="mr-1.5 size-3.5" />
                Show diff vs prod
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!item.tags.some(isProdTag) && (
              <TooltipWrapper
                content={`This will affect your agent in production.${
                  prodVersion
                    ? ` Current version in production is v${prodVersion}.`
                    : ""
                }`}
              >
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setConfirmOpen(true)}
                  disabled={isPromoting}
                >
                  <Rocket className="mr-1.5 size-3.5 text-[#A3E635]" />
                  {isPromoting ? "Promoting..." : "Promote to prod"}
                </Button>
              </TooltipWrapper>
            )}
            <NavigationTag
              id={projectId}
              name="Go to traces"
              resource={RESOURCE_TYPE.traces}
              iconsSize={3.5}
              className="[&>div]:text-foreground"
              size="lg"
              search={{
                traces_filters: [
                  {
                    id: "agent_configuration_blueprint_id",
                    field: "metadata",
                    type: COLUMN_TYPE.dictionary,
                    operator: "=",
                    key: "agent_configuration.blueprint_id",
                    value: item.id,
                  },
                ],
              }}
            />
            <Button
              size="xs"
              variant="outline"
              onClick={() => setDuplicateConfirmOpen(true)}
              disabled={isDuplicating || isPending}
            >
              <CopyPlus className="mr-1.5 size-3.5 text-light-slate" />
              {isDuplicating ? "Duplicating..." : "Duplicate as new"}
            </Button>
          </div>
        </div>
        <TooltipWrapper content={description}>
          <p className="comet-body-s flex w-full min-w-0 items-start gap-1 overflow-hidden text-light-slate">
            <FilePen className="mt-1 size-3 shrink-0" />
            <span className="truncate">{description}</span>
          </p>
        </TooltipWrapper>
        <div className="comet-body-s mt-1 flex items-center gap-1 text-light-slate">
          <Clock className="size-3 shrink-0" />
          <TooltipWrapper
            content={`${formatDate(item.created_at, {
              utc: true,
              includeSeconds: true,
            })} UTC`}
          >
            <span>{getTimeFromNow(item.created_at)}</span>
          </TooltipWrapper>
          <User className="ml-1.5 size-3.5 shrink-0" />
          <span>{item.created_by}</span>
        </div>

        {isPending ? (
          <Loader />
        ) : (
          <BlueprintValuesList values={agentConfig?.values ?? []} />
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        setOpen={setConfirmOpen}
        onConfirm={handleConfirmPromote}
        title="Promote to production"
        description={`This will set v${version} as the active configuration for the prod environment. Are you sure you want to continue?`}
        confirmText="Promote to prod"
      />
      <ConfirmDialog
        open={duplicateConfirmOpen}
        setOpen={setDuplicateConfirmOpen}
        onConfirm={handleConfirmDuplicate}
        title="Duplicate as new blueprint"
        description={`This will create a new blueprint with all values copied from v${version}. Are you sure you want to continue? It will ignore the updates for prompts.`}
        confirmText="Duplicate"
      />
      {prodItemId && prodItemId !== item.id && (
        <BlueprintDiffDialog
          open={diffOpen}
          setOpen={setDiffOpen}
          base={{
            label: `Production (v${prodVersion})`,
            blueprintId: prodItemId,
          }}
          diff={{
            label: `v${version}`,
            blueprintId: item.id,
          }}
        />
      )}
    </>
  );
};

export default ConfigurationDetailView;
