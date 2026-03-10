import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

export interface TaskMapping {
  id: string;
  vantagebp_task_id: string;
  personal_task_id: string;
  task_name: string;
  created_at: string;
  completed_at: string | null;
}

export async function createTaskMapping(
  vantagebpTaskId: string,
  personalTaskId: string,
  taskName: string
): Promise<void> {
  const { error } = await supabase.from("clickup_task_sync").insert({
    vantagebp_task_id: vantagebpTaskId,
    personal_task_id: personalTaskId,
    task_name: taskName,
  });
  if (error) throw new Error(`Failed to create task mapping: ${error.message}`);
}

export async function getMappingByPersonalId(
  personalTaskId: string
): Promise<TaskMapping | null> {
  const { data, error } = await supabase
    .from("clickup_task_sync")
    .select("*")
    .eq("personal_task_id", personalTaskId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get mapping: ${error.message}`);
  }
  return data;
}

export async function getMappingByVantageBPId(
  vantagebpTaskId: string
): Promise<TaskMapping | null> {
  const { data, error } = await supabase
    .from("clickup_task_sync")
    .select("*")
    .eq("vantagebp_task_id", vantagebpTaskId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Failed to get mapping: ${error.message}`);
  }
  return data;
}

export async function markMappingCompleted(
  personalTaskId: string
): Promise<void> {
  const { error } = await supabase
    .from("clickup_task_sync")
    .update({ completed_at: new Date().toISOString() })
    .eq("personal_task_id", personalTaskId);
  if (error)
    throw new Error(`Failed to mark mapping completed: ${error.message}`);
}
