-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cycleTimeMinutes" INTEGER,
ADD COLUMN     "firstCompletedAt" TIMESTAMP(3),
ADD COLUMN     "firstInProgressAt" TIMESTAMP(3),
ADD COLUMN     "leadTimeMinutes" INTEGER,
ADD COLUMN     "onHoldCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onHoldTotalMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TaskColumnTransition" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromColumn" "ColumnKey",
    "toColumn" "ColumnKey" NOT NULL,
    "actorId" TEXT,
    "backward" BOOLEAN NOT NULL DEFAULT false,
    "isPause" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,

    CONSTRAINT "TaskColumnTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskColumnTransition_taskId_enteredAt_idx" ON "TaskColumnTransition"("taskId", "enteredAt");

-- CreateIndex
CREATE INDEX "TaskColumnTransition_boardId_toColumn_enteredAt_idx" ON "TaskColumnTransition"("boardId", "toColumn", "enteredAt");

-- CreateIndex
CREATE INDEX "TaskColumnTransition_boardId_enteredAt_idx" ON "TaskColumnTransition"("boardId", "enteredAt");

-- CreateIndex
CREATE INDEX "TaskColumnTransition_taskId_leftAt_idx" ON "TaskColumnTransition"("taskId", "leftAt");

-- CreateIndex
CREATE INDEX "Task_boardId_firstCompletedAt_idx" ON "Task"("boardId", "firstCompletedAt");

-- CreateIndex
CREATE INDEX "Task_boardId_returnCount_idx" ON "Task"("boardId", "returnCount");

-- AddForeignKey
ALTER TABLE "TaskColumnTransition" ADD CONSTRAINT "TaskColumnTransition_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskColumnTransition" ADD CONSTRAINT "TaskColumnTransition_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskColumnTransition" ADD CONSTRAINT "TaskColumnTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

