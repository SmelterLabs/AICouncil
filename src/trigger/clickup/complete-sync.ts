import { task } from "@trigger.dev/sdk/v3";
import { updateTaskStatus, getVantageBPConfig } from "../../lib/clickup";
import {
  getMappingByPersonalId,
  markMappingCompleted,
} from "../../lib/clickup-db";

interface CompleteSyncPayload {
  personalTaskId: string;
}

export const completeSync = task({
  id: "clickup-complete-sync",
  run: async (payload: CompleteSyncPayload) => {
    const { personalTaskId } = payload;

    // Look up mapping
    const mapping = await getMappingByPersonalId(personalTaskId);
    if (!mapping) {
      return { synced: false, reason: "No VantageBP source mapping found" };
    }

    // Already synced?
    if (mapping.completed_at) {
      return { synced: false, reason: "Already synced completion" };
    }

    // Mark VantageBP task complete
    const vbpConfig = getVantageBPConfig();
    await updateTaskStatus(vbpConfig, mapping.vantagebp_task_id, "complete");

    // Record completion
    await markMappingCompleted(personalTaskId);

    console.log(
      `Synced completion: Personal ${personalTaskId} → VBP ${mapping.vantagebp_task_id} (${mapping.task_name})`
    );

    return {
      synced: true,
      vantagebpTaskId: mapping.vantagebp_task_id,
      personalTaskId,
      taskName: mapping.task_name,
    };
  },
});
