-- AlterTable
ALTER TABLE "BoardInvite" ADD COLUMN     "groupId" TEXT;

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BoardGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

