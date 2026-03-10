import { task } from "@trigger.dev/sdk/v3";
import {
  getTask,
  createTask,
  getVantageBPConfig,
  getPersonalConfig,
} from "../../lib/clickup";
import {
  createTaskMapping,
  getMappingByVantageBPId,
} from "../../lib/clickup-db";

const PERSONAL_DAILY_TODO_LIST = "901317178775";
const CASEY_VANTAGEBP_USER_ID = 43090759;
const CASEY_PERSONAL_USER_ID = 57180691;

interface MirrorPayload {
  vantagebpTaskId: string;
}

export const mirrorTask = task({
  id: "clickup-mirror-task",
  run: async (payload: MirrorPayload) => {
    const { vantagebpTaskId } = payload;

    // Idempotency: skip if already mirrored
    const existing = await getMappingByVantageBPId(vantagebpTaskId);
    if (existing) {
      return { skipped: true, reason: "Already mirrored", existing };
    }

    const vbpConfig = getVantageBPConfig();
    const personalConfig = getPersonalConfig();

    // Fetch full task details from VantageBP
    const sourceTask = await getTask(vbpConfig, vantagebpTaskId);

    // Only mirror tasks assigned to Casey
    const isAssignedToCasey = sourceTask.assignees?.some(
      (a: any) => a.id === CASEY_VANTAGEBP_USER_ID
    );
    if (!isAssignedToCasey) {
      return { skipped: true, reason: "Not assigned to Casey" };
    }

    // Build mirror task
    const mirrorData: Parameters<typeof createTask>[2] = {
      name: `[VBP] ${sourceTask.name}`,
      description: sourceTask.description || "",
      assignees: [CASEY_PERSONAL_USER_ID],
      tags: ["vantagebp"],
    };

    // Map priority (ClickUp uses { id: 1-4 } object)
    if (sourceTask.priority?.id) {
      mirrorData.priority = sourceTask.priority.id;
    }

    // Carry over due date
    if (sourceTask.due_date) {
      mirrorData.due_date = parseInt(sourceTask.due_date);
      mirrorData.due_date_time = true;
    }

    // Create in Personal workspace
    const created = await createTask(
      personalConfig,
      PERSONAL_DAILY_TODO_LIST,
      mirrorData
    );

    // Save mapping
    await createTaskMapping(vantagebpTaskId, created.id, sourceTask.name);

    console.log(
      `Mirrored VBP task ${vantagebpTaskId} → Personal task ${created.id}: ${sourceTask.name}`
    );

    return {
      skipped: false,
      vantagebpTaskId,
      personalTaskId: created.id,
      taskName: sourceTask.name,
    };
  },
});
