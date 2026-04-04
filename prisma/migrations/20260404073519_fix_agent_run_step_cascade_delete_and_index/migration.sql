-- DropForeignKey
ALTER TABLE "agent_run_steps" DROP CONSTRAINT "agent_run_steps_agent_id_fkey";

-- AlterTable
ALTER TABLE "agent_teams" ALTER COLUMN "model" SET DEFAULT 'mistralai/mistral-small-3.1-24b-instruct';

-- CreateIndex
CREATE INDEX "agent_run_steps_agent_id_idx" ON "agent_run_steps"("agent_id");

-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
