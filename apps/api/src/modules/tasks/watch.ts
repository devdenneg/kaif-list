import { prisma } from '../../lib/prisma.js';
import { assertCanTask, type RequestUser, type TaskContext } from '../../lib/rbac.js';
import { setWatching } from '../../services/participants.js';

/** Подписка на задачу вручную («Следить» / «Не следить»). */
export async function setTaskWatching(
  user: RequestUser,
  context: TaskContext,
  watch: boolean,
): Promise<void> {
  assertCanTask(user, context, 'task.watch');
  await prisma.$transaction(async (tx) => {
    await setWatching(tx, context.task.id, user.id, watch);
  });
}
