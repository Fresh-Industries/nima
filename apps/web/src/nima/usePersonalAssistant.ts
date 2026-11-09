import type { PersonalAgentConfig } from "@t3tools/contracts";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useNimaStore } from "./store";

export function usePersonalAssistant() {
  const environmentId = usePrimaryEnvironmentId();
  const environment = useEnvironment(environmentId);
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.personalAgentLive({ environmentId, input: {} }) : null,
  );
  const name = useNimaStore((state) => state.chiefName);
  const avatar = useNimaStore((state) => state.assistantAvatar);
  const timezone = useNimaStore((state) => state.timezone);
  const reasoning = useNimaStore((state) => state.reasoning);
  const legacy: PersonalAgentConfig = {
    name,
    avatar,
    timezone,
    reasoning,
    instructions: "",
    personalMemoryTaskIds: [],
  };
  const profile = query.data;
  return {
    environmentId,
    profile,
    config: profile ? profile.config : legacy,
    legacy,
    query,
    connected: environment?.connection.phase === "connected",
  };
}
