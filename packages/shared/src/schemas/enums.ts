import { z } from 'zod';
import {
  ColumnKey,
  NotificationType,
  ParticipantRole,
  TaskLinkType,
  TaskPriority,
  TaskType,
} from '../enums.js';

export const columnKeySchema = z.enum([
  ColumnKey.TODO,
  ColumnKey.ON_HOLD,
  ColumnKey.IN_PROGRESS,
  ColumnKey.QA,
  ColumnKey.READY_TO_RELEASE,
  ColumnKey.DONE,
]);

export const taskTypeSchema = z.enum([
  TaskType.TASK,
  TaskType.BUG,
  TaskType.STORY,
  TaskType.EPIC,
  TaskType.CHORE,
]);

export const taskPrioritySchema = z.enum([
  TaskPriority.LOWEST,
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
  TaskPriority.BLOCKER,
]);

export const taskLinkTypeSchema = z.enum([
  TaskLinkType.BLOCKS,
  TaskLinkType.BLOCKED_BY,
  TaskLinkType.RELATES,
  TaskLinkType.DUPLICATES,
  TaskLinkType.DUPLICATED_BY,
]);

export const participantRoleSchema = z.enum([
  ParticipantRole.REPORTER,
  ParticipantRole.ASSIGNEE,
  ParticipantRole.TESTER,
  ParticipantRole.WATCHER,
  ParticipantRole.CONTRIBUTOR,
]);

export const notificationTypeSchema = z.enum(
  Object.values(NotificationType) as [NotificationType, ...NotificationType[]],
);
